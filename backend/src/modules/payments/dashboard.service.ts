import { visibleAuditChanges } from "../../shared/utils/adminAudit";
import {
  readAdminRows,
  type AdminPagingResult,
} from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import { recordAdminRead } from "../../shared/utils/adminAudit";
import { ApiError } from "../../shared/errors";
import { db } from "../../shared/config/db";
import {
  adminPage,
  adminQuery,
  adminId,
  entryPageQuery,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
interface Row {
  id: string;
  _cursor: string;
  [key: string]: unknown;
}
export interface FinanceQuery extends AdminQuery {
  target?: string | null;
  reference?: string | null;
  from?: string | null;
  to?: string | null;
  minKobo?: string | null;
  maxKobo?: string | null;
  userId?: string | null;
  kind?: string | null;
  ownerUserId?: string | null;
}
export function parseFinanceQuery(
  input: Record<string, unknown>,
  kind: "intents" | "withdrawals" | "accounts",
  statuses: readonly string[],
): FinanceQuery {
  const extras =
    kind === "accounts"
      ? ["kind", "ownerUserId"]
      : [
          "reference",
          "from",
          "to",
          "minKobo",
          "maxKobo",
          "userId",
          ...(kind === "intents" ? ["target"] : []),
        ];
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (extras.includes(key)) continue;
    if (!["page", "limit", "cursor", "id", "status"].includes(key))
      throw new ApiError(400, "unsupported_filter");
    base[key] = value;
  }
  const query: FinanceQuery = adminQuery(base, statuses);
  const text = (key: string, max = 200) => {
    const value = input[key];
    if (value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > max)
      throw new ApiError(400, "invalid_finance_filter");
    return value;
  };
  query.reference = text("reference", 80);
  query.target = text("target");
  query.kind = text("kind");
  if (
    (query.target && !["wallet", "earnings"].includes(query.target)) ||
    (query.kind && !["wallet", "earnings", "system"].includes(query.kind))
  )
    throw new ApiError(400, "invalid_finance_filter");
  query.userId = text("userId") ? adminId(input.userId) : null;
  query.ownerUserId = text("ownerUserId") ? adminId(input.ownerUserId) : null;
  for (const key of ["from", "to"] as const) {
    const value = text(key);
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}T/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      throw new ApiError(400, "invalid_finance_date");
    query[key] = value ? new Date(value).toISOString() : null;
  }
  if (query.from && query.to && query.from >= query.to)
    throw new ApiError(400, "invalid_finance_date_range");
  for (const key of ["minKobo", "maxKobo"] as const) {
    const value = text(key, 20);
    if (value && (!/^\d+$/.test(value) || BigInt(value) > 9223372036854775807n))
      throw new ApiError(400, "invalid_finance_amount");
    query[key] = value;
  }
  if (
    query.minKobo &&
    query.maxKobo &&
    BigInt(query.minKobo) > BigInt(query.maxKobo)
  )
    throw new ApiError(400, "invalid_finance_amount_range");
  return query;
}
const financePage = (
  rows: Row[],
  q: FinanceQuery,
  basis: string,
  paging?: AdminPagingResult,
) => {
  const page = adminPage(rows, q, basis, paging);
  return {
    ...page,
    scope: {
      ...page.scope,
      ...Object.fromEntries(
        [
          "target",
          "reference",
          "from",
          "to",
          "minKobo",
          "maxKobo",
          "userId",
          "kind",
          "ownerUserId",
        ].map((k) => [k, q[k as keyof FinanceQuery] ?? null]),
      ),
    },
  };
};
export async function listAdminIntents(q: FinanceQuery, actorId: string) {
  const { rows, ...paging } = await readAdminRows<Row>(
    {
      select: `SELECT p.id,p.provider_reference AS reference,p.user_id AS "userId",u.full_name AS customer,p.target,p.amount_kobo::text AS "amountKobo",p.status,p.created_at AS "createdAt",p.paid_at AS "paidAt",p.created_at::text AS _cursor FROM payment_intents p JOIN users u ON u.id=p.user_id WHERE ($1::text IS NULL OR p.status::text=$1) AND ($2::uuid IS NULL OR p.id=$2) AND ($3::timestamptz IS NULL OR (p.created_at,p.id)<($3::timestamptz,$4::uuid)) AND ($6::text IS NULL OR p.target=$6) AND ($7::text IS NULL OR p.provider_reference=$7) AND ($8::uuid IS NULL OR p.user_id=$8) AND ($9::timestamptz IS NULL OR p.created_at>=$9) AND ($10::timestamptz IS NULL OR p.created_at<$10) AND ($11::bigint IS NULL OR p.amount_kobo>=$11) AND ($12::bigint IS NULL OR p.amount_kobo<=$12)`,
      orderBy: `p.created_at DESC,p.id DESC`,
      limitParameter: 5,
    },
    [
      q.status,
      q.id,
      q.cursor?.at ?? null,
      q.cursor?.id ?? null,
      q.limit + 1,
      q.target ?? null,
      q.reference ?? null,
      q.userId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.minKobo ?? null,
      q.maxKobo ?? null,
    ],
    q,
  );
  await recordAdminRead(
    actorId,
    "finance_directory_read",
    "finance_directory",
    null,
    { scope: financePage(rows, q, "created_at", paging).scope },
  );
  return financePage(rows, q, "created_at", paging);
}
export async function listAdminWithdrawals(q: FinanceQuery, actorId: string) {
  const { rows, ...paging } = await readAdminRows<Row>(
    {
      select: `SELECT w.id,u.full_name AS driver,w.amount_kobo::text AS "amountKobo",w.fee_kobo::text AS "feeKobo",p.bank_name AS bank,p.account_last4 AS "accountLastFour",w.status,w.requested_at AS "createdAt",w.provider_reference AS reference,w.attempts,w.request_tx_id AS "requestTransactionId",w.final_tx_id AS "finalTransactionId",w.requested_at::text AS _cursor FROM withdrawals w JOIN users u ON u.id=w.user_id JOIN payout_accounts p ON p.id=w.payout_account_id WHERE ($1::text IS NULL OR w.status::text=$1) AND ($2::uuid IS NULL OR w.id=$2) AND ($3::timestamptz IS NULL OR (w.requested_at,w.id)<($3::timestamptz,$4::uuid)) AND ($6::text IS NULL OR w.provider_reference=$6) AND ($7::uuid IS NULL OR w.user_id=$7) AND ($8::timestamptz IS NULL OR w.requested_at>=$8) AND ($9::timestamptz IS NULL OR w.requested_at<$9) AND ($10::bigint IS NULL OR w.amount_kobo>=$10) AND ($11::bigint IS NULL OR w.amount_kobo<=$11)`,
      orderBy: `w.requested_at DESC,w.id DESC`,
      limitParameter: 5,
    },
    [
      q.status,
      q.id,
      q.cursor?.at ?? null,
      q.cursor?.id ?? null,
      q.limit + 1,
      q.reference ?? null,
      q.userId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.minKobo ?? null,
      q.maxKobo ?? null,
    ],
    q,
  );
  await recordAdminRead(
    actorId,
    "withdrawal_directory_read",
    "withdrawal_directory",
    null,
    { scope: financePage(rows, q, "requested_at", paging).scope },
  );
  return financePage(rows, q, "requested_at", paging);
}
export async function listAdminAccounts(q: FinanceQuery, actorId: string) {
  const { rows, ...paging } = await readAdminRows<Row>(
    {
      select: `SELECT a.id,COALESCE(u.full_name,a.code) AS owner,CASE a.kind WHEN 'user_wallet' THEN 'wallet' WHEN 'driver_earnings' THEN 'earnings' ELSE 'system' END AS kind,a.type,a.normal_side AS "normalSide",a.currency,a.balance_kobo::text AS "balanceKobo",a.is_frozen AS frozen,a.updated_at AS "updatedAt",a.created_at::text AS _cursor FROM ledger_accounts a LEFT JOIN users u ON u.id=a.owner_user_id WHERE ($1::uuid IS NULL OR a.id=$1) AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::uuid)) AND ($5::text IS NULL OR CASE a.kind WHEN 'user_wallet' THEN 'wallet' WHEN 'driver_earnings' THEN 'earnings' ELSE 'system' END=$5) AND ($6::uuid IS NULL OR a.owner_user_id=$6)`,
      orderBy: `a.created_at DESC,a.id DESC`,
      limitParameter: 4,
    },
    [
      q.id,
      q.cursor?.at ?? null,
      q.cursor?.id ?? null,
      q.limit + 1,
      q.kind ?? null,
      q.ownerUserId ?? null,
    ],
    q,
  );
  await recordAdminRead(
    actorId,
    "finance_directory_read",
    "finance_directory",
    null,
    { scope: financePage(rows, q, "created_at", paging).scope },
  );
  return financePage(rows, q, "created_at", paging);
}
export async function getAdminReconciliation() {
  const [accounts, exceptions] = await Promise.all([
    db.query(
      `SELECT code,balance_kobo::text AS "balanceKobo",updated_at AS "updatedAt" FROM ledger_accounts WHERE code IN ('gateway_balance','payout_in_transit','escrow_trips','suspense')`,
    ),
    db.query(
      `SELECT 'Top-up mismatches' AS kind,COUNT(*)::text AS count FROM payment_intents WHERE status='mismatch' UNION ALL SELECT 'Unresolved withdrawals',COUNT(*)::text FROM withdrawals WHERE status IN ('pending','processing') UNION ALL SELECT 'Terminal trips with held funds',COUNT(*)::text FROM trips WHERE payment_status='held' AND status IN ('completed','returned','cancelled','no_drivers_found') UNION ALL SELECT 'Unprocessed webhooks',COUNT(*)::text FROM payment_webhook_events WHERE status IN ('received','failed') UNION ALL SELECT 'Fulfilled trips without settlement evidence',COUNT(*)::text FROM trips t WHERE t.status IN ('completed','returned') AND (t.payment_status<>'settled' OR NOT EXISTS (SELECT 1 FROM ledger_transactions l WHERE l.id=t.settle_tx_id AND l.reference_type='trip' AND l.reference_id=t.id AND l.type=CASE WHEN t.payment_method='wallet' THEN 'trip_settlement_wallet'::ledger_tx_type ELSE 'trip_commission_cash'::ledger_tx_type END))`,
    ),
  ]);
  let observation:{balanceKobo:string;observedAt:string}|null=null;
  try {
    const {ensureRedis}=await import('../../shared/config/redis.js');
    const {env}=await import('../../config/env.js');
    const mode=env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')?'live':'test';
    const value=await (await ensureRedis()).get(`rakky:finance:provider-balance:${mode}`);
    if(value){const parsed=JSON.parse(value) as {balanceKobo:string;observedAt:string};if(/^\d+$/.test(parsed.balanceKobo) && Number.isFinite(Date.parse(parsed.observedAt))) observation=parsed;}
  } catch { /* Missing observation stays explicit; ledger reads still work. */ }
  return {
    accounts: accounts.rows,
    exceptions: exceptions.rows,
    providerBalanceKobo: observation?.balanceKobo ?? null,
    providerObservedAt: observation?.observedAt ?? null,
    asOf: new Date().toISOString(),
    coverage:
      "Derived current queues. Provider balance reflects the last scheduled balance check, retained for 24 hours; no observation means unknown. Use internal care cases to record investigations.",
  };
}
export function auditQuery(input: Record<string, unknown>) {
  if (
    Object.keys(input).some(
      (key) =>
        !["page", "before", "limit", "action", "objectId", "actorId", "from", "to"].includes(
          key,
        ),
    )
  )
    throw new ApiError(400, "unsupported_filter");
  const action =
    input.action === undefined || input.action === "" ? null : input.action;
  if (
    action !== null &&
    (typeof action !== "string" || !/^[a-z][a-z0-9_]{2,79}$/.test(action))
  )
    throw new ApiError(400, "invalid_action_filter");
  const id = (name: string) =>
    input[name] === undefined || input[name] === ""
      ? null
      : adminId(input[name]).toLowerCase();
  const date=(key:string)=>{
    const value=input[key];if(value===undefined || value==="") return null;
    if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new ApiError(400,"invalid_audit_date");
    return new Date(value).toISOString();
  };
  const from=date("from"),to=date("to");
  if(from && to && Date.parse(to)<=Date.parse(from)) throw new ApiError(400,"invalid_audit_date_range");
  return {
    from,to,
    ...entryPageQuery({
      page: input.page,
      before: input.before,
      limit: input.limit,
    }),
    action: action as string | null,
    objectId: id("objectId"),
    actorId: id("actorId"),
  };
}
export async function getAdminAudit(
  query: ReturnType<typeof auditQuery>,
  role = "admin",
) {
  const { rows, ...paging } = await readAdminRows(
    {
      select: `SELECT a.id::text,a.action,a.actor_id AS "actorId",u.full_name AS actor,a.target_user_id AS "targetUserId",a.reason,a.ledger_transaction_id AS "transactionId",a.object_type AS "objectType",a.object_id AS "objectId",a.before_version AS "beforeVersion",a.after_version AS "afterVersion",a.request_key AS "requestKey",a.metadata,a.created_at AS "createdAt" FROM admin_audit_log a JOIN users u ON u.id=a.actor_id WHERE ($1::bigint IS NULL OR a.id<$1) AND ($3='super_admin' OR (COALESCE(a.object_type,'')<>'safety' AND a.action NOT LIKE 'safety_%')) AND ($4::text IS NULL OR a.action=$4) AND ($5::uuid IS NULL OR a.object_id=$5 OR a.target_user_id=$5) AND ($6::uuid IS NULL OR a.actor_id=$6) AND ($7::timestamptz IS NULL OR a.created_at>=$7) AND ($8::timestamptz IS NULL OR a.created_at<$8)`,
      orderBy: `a.id DESC`,
      limitParameter: 2,
    },
    [
      query.before,
      query.limit + 1,
      role,
      query.action,
      query.objectId,
      query.actorId,
      query.from,query.to,
    ],
    query,
  );
  return {
    items: rows.slice(0, query.limit).map(({metadata,...row}) => ({...row, changes: visibleAuditChanges(metadata)})),
    pagination: paging.pagination,
    count:
      paging.total === undefined
        ? undefined
        : { value: paging.total, exact: true },
    asOf: new Date().toISOString(),
    coverage:
      "Append-only staff reads/searches, exports, payment actions, driver reviews, configuration changes, and care activity. Other legacy system actions are not yet audited.",
    nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    limited: false,
  };
}

