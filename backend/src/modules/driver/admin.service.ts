import { readCloudDocument } from './documentStorage.service';
import { getServiceSettings, reviewDriverServices, notifyServiceAvailability } from '../matching/serviceEligibility';
import { open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { db, inTransaction } from "../../shared/config/db";
import { ApiError } from "../../shared/errors";
import { adminId } from "../../shared/utils/adminQuery";
import { documentContentType } from "./driver.service";
import {
  auditInput,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import { createNotificationRecord, publishNotification } from "../notifications/notifications.service";
import { driverApplicationNotification } from "../notifications/notificationTemplates";
import { queueCustomerEmail } from '../notifications/email.service';

export const documentKinds = ["license", "registration", "insurance"] as const;
export type DocumentKind = (typeof documentKinds)[number];
interface ApplicationRow {
  userId: string;
  name: string;
  status: string;
  version: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  address: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  license: string | null;
  registration: string | null;
  insurance: string | null;
  rejectionReason: string | null;
}
const projection = `d.user_id AS "userId",u.full_name AS name,d.status,d.updated_at::text AS version,d.submitted_at AS "submittedAt",d.reviewed_at AS "reviewedAt",d.residential_address AS address,d.vehicle_make AS make,d.vehicle_model AS model,d.vehicle_year AS year,d.plate_number AS plate,d.license_doc_url AS license,d.vehicle_reg_doc_url AS registration,d.insurance_doc_url AS insurance,d.rejection_reason AS "rejectionReason"`;
export async function getAdminApplication(userId: string, actorId: string) {
  const { rows } = await db.query<ApplicationRow>(
    `SELECT ${projection} FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.user_id=$1`,
    [userId],
  );
  if (!rows[0]) throw new ApiError(404, "application_not_found");
  await db.query(
    "INSERT INTO admin_audit_log(actor_id,action,target_user_id,reason,metadata) VALUES($1,'driver_application_read',$2,'Staff opened private application details',$3)",
    [actorId, userId, { applicationVersion: rows[0].version }],
  );
  const { license, registration, insurance, ...row } = rows[0];
  const serviceSettings=await inTransaction(client=>getServiceSettings(userId,client));
  return {
    ...row,
    documents: documentKinds.map((kind) => ({
      kind,
      available: Boolean({ license, registration, insurance }[kind]),
    })),
    serviceSettings,
    allowedActions: ["pending","approved","rejected"].includes(row.status) ? ["approve", "reject", "review-services"] : [],
    asOf: new Date().toISOString(),
  };
}
// Release account/application locks before fetching provider bytes. The second
// transaction checks the same material version and references before approval.
class DocumentVerificationRequired extends Error {
  constructor(readonly references: Array<string|null>) {super('document_verification_required');}
}
export async function reviewAdminApplication(
  actorId: string,
  userId: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_application_decision');
  const audit = auditInput(input.reason, input.requestKey);
  if (
    (input.decision !== "approved" && input.decision !== "rejected") ||
    typeof input.expectedVersion !== "string"
  )
    throw new ApiError(400, "invalid_application_decision");
  const decision = input.decision,
    expectedVersion = input.expectedVersion;
  let verifiedReferences:Array<string|null>|null=null;
  const performReview = () => inTransaction(async (client) => {
    const replay = await replayAdminOperation(
      client,
      actorId,
      "driver_application_review",
      audit.requestKey,
      { userId, decision, services: input.services??null, vehicleCategory: input.vehicleCategory??null, expectedVersion, reason: audit.reason },
    );
    if (replay.previous) {
      const saved=(await client.query<{status:string;serviceSettings:unknown;version:string}>(`SELECT metadata->>'afterStatus' AS status,metadata->'services' AS "serviceSettings",metadata->>'afterVersion' AS version FROM admin_audit_log WHERE id=$1`,[replay.previous.id])).rows[0];
      return { result: { status: saved?.status??decision, serviceSettings:saved?.serviceSettings, version:saved?.version, auditId: replay.previous.id, replayed: true }, notification: null };
    }
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const { rows } = await client.query<ApplicationRow>(
      `SELECT ${projection} FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.user_id=$1 FOR UPDATE OF d,u`,
      [userId],
    );
    const application = rows[0];
    if (!application) throw new ApiError(404, "application_not_found");
    if (
      application.version !== expectedVersion ||
      !["pending","approved","rejected"].includes(application.status)
    )
      throw new ApiError(409, "application_changed");
    const beforeSettings=await getServiceSettings(userId,client);
    const changesCategory = input.vehicleCategory !== undefined && input.vehicleCategory !== beforeSettings.vehicleCategory;
    const approvesService = changesCategory || (input.services && typeof input.services==='object' ? Object.values(input.services).includes('approved') : decision==='approved');
    if (approvesService && (
      !application.address ||
      !application.make ||
      !application.model ||
      !application.year ||
      !application.plate ||
      !application.license ||
      !application.registration ||
      !application.insurance
    ))
      throw new ApiError(409, "driver_application_incomplete");
    if (approvesService) {
      const references=[application.license,application.registration,application.insurance];
      if (!verifiedReferences) throw new DocumentVerificationRequired(references);
      if (references.some((reference,index)=>reference!==verifiedReferences![index])) throw new ApiError(409,'application_changed');
    }
    const reviewed = await reviewDriverServices(userId,input,actorId,audit.reason,client);
    const version = (await client.query<{version:string}>('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[userId])).rows[0].version;
    const record = await client.query<{ id: string }>(
      `INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,'driver_application_review',$2,$3,$4,$5) RETURNING id::text`,
      [
        actorId,
        userId,
        audit.requestKey,
        audit.reason,
        {
          operationHash: replay.hash,
          before: {status:application.status,rideServiceStatus:beforeSettings.services.ride.status,courierServiceStatus:beforeSettings.services.courier.status,vehicleCategory:beforeSettings.vehicleCategory,rideOptIn:beforeSettings.services.ride.enabled,courierOptIn:beforeSettings.services.courier.enabled},
          after: {status:reviewed.status,rideServiceStatus:reviewed.serviceSettings.services.ride.status,courierServiceStatus:reviewed.serviceSettings.services.courier.status,vehicleCategory:reviewed.serviceSettings.vehicleCategory,rideOptIn:reviewed.serviceSettings.services.ride.enabled,courierOptIn:reviewed.serviceSettings.services.courier.enabled},
          afterStatus: reviewed.status,
          afterVersion: version,
          services: reviewed.serviceSettings,
          applicationVersion: expectedVersion,
        },
      ],
    );
    const result = { status: reviewed.status, serviceSettings: reviewed.serviceSettings, version, auditId: record.rows[0].id, replayed: false };
    await queueCustomerEmail(client,userId,`application-review:${result.auditId}`,'application_reviewed',{
      services:[
        {name:'Passenger rides',status:reviewed.serviceSettings.services.ride.status},
        {name:'Courier deliveries',status:reviewed.serviceSettings.services.courier.status},
      ].filter(service=>service.status!=='none'),
    });
    const notification = await createNotificationRecord(client,driverApplicationNotification({
      userId,
      status: reviewed.status as 'pending'|'approved'|'rejected',
      reason: reviewed.status === "rejected" ? audit.reason : null,
      version: result.auditId,
    }));
    return { result, notification };
  });
  let completed:Awaited<ReturnType<typeof performReview>>;
  try {completed=await performReview();}
  catch(error) {
    if (!(error instanceof DocumentVerificationRequired)) throw error;
    await Promise.all(error.references.map(reference=>readPrivateDocument(userId,reference)));
    verifiedReferences=error.references;
    completed=await performReview();
  }
  if (completed.notification) await publishNotification(completed.notification).catch((error:unknown)=>console.error('[notifications] driver application review publish failed',error instanceof Error?error.message:'unknown'));
  await notifyServiceAvailability(userId);
  return completed.result;
}
export async function readAdminDocument(
  actorId: string,
  userId: string,
  kind: DocumentKind,
) {
  const application = await db.query<{
    license: string | null;
    registration: string | null;
    insurance: string | null;
  }>(
    "SELECT license_doc_url AS license,vehicle_reg_doc_url AS registration,insurance_doc_url AS insurance FROM driver_profiles WHERE user_id=$1",
    [userId],
  );
  const {bytes,contentType}=await readPrivateDocument(userId,application.rows[0]?.[kind]);
  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,'driver_document_view',$2,$3,'Staff application document inspection',$4)`,
      [actorId, userId, randomUUID(), { documentKind: kind }],
    );
  });
  return { bytes, contentType };
}

export async function readPrivateDocument(userId:string,reference:string|null|undefined) {
  if (!reference) throw new ApiError(404, "document_not_found");
  if(reference.startsWith('cloudinary://'))return readCloudDocument(userId,reference);
  const match =
    /^private:\/\/driver-documents\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.[a-z0-9]+)$/i.exec(
      reference,
    );
  if (!match || adminId(match[1]) !== userId)
    throw new ApiError(404, "document_not_found");
  const directory = resolve(
    process.cwd(),
    ".private-uploads",
    "driver-documents",
    userId,
  );
  let bytes: Buffer;
  try {
    const base = await realpath(
      resolve(process.cwd(), ".private-uploads", "driver-documents"),
    );
    const root = await realpath(directory),
      path = await realpath(resolve(directory, match[2]));
    if (!root.startsWith(base + sep) || !path.startsWith(root + sep))
      throw new Error("path_outside_document_directory");
    const file = await open(path, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 8 * 1024 * 1024)
        throw new ApiError(413, "document_too_large");
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(404, "document_unavailable");
  }
  if (bytes.length > 8 * 1024 * 1024)
    throw new ApiError(413, "document_too_large");
  const contentType = documentContentType(bytes);
  if (!contentType) throw new ApiError(415, "unsupported_document_content");
  return {bytes,contentType};
}
