import { readAdminRows } from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import {
  auditInput,
  recordAdminRead,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import { env } from "../../config/env";
import { db, inTransaction } from "../../shared/config/db";
import {
  adminPage,
  maskedEmail,
  maskedPhone,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
import { ApiError } from "../../shared/errors";
import { assertDriverMaterialEditable } from '../driver/driver.service';
import { disconnectAccountSockets } from '../../websocket/notifications';
import { revokeAllDevices } from '../notifications/notifications.service';
interface PersonRow {
  id: string;
  _cursor: string;
  name: string;
  platformRole: string;
  version: string;
  phone: string | null;
  email: string | null;
  joinedAt: Date;
  active: boolean;
  trips: string;
  driver: Record<string, unknown> | null;
}
let acceptingTraffic = false;
export function setServerReadiness(ready: boolean) { acceptingTraffic = ready; }
/** Public probe returns only readiness, never credentials or operational diagnostics. */
export async function serverReady() {
  if (!acceptingTraffic) return false;
  const { tripWorkersReady,tripQueuesAccepting } = await import('../trips/tripQueue.js');
  const { paymentWorkersReady,paymentQueueAccepting } = await import('../payments/paymentQueue.js');
  const { notificationWorkersReady,notificationQueueAccepting } = await import('../notifications/notificationQueue.js');
  const { communicationWorkersReady,communicationQueueAccepting } = await import('../communication/communicationQueue.js');
  const { ensureRedis } = await import('../../shared/config/redis.js');
  if (!tripWorkersReady() || !paymentWorkersReady() || !notificationWorkersReady() || !communicationWorkersReady()) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const databaseProbe = { text: 'SELECT 1', query_timeout: 2000 };
  try {
    const checks=await Promise.race([
      Promise.all([db.query(databaseProbe), ensureRedis().then(client => client.ping()),tripQueuesAccepting(),paymentQueueAccepting(),notificationQueueAccepting(),communicationQueueAccepting()]),
      new Promise<never>((_done, reject) => { timer = setTimeout(() => reject(new Error('readiness_timeout')), 2500); }),
    ]);
    return acceptingTraffic && tripWorkersReady() && paymentWorkersReady() && notificationWorkersReady() && communicationWorkersReady() && checks[2] && checks[3] && checks[4] && checks[5];
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}
const personProjection = `u.id,u.full_name AS name,u.role AS "platformRole",u.updated_at::text AS version,u.phone,u.email,u.created_at AS "joinedAt",u.is_active AS active,u.created_at::text AS _cursor,
 (SELECT COUNT(*)::text FROM trips t WHERE t.rider_id=u.id OR t.driver_id=u.id) AS trips,
 CASE WHEN d.user_id IS NOT NULL AND d.status<>'none' THEN json_build_object('status',d.status,'vehicle',concat_ws(' ',d.vehicle_make,d.vehicle_model,d.vehicle_color),'plate',d.plate_number,'courierOptIn',d.accepts_courier,'rideOptIn',d.accepts_ride,'vehicleCategory',d.vehicle_category,'rideServiceStatus',d.ride_service_status,'courierServiceStatus',d.courier_service_status,'availability','unknown','locationAt',NULL,'rating',CASE WHEN u.rating_count>0 THEN u.rating_avg ELSE NULL END,'ratingCount',u.rating_count,'submittedAt',d.submitted_at,'updatedAt',d.updated_at,'rejectionReason',d.rejection_reason,'activeTripId',(SELECT t.id FROM trips t WHERE t.driver_id=u.id AND t.status IN ('driver_assigned','driver_arrived','in_progress','returning') ORDER BY t.requested_at DESC LIMIT 1),'activeRole',u.active_role,'payoutAccounts',(SELECT COALESCE(json_agg(json_build_object('bank',p.bank_name,'last4',p.account_last4,'active',p.is_active)),'[]') FROM payout_accounts p WHERE p.user_id=u.id AND p.is_active=true)) ELSE NULL END AS driver`;
function publicPerson(row: PersonRow) {
  const { phone, email, ...person } = row;
  return {
    ...person,
    trips: Number(person.trips),
    phoneMasked: maskedPhone(phone),
    emailMasked: maskedEmail(email),
  };
}
export async function listAdminPeople(query: AdminQuery, driversOnly = false) {
  const { rows, ...paging } = await readAdminRows<PersonRow>(
    {
      select: `SELECT ${personProjection} FROM users u LEFT JOIN driver_profiles d ON d.user_id=u.id
 WHERE (NOT $1::boolean OR d.status IN ('pending','approved','rejected')) AND ($2::text IS NULL OR d.status::text=$2 OR ($2='pending' AND (d.ride_service_status='pending' OR d.courier_service_status='pending')))
 AND ($8::text IS NULL OR ($8='ride' AND d.ride_service_status<>'none') OR ($8='courier' AND d.courier_service_status<>'none'))
 AND ($7::text IS NULL OR u.is_active=($7='active')) AND ($3::uuid IS NULL OR u.id=$3) AND ($4::timestamptz IS NULL OR (u.created_at,u.id)<($4::timestamptz,$5::uuid))`,
      orderBy: `u.created_at DESC,u.id DESC`,
      limitParameter: 6,
    },
    [
      driversOnly,
      query.status,
      query.id,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
      query.mode,
      query.service,
    ],
    query,
  );
  const people=rows.map(publicPerson);
  const {adminDriverPresence}=await import("../location/admin.service.js");
  const presence=await adminDriverPresence(people.filter(p=>p.driver).map(p=>p.id));
  return adminPage(people.map(p=>({...p,driver:p.driver ? {...p.driver,...presence.get(p.id),...(p.driver.activeTripId ? {availability:"busy",presenceReason:"Assigned to an active trip"}:{} )}:null})),query,"users.created_at",paging);
}
export async function getAdminPerson(id: string, actorId: string) {
  const { rows } = await db.query<PersonRow>(
    `SELECT ${personProjection} FROM users u LEFT JOIN driver_profiles d ON d.user_id=u.id WHERE u.id=$1`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, "user_not_found");
  const { _cursor, ...person } = publicPerson(rows[0]);
  const {adminDriverPresence}=await import("../location/admin.service.js");
  const presence=person.driver ? (await adminDriverPresence([id])).get(id):undefined;
  const accounts = (
    await db.query(
      `SELECT id,kind,balance_kobo::text AS "balanceKobo",is_frozen AS frozen FROM ledger_accounts WHERE owner_user_id=$1 ORDER BY kind,id`,
      [id],
    )
  ).rows;
  await recordAdminRead(actorId, "person_context_read", "user", id);
  return {
    ...person,
    driver:person.driver ? {...person.driver,...presence,...(person.driver.activeTripId ? {availability:"busy",presenceReason:"Assigned to an active trip"}:{} )}:null,
    accounts,
    asOf: new Date().toISOString(),
    allowedActions: [],
  };
}

export async function updateAdminPerson(
  actorId: string,
  id: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_person_update");
  const audit = auditInput(input.reason, input.requestKey);
  if (
    Object.keys(input).some(
      (key) =>
        !["name", "active", "expectedVersion", "reason", "requestKey"].includes(
          key,
        ),
    ) ||
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.trim().length > 100 ||
    /[\u0000-\u001f]/.test(input.name) ||
    typeof input.active !== "boolean" ||
    typeof input.expectedVersion !== "string"
  )
    throw new ApiError(400, "invalid_person_update");
  const name = input.name.trim();
  const result=await inTransaction(async (client) => {
    const operation = await replayAdminOperation(
      client,
      actorId,
      "person_update",
      audit.requestKey,
      {
        id,
        name,
        active: input.active,
        expectedVersion: input.expectedVersion,
        reason: audit.reason,
      },
      ["super_admin"],
    );
    const before = (
      await client.query<{
        name: string;
        active: boolean;
        role: string;
        version: string;
      }>(
        "SELECT full_name AS name,is_active AS active,role,updated_at::text AS version FROM users WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!before) throw new ApiError(404, "user_not_found");
    if (operation.previous)
      return { id, ...before, auditId: operation.previous.id };
    if (["admin", "super_admin"].includes(before.role))
      throw new ApiError(403, "staff_accounts_require_access_management");
    if (before.version !== input.expectedVersion)
      throw new ApiError(409, "person_changed");
    if(name!==before.name)await assertDriverMaterialEditable(id,client);
    if (
      !input.active &&
      (
        await client.query(
          `SELECT id FROM trips WHERE (rider_id=$1 OR driver_id=$1) AND status IN ('scheduled','searching','driver_assigned','driver_arrived','in_progress','returning') LIMIT 1`,
          [id],
        )
      ).rowCount
    )
      throw new ApiError(409, "account_has_active_trip");
    const after = (
      await client.query<{ name: string; active: boolean; version: string }>(
        "UPDATE users SET full_name=$2,is_active=$3,updated_at=now() WHERE id=$1 RETURNING full_name AS name,is_active AS active,updated_at::text AS version",
        [id, name, input.active],
      )
    ).rows[0];
    if (!input.active) await revokeAllDevices(client,id);
    const saved = (
      await client.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor_id,action,request_key,reason,object_type,object_id,metadata) VALUES($1,'person_update',$2,$3,'user',$4,$5) RETURNING id::text`,
        [
          actorId,
          audit.requestKey,
          audit.reason,
          id,
          { operationHash: operation.hash, before, after },
        ],
      )
    ).rows[0];
    return { id, ...after, auditId: saved.id };
  });
  if(!input.active)disconnectAccountSockets(id);
  return result;
}

export async function getAdminHealth() {
  const { ensureRedis } = await import("../../shared/config/redis.js");
  const check = async (name: string, run: () => Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      await Promise.race([
        run(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("timed_out")), 3000);
        }),
      ]);
      return {
        name,
        state: "reachable",
        latencyMs: Date.now() - started,
        observedAt: new Date().toISOString(),
      };
    } catch {
      return {
        name,
        state: "unavailable",
        latencyMs: null,
        observedAt: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const checks = await Promise.all([
    check("PostgreSQL", () => db.query("SELECT 1")),
    check("Redis", async () => {
      const client = await ensureRedis();
      return client.ping();
    }),
  ]);
  const {getTripQueueHealth}=await import('../trips/tripQueue.js');
  const {getPaymentQueueHealth}=await import('../payments/paymentQueue.js');
  const {getNotificationQueueHealth,getNotificationDeliveryHealth}=await import('../notifications/notificationQueue.js');
  const {emailQueueHealth}=await import('../notifications/emailQueue.js');
  const {getCommunicationQueueHealth}=await import('../communication/communicationQueue.js');
  const queues = await Promise.all([getTripQueueHealth(),getPaymentQueueHealth(),getNotificationQueueHealth()]);
  const notificationDelivery=await getNotificationDeliveryHealth();
  const emailDelivery=await emailQueueHealth();
  const communicationQueue=await getCommunicationQueueHealth();
  let communicationDelivery={name:'Trip communication outbox',state:'unknown',observedAt:new Date().toISOString(),latencyMs:null,details:'Outbox observation unavailable'};
  try {
    const {communicationDeliveryHealth}=await import('../communication/communication.outbox.js');
    const delivery=await communicationDeliveryHealth();
    communicationDelivery={...communicationDelivery,state:delivery.oldestSeconds>30?'degraded':'reachable',details:`${delivery.pending} due events · oldest ${Math.round(delivery.oldestSeconds)} seconds`};
  } catch { /* Preserve the rest of the dashboard when delivery storage is unavailable. */ }
  let provider: {name:string;state:string;latencyMs:null;observedAt:string|null;details:string} = {name:'Paystack',state:'unknown',latencyMs:null,observedAt:null,details:'No recent provider request observed'};
  try {
    const redis = await ensureRedis();
    const value = await redis.get('rakky:health:paystack');
    if(value) {const observation=JSON.parse(value) as {state:string;observedAt:string};provider={...provider,...observation,details:'Last actual provider request; observation retained for 24 hours'};}
  } catch { /* Redis dependency check reports the failure. */ }
  return {checks:[...checks,...queues[0],queues[1],...queues[2],notificationDelivery,emailDelivery,communicationQueue,communicationDelivery,provider],asOf:new Date().toISOString(),coverage:'Live dependency checks, worker heartbeats, and 24-hour notification delivery observations. Queue counts include retained historical failures; successful/failed job observations expire after 24 hours. A heartbeat does not guarantee every job succeeded. Paystack reflects the last actual provider request.'};
}

export async function getAdminTeam(query: AdminQuery) {
  if (query.service || query.mode)
    throw new ApiError(400, "unsupported_filter");
  const { rows, ...paging } = await readAdminRows<{
    id: string;
    _cursor: string;
    name: string;
    role: string;
    active: boolean;
    createdAt: Date;
  }>(
    {
      select: `SELECT id,full_name AS name,role,is_active AS active,created_at AS "createdAt",created_at::text AS _cursor FROM users WHERE role IN ('admin','super_admin') AND ($1::uuid IS NULL OR id=$1) AND ($2::text IS NULL OR role::text=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))`,
      orderBy: `created_at DESC,id DESC`,
      limitParameter: 5,
    },
    [
      query.id,
      query.status,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
    ],
    query,
  );
  return {
    ...adminPage(rows, query, "created_at", paging),
    readOnly: true,
    coverage:
      "Existing staff roles only. Provisioning, scope grants, and step-up policy require an owner decision.",
  };
}

export function getAdminEnvironment() {
  const paymentEnvironment = env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
    ? "live"
    : env.PAYSTACK_SECRET_KEY.startsWith("sk_test_")
      ? "test"
      : "unconfigured";
  return {
    nodeEnvironment: env.NODE_ENV,
    paymentEnvironment,
    basis:
      "Configured provider key mode; not a provider availability observation.",
  };
}

async function searchAdminPeople(
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    driver: boolean;
  }>(
    `SELECT u.id,u.full_name AS name,u.phone,u.email,(d.status IN ('pending','approved','rejected')) AS driver FROM users u LEFT JOIN driver_profiles d ON d.user_id=u.id WHERE (u.id::text=$1 OR lower(u.full_name) LIKE $2 ESCAPE '!' OR u.phone=$3 OR lower(u.email)=$1 OR lower(d.plate_number)=$1) AND ($4::uuid IS NULL OR u.id>$4) ORDER BY u.id LIMIT $5`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.query,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    type: "person",
    title: row.name,
    subtitle: `${maskedPhone(row.phone)} · ${maskedEmail(row.email)}`,
    href: `/admin/${row.driver ? "drivers" : "riders"}/${row.id}`,
  }));
}
export async function searchStaffRecords(
  input: import("../../shared/utils/adminSearch").SearchRead,
  actorId: string,
  role: string,
) {
  if (!["admin", "super_admin"].includes(role))
    throw new ApiError(403, "insufficient_permissions");
  if (input.scope === "safety" && role !== "super_admin")
    throw new ApiError(403, "insufficient_permissions");
  const { ensureRedis } = await import("../../shared/config/redis.js");
  try {
    const redis = await ensureRedis();
    const [count, ttl] = (await redis.eval(
      `local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],60) end; return {count,redis.call('TTL',KEYS[1])}`,
      1,
      `rakky:admin-search:${actorId}`,
    )) as [number, number];
    if (count > 30)
      throw new ApiError(429, "staff_search_rate_limited", {
        retryAfterSeconds: Math.max(1, ttl),
      });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "staff_search_unavailable");
  }
  const { searchAdminTrips } = await import("../trips/admin.service.js");
  const { searchAdminFinance } =
    await import("../payments/dashboard.service.js");
  const { searchAdminCare } = await import("../care/care.service.js");
  const { staffSearchPage } = await import("../../shared/utils/adminSearch.js");
  const include = (scope: string) =>
    input.scope === "all" || input.scope === scope;
  const queries = [];
  if (include("people"))
    queries.push(
      searchAdminPeople(input).then((rows) =>
        staffSearchPage("people", "People", rows, input),
      ),
    );
  if (include("trips"))
    queries.push(
      searchAdminTrips(input).then((rows) =>
        staffSearchPage("trips", "Trips", rows, input),
      ),
    );
  if (include("finance"))
    queries.push(
      searchAdminFinance(input).then((rows) =>
        staffSearchPage("finance", "Money records", rows, input),
      ),
    );
  if (include("support"))
    queries.push(
      searchAdminCare("support", input).then((rows) =>
        staffSearchPage("support", "Support cases", rows, input),
      ),
    );
  if (role === "super_admin" && include("safety"))
    queries.push(
      searchAdminCare("safety", input).then((rows) =>
        staffSearchPage("safety", "Safety incidents", rows, input),
      ),
    );
  const groups = await Promise.all(queries);
  // Query text, contact identifiers, and result names are never persisted in the audit.
  await recordAdminRead(
    actorId,
    "staff_record_search",
    groups.some((group) => group.scope === "safety")
      ? "safety"
      : "staff_search",
    null,
    { scope: input.scope },
  );
  return { groups, asOf: new Date().toISOString(), limitPerGroup: input.limit };
}
