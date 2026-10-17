import { readAdminRows } from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import { db, inTransaction } from "../../shared/config/db";
import { ApiError } from "../../shared/errors";
import {
  adminId,
  adminPage,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
import {
  auditInput,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import type { PoolClient } from "pg";
import { createNotificationRecord, publishNotification } from "../notifications/notifications.service";
import { careNotification } from "../notifications/notificationTemplates";
export type CareKind = "support" | "safety";

export interface SupportSettings {
  phone: string | null;
  email: string | null;
  staffedHours: string;
  availabilityMessage: string;
  version: number;
  updatedAt: Date;
}

const supportSettingsSelect = `SELECT phone,email,staffed_hours AS "staffedHours",
  availability_message AS "availabilityMessage",version,updated_at AS "updatedAt" FROM support_settings WHERE id=true`;

export async function getSupportSettings(): Promise<SupportSettings> {
  const { rows } = await db.query<SupportSettings>(supportSettingsSelect);
  if (!rows[0]) throw new ApiError(503, 'support_settings_unavailable');
  return rows[0];
}

export async function updateSupportSettings(actorId: string, input: Record<string, unknown>) {
  const allowed = ['phone', 'email', 'staffedHours', 'availabilityMessage', 'expectedVersion', 'reason', 'requestKey'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new ApiError(400, 'unsupported_setting');
  const { reason, requestKey } = auditInput(input.reason, input.requestKey);
  const expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new ApiError(400, 'invalid_version');
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const phone = input.phone === null ? null : typeof input.phone === 'string' ? input.phone.trim() : null;
  const email = input.email === null ? null : typeof input.email === 'string' ? input.email.trim().toLowerCase() : null;
  if (has('phone') && input.phone !== null && (!phone || !/^\+[1-9]\d{7,14}$/.test(phone))) throw new ApiError(400, 'invalid_support_phone');
  if (has('email') && input.email !== null && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError(400, 'invalid_support_email');
  const staffedHours = has('staffedHours') ? text(input.staffedHours, 1, 160) : null;
  const availabilityMessage = has('availabilityMessage') ? text(input.availabilityMessage, 1, 300) : null;
  if (!['phone', 'email', 'staffedHours', 'availabilityMessage'].some(has)) throw new ApiError(400, 'missing_settings_changes');
  return inTransaction(async (client) => {
    const op = await replayAdminOperation(client, actorId, 'support_settings_updated', requestKey,
      { phone, email, staffedHours, availabilityMessage, fields: allowed.filter(has), expectedVersion, reason }, ['super_admin']);
    if (op.previous) {
      const previous = await client.query<{ settings: SupportSettings }>("SELECT metadata->'after' AS settings FROM admin_audit_log WHERE id=$1", [op.previous.id]);
      return { settings: previous.rows[0].settings, auditId: op.previous.id, replayed: true };
    }
    const before = (await client.query<SupportSettings>(`${supportSettingsSelect} FOR UPDATE`)).rows[0];
    if (!before) throw new ApiError(503, 'support_settings_unavailable');
    if (before.version !== expectedVersion) throw new ApiError(409, 'settings_version_conflict', { currentVersion: before.version });
    await client.query(`UPDATE support_settings SET phone=CASE WHEN $1 THEN $2 ELSE phone END,
      email=CASE WHEN $3 THEN $4 ELSE email END,staffed_hours=CASE WHEN $5 THEN $6 ELSE staffed_hours END,
      availability_message=CASE WHEN $7 THEN $8 ELSE availability_message END,version=version+1,updated_by=$9,updated_at=now() WHERE id=true`,
      [has('phone'), phone, has('email'), email, has('staffedHours'), staffedHours, has('availabilityMessage'), availabilityMessage, actorId]);
    const after = (await client.query<SupportSettings>(supportSettingsSelect)).rows[0];
    const audit = await client.query<{ id: string }>(`INSERT INTO admin_audit_log(actor_id,action,reason,request_key,object_type,before_version,after_version,metadata)
      VALUES($1,'support_settings_updated',$2,$3,'support_settings',$4,$5,$6) RETURNING id::text`,
      [actorId, reason, requestKey, JSON.stringify(before), JSON.stringify(after), JSON.stringify({ operationHash: op.hash, after })]);
    return { settings: after, auditId: audit.rows[0].id, replayed: false };
  });
}
// Identifiers come exclusively from this fixed server registry, never request input.
const registry = {
  support: {
    table: "support_cases",
    link: "case_id",
    roles: ["admin", "super_admin"],
    initial: "new",
    states: {
      new: ["assigned", "waiting_internal", "resolved"],
      assigned: ["waiting_customer", "waiting_internal", "resolved"],
      waiting_customer: ["assigned", "waiting_internal", "resolved"],
      waiting_internal: ["assigned", "waiting_customer", "resolved"],
      resolved: ["reopened"],
      reopened: ["assigned", "waiting_internal", "resolved"],
    },
  },
  safety: {
    table: "safety_incidents",
    link: "incident_id",
    roles: ["super_admin"],
    initial: "open",
    states: {
      open: ["acknowledged"],
      acknowledged: ["responding", "resolved"],
      responding: ["resolved"],
      resolved: ["reviewed"],
      reviewed: [],
    },
  },
} as const;
interface CareRow {
  id: string;
  customer_id: string | null;
  status: string;
  severity: string;
  assigned_staff_id: string | null;
  version: number;
  next_action?: string;
}
function text(value: unknown, min: number, max: number) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new ApiError(400, "invalid_care_text");
  return value.trim();
}
function severity(value: unknown) {
  if (
    typeof value !== "string" ||
    !["low", "medium", "high", "critical"].includes(value)
  )
    throw new ApiError(400, "invalid_severity");
  return value;
}
const optionalId = (value: unknown) =>
  value == null || value === "" ? null : adminId(value);
function snapshot(row: CareRow) {
  return {
    status: row.status,
    severity: row.severity,
    assignedStaffId: row.assigned_staff_id,
    version: row.version,
  };
}
async function links(
  client: PoolClient,
  customerId: string | null,
  tripId: string | null,
  paymentId: string | null,
) {
  if (
    customerId &&
    !(await client.query("SELECT id FROM users WHERE id=$1", [customerId]))
      .rows[0]
  )
    throw new ApiError(404, "customer_not_found");
  if (tripId) {
    const trip = (
      await client.query("SELECT rider_id,driver_id FROM trips WHERE id=$1", [
        tripId,
      ])
    ).rows[0];
    if (!trip) throw new ApiError(404, "trip_not_found");
    if (customerId && ![trip.rider_id, trip.driver_id].includes(customerId))
      throw new ApiError(409, "customer_trip_mismatch");
  }
  if (paymentId) {
    const payment = (
      await client.query("SELECT user_id FROM payment_intents WHERE id=$1", [
        paymentId,
      ])
    ).rows[0];
    if (!payment) throw new ApiError(404, "payment_not_found");
    if (!customerId || payment.user_id !== customerId)
      throw new ApiError(409, "customer_payment_mismatch");
  }
}
async function audit(
  client: PoolClient,
  actor: string,
  kind: CareKind,
  id: string,
  action: string,
  reason: string,
  key: string,
  hash: string,
  before: object | null,
  after: object,
) {
  const { rows } = await client.query(
    `INSERT INTO admin_audit_log(actor_id,action,reason,request_key,object_type,object_id,before_version,after_version,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`,
    [
      actor,
      action,
      reason,
      key,
      kind,
      id,
      before,
      after,
      { operationHash: hash },
    ],
  );
  return rows[0].id as string;
}
export async function listCare(kind: CareKind, q: AdminQuery) {
  const table = registry[kind].table;
  const { rows, ...paging } = await readAdminRows<{
    id: string;
    _cursor: string;
    [key: string]: unknown;
  }>(
    {
      select: `SELECT c.id,c.subject,c.status,c.severity,c.version,c.customer_id AS "customerId",c.trip_id AS "tripId",c.assigned_staff_id AS "assignedStaffId",u.full_name AS "assignedStaff",c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.created_at::text AS _cursor ${kind === "support" ? ',c.response_due_at AS "responseDueAt"' : ""} FROM ${table} c LEFT JOIN users u ON u.id=c.assigned_staff_id WHERE ($1::text IS NULL OR c.status=$1) AND ($2::uuid IS NULL OR c.id=$2) AND ($3::timestamptz IS NULL OR (c.created_at,c.id)<($3::timestamptz,$4::uuid))`,
      orderBy: `c.created_at DESC,c.id DESC`,
      limitParameter: 5,
    },
    [q.status, q.id, q.cursor?.at ?? null, q.cursor?.id ?? null, q.limit + 1],
    q,
  );
  return adminPage(rows, q, "created_at", paging);
}
export async function getCare(
  actor: string,
  kind: CareKind,
  id: string,
  before: string | null = null,
) {
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT c.*,u.full_name AS assigned_staff FROM ${registry[kind].table} c LEFT JOIN users u ON u.id=c.assigned_staff_id WHERE c.id=$1`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, "care_record_not_found");
    await client.query(
      "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,object_id) VALUES($1,$2,$3,$4,$5)",
      [actor, `${kind}_sensitive_read`, "Staff opened care record", kind, id],
    );
    const activity = (
      await client.query(
        `SELECT a.id::text,a.kind,a.body,a.visibility,a.delivery_status AS "deliveryStatus",a.metadata,u.full_name AS actor,a.created_at AS "createdAt" FROM care_activity a JOIN users u ON u.id=a.actor_id WHERE a.${registry[kind].link}=$1 AND ($2::bigint IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT 51`,
        [id, before],
      )
    ).rows;
    return {
      record: rows[0],
      activity: activity.slice(0, 50),
      nextActivityId: activity.length > 50 ? activity[49].id : null,
      allowedStates:
        registry[kind].states[
          rows[0].status as keyof (typeof registry)[typeof kind]["states"]
        ] ?? [],
      asOf: new Date().toISOString(),
    };
  });
}
export async function createCare(
  actor: string,
  kind: CareKind,
  input: Record<string, unknown>,
) {
  const { reason, requestKey } = auditInput(input.reason, input.requestKey);
  const subject = text(input.subject, 5, 160),
    body = text(input.body, 5, 4000),
    level = severity(input.severity);
  const customerId = optionalId(input.customerId),
    tripId = optionalId(input.tripId),
    paymentId = kind === "support" ? optionalId(input.paymentId) : null;
  const nextAction = kind === "safety" ? text(input.nextAction, 5, 1000) : null;
  const category = kind === "support" ? text(input.category, 2, 40) : null;
  if (category && !["trip", "payment", "account", "other"].includes(category))
    throw new ApiError(400, "invalid_category");
  const outcome=await inTransaction(async (client) => {
    const action = `${kind}_created`;
    const op = await replayAdminOperation(
      client,
      actor,
      action,
      requestKey,
      {
        kind,
        subject,
        body,
        level,
        customerId,
        tripId,
        paymentId,
        nextAction,
        category,
        reason,
      },
      registry[kind].roles,
    );
    if (op.previous) {
      const existing = (
        await client.query(
          "SELECT object_id AS id FROM admin_audit_log WHERE id=$1",
          [op.previous.id],
        )
      ).rows[0];
      return { result:{ id: existing.id, auditId: op.previous.id, replayed: true },notification:null };
    }
    await links(client, customerId, tripId, paymentId);
    const { rows } =
      kind === "support"
        ? await client.query<CareRow>(
            "INSERT INTO support_cases(customer_id,trip_id,payment_id,category,severity,subject,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [customerId, tripId, paymentId, category, level, subject, actor],
          )
        : await client.query<CareRow>(
            "INSERT INTO safety_incidents(customer_id,trip_id,severity,subject,next_action,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [customerId, tripId, level, subject, nextAction, actor],
          );
    const row = rows[0];
    await client.query(
      `INSERT INTO care_activity(${registry[kind].link},actor_id,kind,body) VALUES($1,$2,'created',$3)`,
      [row.id, actor, body],
    );
    const auditId = await audit(
      client,
      actor,
      kind,
      row.id,
      action,
      reason,
      requestKey,
      op.hash,
      null,
      snapshot(row),
    );
    const notification=customerId?await createNotificationRecord(client,careNotification({userId:customerId,kind,careId:row.id,status:row.status,version:row.version})):null;
    return { result:{ id: row.id, auditId, version: row.version },notification };
  });
  if(outcome.notification)await publishNotification(outcome.notification).catch((error:unknown)=>console.error('[notifications] care notification publish failed',error instanceof Error?error.message:'unknown'));
  return outcome.result;
}
export async function changeCare(
  actor: string,
  kind: CareKind,
  id: string,
  input: Record<string, unknown>,
) {
  const { reason, requestKey } = auditInput(input.reason, input.requestKey);
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1)
    throw new ApiError(400, "expected_version_required");
  const verb = input.action;
  if (!["note", "transition", "assign"].includes(String(verb)))
    throw new ApiError(400, "invalid_care_action");
  const body = verb === "note" ? text(input.body, 5, 4000) : reason;
  const state = verb === "transition" ? text(input.status, 2, 24) : null;
  const assignee = verb === "assign" ? optionalId(input.assignedStaffId) : null;
  const nextAction =
    kind === "safety" && input.nextAction !== undefined
      ? text(input.nextAction, 5, 1000)
      : null;
  const outcome=await inTransaction(async (client) => {
    const action = `${kind}_${verb}`;
    const op = await replayAdminOperation(
      client,
      actor,
      action,
      requestKey,
      {
        id,
        version: input.version,
        verb,
        body,
        state,
        assignee,
        nextAction,
        reason,
      },
      registry[kind].roles,
    );
    if (op.previous) return {result:{ auditId: op.previous.id, replayed: true },notification:null};
    const current = (
      await client.query<CareRow>(
        `SELECT * FROM ${registry[kind].table} WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!current) throw new ApiError(404, "care_record_not_found");
    if (current.version !== input.version)
      throw new ApiError(409, "care_version_conflict");
    if (verb === "transition") {
      const allowed = registry[kind].states[
        current.status as keyof (typeof registry)[typeof kind]["states"]
      ] as readonly string[] | undefined;
      if (!state || !allowed?.includes(state))
        throw new ApiError(409, "invalid_care_transition");
    }
    if (verb === "assign" && assignee) {
      const user = (
        await client.query<{ role: string }>(
          "SELECT role FROM users WHERE id=$1 AND is_active=true",
          [assignee],
        )
      ).rows[0];
      if (
        !user ||
        !(registry[kind].roles as readonly string[]).includes(user.role)
      )
        throw new ApiError(400, "invalid_staff_assignee");
    }
    const changed = (
      await client.query<CareRow>(
        `UPDATE ${registry[kind].table} SET status=COALESCE($2,status),assigned_staff_id=CASE WHEN $3 THEN $4::uuid ELSE assigned_staff_id END,version=version+1,updated_at=now() ${kind === "safety" ? ",next_action=COALESCE($5,next_action)" : ""} WHERE id=$1 RETURNING *`,
        kind === "safety"
          ? [id, state, verb === "assign", assignee, nextAction]
          : [id, state, verb === "assign", assignee],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO care_activity(${registry[kind].link},actor_id,kind,body,metadata) VALUES($1,$2,$3,$4,$5)`,
      [
        id,
        actor,
        verb === "transition"
          ? "state_change"
          : verb === "assign"
            ? "assignment"
            : "note",
        body,
        {
          before: snapshot(current),
          after: snapshot(changed),
          ...(nextAction ? { nextAction } : {}),
        },
      ],
    );
    const auditId = await audit(
      client,
      actor,
      kind,
      id,
      action,
      reason,
      requestKey,
      op.hash,
      snapshot(current),
      snapshot(changed),
    );
    const notification=verb==='transition'&&changed.customer_id?await createNotificationRecord(client,careNotification({userId:changed.customer_id,kind,careId:id,status:changed.status,version:changed.version})):null;
    return {result:{ id, auditId, version: changed.version },notification};
  });
  if(outcome.notification)await publishNotification(outcome.notification).catch((error:unknown)=>console.error('[notifications] care notification publish failed',error instanceof Error?error.message:'unknown'));
  return outcome.result;
}
export const careStatuses = (kind: CareKind) =>
  Object.keys(registry[kind].states);

export async function searchAdminCare(
  kind: CareKind,
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    subject: string;
    status: string;
  }>(
    `SELECT id,subject,status FROM ${registry[kind].table} WHERE (id::text=$1 OR lower(subject) LIKE $2 ESCAPE '!') AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    type: kind,
    title: row.subject,
    subtitle: row.status,
    href: `/admin/${kind}/${row.id}`,
  }));
}
