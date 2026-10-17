import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors";
import { adminId } from "./adminQuery";

export function auditInput(
  reason: unknown,
  requestKey: unknown,
): { reason: string; requestKey: string } {
  if (
    typeof reason !== "string" ||
    reason.trim().length < 5 ||
    reason.trim().length > 1000
  )
    throw new ApiError(400, "meaningful_reason_required");
  return { reason: reason.trim(), requestKey: adminId(requestKey) };
}
/** Locks a persistent staff row, so requests using one staff key cannot interleave across instances. */
export async function replayAdminOperation(
  client: PoolClient,
  actorId: string,
  action: string,
  requestKey: string,
  input: object,
  roles: readonly string[] = ["admin", "super_admin"],
): Promise<{
  hash: string;
  role: string;
  previous: { id: string; transactionId: string | null } | null;
}> {
  const staff = await client.query<{ role: string }>(
    "SELECT role FROM users WHERE id=$1 AND is_active=true FOR UPDATE",
    [actorId],
  );
  if (!staff.rows[0] || !roles.includes(staff.rows[0].role))
    throw new ApiError(403, "insufficient_permissions");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const { rows } = await client.query<{
    id: string;
    action: string;
    hash: string | null;
    transactionId: string | null;
  }>(
    `SELECT id::text,action,metadata->>'operationHash' AS hash,ledger_transaction_id AS "transactionId" FROM admin_audit_log WHERE actor_id=$1 AND request_key=$2 ORDER BY id LIMIT 1`,
    [actorId, requestKey],
  );
  if (rows[0] && (rows[0].action !== action || rows[0].hash !== hash))
    throw new ApiError(409, "idempotency_key_reused_with_different_data");
  return { hash, role: staff.rows[0].role, previous: rows[0] ?? null };
}

/** Record an authorized sensitive read before returning data. Never store document bytes or live positions. */
export async function recordAdminRead(
  actorId: string,
  action: string,
  objectType: string,
  objectId: string | null = null,
  metadata: object = {},
) {
  const { db } = await import("../config/db.js");
  await db.query(
    "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,object_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [
      actorId,
      action,
      "Authorized staff data inspection",
      objectType,
      objectId,
      metadata,
    ],
  );
}

const visibleAuditFields = new Set(["emailEnabled","welcome_rider","welcome_driver","admin_signup","application_received","admin_application","driver_approved","driver_rejected","driver_service_updates","wallet_updates","withdrawal_updates","trip_receipts","support_updates","rideServiceStatus","courierServiceStatus","vehicleCategory","rideOptIn","courierOptIn","name","active","role","version","status","state","assigneeId","priority","severity","scheduledAt","scheduled_at","vehicleType","vehicle_type","baseFareKobo","base_fare_kobo","perKmKobo","per_km_kobo","perMinuteKobo","per_min_kobo","minimumFareKobo","min_fare_kobo","commissionBps","commission_bps","is_active","minTopupKobo","maxTopupKobo","minWithdrawalKobo","maxDailyWithdrawalKobo","withdrawalFeeKobo","cashDebtLimitKobo","payoutNameMatch","newPayoutAccountCooldownHours","paystackBalanceAlertKobo","adminAdjustmentApprovalKobo","min_topup_kobo","max_topup_kobo","min_withdrawal_kobo","max_daily_withdrawal_kobo","withdrawal_fee_kobo","cash_debt_limit_kobo","payout_name_match","new_payout_account_cooldown_hours","paystack_balance_alert_kobo","admin_adjustment_approval_kobo"]);
export function visibleAuditChanges(metadata: unknown) {
  const clean = (value: unknown): Record<string,string|number|boolean|null> | null => {
    if(!value || typeof value!=="object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter(([key,v])=>visibleAuditFields.has(key) && (v===null || ["string","number","boolean"].includes(typeof v))));
  };
  if(!metadata || typeof metadata!=="object") return {before:null,after:null};
  const value=metadata as Record<string,unknown>;
  return {before:clean(value.before),after:clean(value.after)};
}