export async function getAdminAccount(
  id: string,
  query: { page?: number | null; before: string | null; limit: number },
  actorId: string,
) {
  const account = (
    await db.query(
      `SELECT a.id,a.owner_user_id AS "ownerUserId",COALESCE(u.full_name,a.code) AS owner,a.kind,a.type,a.normal_side AS "normalSide",a.currency,a.balance_kobo::text AS "balanceKobo",a.is_frozen AS frozen,a.updated_at AS "updatedAt" FROM ledger_accounts a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
  if (!account) throw new ApiError(404, "account_not_found");
  const { rows: entries, ...paging } = await readAdminRows(
    {
      select: `SELECT e.id::text,e.transaction_id AS "transactionId",t.type,t.description,e.direction,e.amount_kobo::text AS "amountKobo",e.balance_after_kobo::text AS "balanceAfterKobo",e.created_at AS "createdAt" FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.account_id=$1 AND ($2::bigint IS NULL OR e.id<$2)`,
      orderBy: "e.id DESC",
      limitParameter: 3,
    },
    [id, query.before, query.limit + 1],
    query,
  );
  await recordAdminRead(actorId, "ledger_account_read", "ledger_account", id);
  return {
    ...account,
    entries: entries.slice(0, query.limit),
    pagination: paging.pagination,
    nextEntryId:
      entries.length > query.limit ? entries[query.limit - 1].id : null,
    historyLimited: false,
    asOf: new Date().toISOString(),
  };
}
export async function getAdminTransaction(id: string, actorId: string) {
  const transaction = (
    await db.query(
      `SELECT id,type,reference_type AS "referenceType",reference_id AS "referenceId",description,created_by AS "actorId",created_at AS "createdAt" FROM ledger_transactions WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!transaction) throw new ApiError(404, "transaction_not_found");
  const entries = (
    await db.query(
      `SELECT e.id::text,a.code,a.type,a.normal_side AS "normalSide",e.direction,e.amount_kobo::text AS "amountKobo",e.balance_after_kobo::text AS "balanceAfterKobo" FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE e.transaction_id=$1 ORDER BY e.id`,
      [id],
    )
  ).rows;
  await recordAdminRead(
    actorId,
    "ledger_transaction_read",
    "ledger_transaction",
    id,
  );
  return { ...transaction, entries, asOf: new Date().toISOString() };
}
export async function refundEligibility(tripId: string) {
  const trip = (
    await db.query<{
      id: string;
      riderId: string;
      riderName: string;
      status: string;
      fareKobo: string;
      paymentStatus: string;
      settlementEvidence: boolean;
    }>(
      `SELECT t.id,t.rider_id AS "riderId",u.full_name AS "riderName",t.status,t.fare_kobo::text AS "fareKobo",t.payment_status AS "paymentStatus",EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.id=t.settle_tx_id AND l.reference_type='trip' AND l.reference_id=t.id AND l.type=CASE WHEN t.payment_method='wallet' THEN 'trip_settlement_wallet'::ledger_tx_type ELSE 'trip_commission_cash'::ledger_tx_type END) AS "settlementEvidence" FROM trips t JOIN users u ON u.id=t.rider_id WHERE t.id=$1`,
      [tripId],
    )
  ).rows[0];
  if (!trip) throw new ApiError(404, "trip_not_found");
  const prior = (
    await db.query<{ amount: string }>(
      `SELECT COALESCE(SUM(e.amount_kobo),0)::text AS amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id WHERE t.type='refund' AND t.reference_type='trip' AND t.reference_id=$1 AND e.direction='credit'`,
      [tripId],
    )
  ).rows[0].amount;
  return {
    ...trip,
    refundedKobo: prior,
    remainingKobo: (BigInt(trip.fareKobo) - BigInt(prior)).toString(),
    eligible:
      trip.status === "completed" && trip.paymentStatus === "settled" && trip.settlementEvidence && BigInt(prior) < BigInt(trip.fareKobo),
    ineligibleReason: trip.status !== "completed" ? "trip_not_completed" : trip.paymentStatus !== "settled" || !trip.settlementEvidence ? "trip_settlement_evidence_required" : BigInt(prior) >= BigInt(trip.fareKobo) ? "fare_already_refunded" : null,
    destination: "Rider wallet",
    asOf: new Date().toISOString(),
  };
}
export async function adminOperationStatus(actorId: string, key: string) {
  const record = (
    await db.query(
      `SELECT id::text,action,object_id AS "objectId",ledger_transaction_id AS "transactionId",created_at AS "createdAt" FROM admin_audit_log WHERE actor_id=$1 AND request_key=$2 ORDER BY id LIMIT 1`,
      [actorId, key],
    )
  ).rows[0];
  return record
    ? { state: "confirmed", ...record }
    : {
        state: "unknown",
        message:
          "No completed audit record was found. An in-flight request may still complete; retry only the identical operation with its original key.",
      };
}

export async function adminMoneyPeriod(from: string, to: string) {
  const { rows } = await db.query<{ code: string; amountKobo: string }>(
    `SELECT a.code,COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)::text AS "amountKobo" FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id AND e.created_at >= $1 AND e.created_at < $2 WHERE a.code IN ('revenue_commission','revenue_fees','expense_gateway_fees','expense_refunds','expense_adjustments') GROUP BY a.code ORDER BY a.code`,
    [from, to],
  );
  return rows;
}

export async function getAdminIntent(id: string, actorId: string) {
  const row = (
    await db.query(
      `SELECT p.id,p.user_id AS "userId",u.full_name AS customer,p.target,p.amount_kobo::text AS "amountKobo",p.status,p.provider,p.provider_reference AS reference,p.channel,p.fee_kobo::text AS "feeKobo",p.failure_reason AS "failureReason",p.created_at AS "createdAt",p.paid_at AS "paidAt",p.updated_at AS "updatedAt",p.ledger_transaction_id AS "transactionId" FROM payment_intents p JOIN users u ON u.id=p.user_id WHERE p.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "payment_intent_not_found");
  const events = (
    await db.query(
      `SELECT id::text,event_type AS type,status,received_at AS "receivedAt",processed_at AS "processedAt" FROM payment_webhook_events WHERE payload->'data'->>'reference'=$1 ORDER BY id DESC LIMIT 50`,
      [row.reference],
    )
  ).rows;
  await recordAdminRead(actorId, "payment_intent_read", "payment_intent", id);
  return {
    ...row,
    webhooks: events,
    webhookHistoryLimited: events.length === 50,
    providerObservation: null,
    providerObservedAt: null,
    asOf: new Date().toISOString(),
  };
}
export async function getAdminWithdrawal(id: string, actorId: string) {
  const row = (
    await db.query(
      `SELECT w.id,w.user_id AS "userId",u.full_name AS driver,w.amount_kobo::text AS "amountKobo",w.fee_kobo::text AS "feeKobo",p.bank_name AS bank,p.account_last4 AS "accountLastFour",w.status,w.requested_at AS "createdAt",w.updated_at AS "updatedAt",w.completed_at AS "completedAt",w.provider_reference AS reference,w.attempts,w.failure_reason AS "failureReason",w.request_tx_id AS "requestTransactionId",w.final_tx_id AS "finalTransactionId" FROM withdrawals w JOIN users u ON u.id=w.user_id JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "withdrawal_not_found");
  await recordAdminRead(actorId, "withdrawal_read", "withdrawal", id);
  return {
    ...row,
    providerObservation: null,
    providerObservedAt: null,
    asOf: new Date().toISOString(),
  };
}
export async function reconciliationExceptions(
  kind: string,
  q: AdminQuery,
  actorId: string,
) {
  if (q.service || q.mode || q.status)
    throw new ApiError(400, "unsupported_filter");
  if (kind === "topups")
    return listAdminIntents({ ...q, status: "mismatch" }, actorId);
  if (kind === "withdrawals") {
    await recordAdminRead(
      actorId,
      "reconciliation_queue_read",
      "reconciliation_queue",
      null,
      { kind },
    );
    const { rows, ...paging } = await readAdminRows<Row>(
      {
        select: `SELECT id,status,provider_reference AS reference,amount_kobo::text AS "amountKobo",requested_at AS "createdAt",requested_at::text AS _cursor FROM withdrawals WHERE status IN ('pending','processing') AND ($1::timestamptz IS NULL OR (requested_at,id)<($1::timestamptz,$2::uuid)) AND ($3::uuid IS NULL OR id=$3)`,
        orderBy: `requested_at DESC,id DESC`,
        limitParameter: 4,
      },
      [q.cursor?.at ?? null, q.cursor?.id ?? null, q.id, q.limit + 1],
      q,
    );
    return adminPage(rows, q, "requested_at", paging);
  }
  if (kind === "escrow" || kind === "unsettled") {
    await recordAdminRead(
      actorId,
      "reconciliation_queue_read",
      "reconciliation_queue",
      null,
      { kind },
    );
    const { rows, ...paging } = await readAdminRows<Row>(
      {
        select: `SELECT id,status,service_type AS service,fare_kobo::text AS "amountKobo",payment_method AS "paymentMethod",payment_status AS "paymentStatus",commission_kobo::text AS "commissionKobo",CASE
          WHEN payment_method='cash' AND commission_kobo=0 AND payment_status='settled' THEN 'zero_commission_cash_no_posting'
          WHEN payment_method='cash' AND commission_kobo>0 AND EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.trip_id=trips.id AND w.user_id=trips.driver_id AND w.entry_type='driver_cash_commission_debit' AND w.amount_kobo=-trips.commission_kobo) AND EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.trip_id=trips.id AND w.entry_type='platform_commission_credit' AND w.amount_kobo=trips.commission_kobo) THEN 'legacy_cash_commission_entries'
          ELSE 'settlement_evidence_missing' END AS "evidenceClass",requested_at AS "createdAt",requested_at::text AS _cursor FROM trips WHERE ${kind === 'escrow' ? "status IN ('completed','returned','cancelled','no_drivers_found') AND payment_status='held'" : "status IN ('completed','returned') AND (payment_status<>'settled' OR NOT EXISTS (SELECT 1 FROM ledger_transactions l WHERE l.id=trips.settle_tx_id AND l.reference_type='trip' AND l.reference_id=trips.id AND l.type=CASE WHEN trips.payment_method='wallet' THEN 'trip_settlement_wallet'::ledger_tx_type ELSE 'trip_commission_cash'::ledger_tx_type END))"} AND ($1::timestamptz IS NULL OR (requested_at,id)<($1::timestamptz,$2::uuid)) AND ($3::uuid IS NULL OR id=$3)`,
        orderBy: `requested_at DESC,id DESC`,
        limitParameter: 4,
      },
      [q.cursor?.at ?? null, q.cursor?.id ?? null, q.id, q.limit + 1],
      q,
    );
    return adminPage(rows, q, "requested_at", paging);
  }
  throw new ApiError(400, "unsupported_exception_queue");
}

export async function searchAdminFinance(
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    type: "payment" | "withdrawal" | "account";
    title: string;
    status: string;
  }>(
    `SELECT * FROM (
    SELECT id,'payment'::text AS type,provider_reference AS title,status::text AS status FROM payment_intents WHERE id::text=$1 OR lower(provider_reference) LIKE $2 ESCAPE '!'
    UNION ALL SELECT id,'withdrawal',provider_reference,status::text FROM withdrawals WHERE id::text=$1 OR lower(provider_reference) LIKE $2 ESCAPE '!'
    UNION ALL SELECT a.id,'account',COALESCE(u.full_name,a.code),a.kind::text FROM ledger_accounts a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id::text=$1
    ) result WHERE ($3::text IS NULL OR (result.type,result.id)>($3::text,$4::uuid)) ORDER BY result.type,result.id LIMIT $5`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.after?.type ?? null,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  const paths = {
    payment: "payments",
    withdrawal: "withdrawals",
    account: "ledger",
  };
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title ?? row.id,
    subtitle: row.status,
    href: `/admin/${paths[row.type]}/${row.id}`,
  }));
}

/** Safe webhook envelope only: payloads, contact details and raw provider errors are excluded. */
export async function listAdminWebhookExceptions(q: ReturnType<typeof entryPageQuery>, actorId: string) {
  await recordAdminRead(actorId, "reconciliation_queue_read", "reconciliation_queue", null, {kind: "webhooks"});
  const {rows, ...paging} = await readAdminRows<{id: string}>(
    { select: `SELECT id::text,provider,event_type AS "eventType",status,received_at AS "createdAt",processed_at AS "processedAt",(error IS NOT NULL) AS "hasError" FROM payment_webhook_events WHERE status IN ('received','failed') AND ($1::bigint IS NULL OR id<$1)`, orderBy: 'id DESC', limitParameter: 2 },
    [q.before, q.limit + 1], q);
  return {items: rows.slice(0,q.limit), pagination: paging.pagination, nextCursor: rows.length>q.limit ? rows[q.limit-1].id : null, asOf: new Date().toISOString()};
}
