import { readAdminRows } from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import { adminDriverPosition } from "../location/admin.service";
import {
  auditInput,
  recordAdminRead,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import { createHash } from "node:crypto";
import { db, inTransaction } from "../../shared/config/db";
import { ApiError } from "../../shared/errors";
import { transitionTrip } from "./tripStateMachine";
import type { TripRow } from "./trip.types";
import { releaseTripHold } from "../payments/tripPayments.service";
import { emitTripStatus } from "./tripSocket";
import { emitWalletUpdated } from "../../websocket/notifications";
import {
  adminPage,
  adminId,
  adminQuery,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
export const adminTripStatuses = [
  "scheduled",
  "searching",
  "driver_assigned",
  "driver_arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_drivers_found",
  "returning",
  "returned",
] as const;
const tripProjection = `t.id,t.service_type AS service,t.status,t.pickup_address AS pickup,t.dropoff_address AS destination,
 t.rider_id AS "riderId",r.full_name AS "riderName",t.driver_id AS "driverId",d.full_name AS "driverName",
 t.requested_at AS "requestedAt",t.scheduled_at AS "scheduledAt",t.updated_at AS "updatedAt",t.updated_at::text AS version,
 t.payment_method AS "paymentMethod",t.payment_status AS "paymentStatus",t.fare_kobo::text AS "fareKobo",'NGN' AS currency,
 NULL AS "locationAt",'[]'::json AS timeline,'[]'::json AS "allowedActions",
 CASE WHEN t.service_type='courier' THEN json_build_object('recipientMasked','Contact restricted','weightKg',t.courier_details->'weightKg','failedAttempts',t.delivery_attempts,'resets',t.delivery_reset_count,'returnReason',t.delivery_issue_reason) ELSE NULL END AS courier`;
interface TripRead {
  id: string;
  _cursor: string;
  [key: string]: unknown;
}

export async function updateAdminSchedule(
  actorId: string,
  tripId: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_schedule_update");
  const audit = auditInput(input.reason, input.requestKey);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "action",
          "scheduledAt",
          "expectedVersion",
          "reason",
          "requestKey",
        ].includes(key),
    ) ||
    !["cancel", "reschedule"].includes(String(input.action)) ||
    typeof input.expectedVersion !== "string"
  )
    throw new ApiError(400, "invalid_schedule_update");
  let scheduledAt: Date | undefined;
  if (input.action === "reschedule") {
    if (
      typeof input.scheduledAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
        input.scheduledAt,
      )
    )
      throw new ApiError(400, "invalid_scheduled_time");
    scheduledAt = new Date(input.scheduledAt);
    if (!Number.isFinite(scheduledAt.getTime()))
      throw new ApiError(400, "invalid_scheduled_time");
  } else if (input.scheduledAt !== undefined)
    throw new ApiError(400, "invalid_schedule_update");
  const result = await inTransaction(async (client) => {
    const operation = await replayAdminOperation(
      client,
      actorId,
      "schedule_update",
      audit.requestKey,
      { tripId, ...input, reason: audit.reason },
      ["super_admin"],
    );
    const rider = (
      await client.query<{ rider_id: string }>(
        "SELECT rider_id FROM trips WHERE id=$1",
        [tripId],
      )
    ).rows[0];
    if (!rider) throw new ApiError(404, "trip_not_found");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      rider.rider_id,
    ]);
    const before = (
      await client.query<TripRow & { version: string }>(
        "SELECT *,updated_at::text AS version FROM trips WHERE id=$1 FOR UPDATE",
        [tripId],
      )
    ).rows[0];
    if (operation.previous)
      return { trip: before, auditId: operation.previous.id };
    if (scheduledAt) {
      const delay = scheduledAt.getTime() - Date.now();
      if (delay < 30 * 60_000 || delay > 7 * 86400_000)
        throw new ApiError(400, "scheduled_time_out_of_range");
    }
    if (before.version !== input.expectedVersion)
      throw new ApiError(409, "trip_changed");
    if (before.status !== "scheduled" || before.service_type !== "ride")
      throw new ApiError(409, "schedule_already_dispatched");
    let after: TripRow;
    if (scheduledAt) {
      const overlapping = await client.query(
        `SELECT id FROM trips WHERE rider_id=$1 AND id<>$2 AND status='scheduled' AND scheduled_at<$3 AND scheduled_at+(estimated_duration_s*interval '1 second')+interval '30 minutes'>$4 LIMIT 1`,
        [
          before.rider_id,
          tripId,
          new Date(
            scheduledAt.getTime() +
              before.estimated_duration_s * 1000 +
              30 * 60_000,
          ),
          scheduledAt,
        ],
      );
      if (overlapping.rowCount)
        throw new ApiError(409, "scheduled_trip_overlaps_existing");
      after = (
        await client.query<TripRow>(
          "UPDATE trips SET scheduled_at=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [tripId, scheduledAt],
        )
      ).rows[0];
    } else {
      after = await transitionTrip(client, {
        tripId,
        from: "scheduled",
        to: "cancelled",
        actorId,
        actorType: "system",
        fields: {
          cancelled_by: "system",
          cancel_reason: audit.reason.slice(0, 200),
          cancelled_at: new Date(),
        },
        metadata: { staffAction: true, reason: audit.reason },
      });
      await releaseTripHold(client, before);
      if (before.payment_status === "held") after.payment_status = "released";
    }
    const saved = (
      await client.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor_id,action,request_key,reason,object_type,object_id,metadata) VALUES($1,'schedule_update',$2,$3,'trip',$4,$5) RETURNING id::text`,
        [
          actorId,
          audit.requestKey,
          audit.reason,
          tripId,
          {
            operationHash: operation.hash,
            action: input.action,
            before: { status: before.status, scheduledAt: before.scheduled_at },
            after: { status: after.status, scheduledAt: after.scheduled_at },
          },
        ],
      )
    ).rows[0];
    return { trip: after, auditId: saved.id };
  });
  emitTripStatus(result.trip);
  if (result.trip.payment_status === "released")
    emitWalletUpdated(result.trip.rider_id);
  return {
    id: tripId,
    status: result.trip.status,
    scheduledAt: result.trip.scheduled_at,
    auditId: result.auditId,
  };
}
export interface TripAdminQuery extends AdminQuery {
  riderId: string | null;
  driverId: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  order: "asc" | "desc";
  dateBasis: string;
  from: string | null;
  to: string | null;
}
export function parseAdminTripQuery(
  input: Record<string, unknown>,
): TripAdminQuery {
  const base: Record<string, unknown> = {},
    extra = new Set([
      "riderId",
      "driverId",
      "paymentMethod",
      "paymentStatus",
      "order",
      "dateBasis",
      "from",
      "to",
    ]);
  for (const [key, value] of Object.entries(input))
    if (!extra.has(key)) base[key] = value;
  const q = adminQuery(base, adminTripStatuses, [
    "live",
    "scheduled",
    "scheduled_history",
    "courier_exceptions",
  ]);
  const option = (
    key: string,
    allowed: readonly string[],
    fallback: string | null = null,
  ) => {
    const value = input[key];
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !allowed.includes(value))
      throw new ApiError(400, "invalid_trip_filter");
    return value;
  };
  const date = (key: string) => {
    const value = input[key];
    if (value === undefined || value === "") return null;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new ApiError(400, "invalid_trip_date");
    return new Date(value).toISOString();
  };
  const from = date("from"),
    to = date("to");
  if (from && to && Date.parse(to) <= Date.parse(from))
    throw new ApiError(400, "invalid_trip_date_range");
  return {
    ...q,
    order: option("order", ["asc", "desc"], q.mode === "scheduled" ? "asc" : "desc") as "asc" | "desc",
    riderId: input.riderId ? adminId(input.riderId) : null,
    driverId: input.driverId ? adminId(input.driverId) : null,
    paymentMethod: option("paymentMethod", ["cash", "wallet"]),
    paymentStatus: option("paymentStatus", [
      "unpaid",
      "held",
      "settled",
      "released",
    ]),
    dateBasis: option(
      "dateBasis",
      ["requested", "scheduled", "fulfilled"],
      "requested",
    )!,
    from,
    to,
  };
}
export async function listAdminTrips(query: TripAdminQuery) {
  const sortTime =
    query.mode === "scheduled" || query.mode === "scheduled_history"
      ? "COALESCE(t.scheduled_at,t.requested_at)"
      : "t.requested_at";
  const ascending = query.order === "asc";
  const { rows, ...paging } = await readAdminRows<TripRead>(
    {
      select: `SELECT ${tripProjection},${sortTime}::text AS _cursor FROM trips t JOIN users r ON r.id=t.rider_id LEFT JOIN users d ON d.id=t.driver_id
 WHERE ($1::text IS NULL OR t.status::text=$1) AND ($2::text IS NULL OR t.service_type=$2)
 AND ($3::text IS NULL OR ($3='scheduled' AND t.scheduled_at IS NOT NULL AND t.status NOT IN ('completed','returned','cancelled','no_drivers_found')) OR ($3='scheduled_history' AND t.scheduled_at IS NOT NULL) OR ($3='courier_exceptions' AND t.service_type='courier' AND (t.status='returning' OR (t.status='in_progress' AND (t.delivery_attempts>=5 OR t.delivery_reset_count>=2)))) OR ($3='live' AND t.status IN ('searching','driver_assigned','driver_arrived','in_progress','returning')))
 AND ($4::uuid IS NULL OR t.id=$4) AND ($5::timestamptz IS NULL OR (${sortTime},t.id)${ascending ? ">" : "<"}($5::timestamptz,$6::uuid))
 AND ($8::uuid IS NULL OR t.rider_id=$8) AND ($9::uuid IS NULL OR t.driver_id=$9)
 AND ($10::text IS NULL OR t.payment_method::text=$10) AND ($11::text IS NULL OR t.payment_status=$11)
 AND ($13::timestamptz IS NULL OR (CASE $12 WHEN 'scheduled' THEN t.scheduled_at WHEN 'fulfilled' THEN COALESCE(t.returned_at,t.completed_at) ELSE t.requested_at END)>=$13)
 AND ($14::timestamptz IS NULL OR (CASE $12 WHEN 'scheduled' THEN t.scheduled_at WHEN 'fulfilled' THEN COALESCE(t.returned_at,t.completed_at) ELSE t.requested_at END)<$14)`,
      orderBy: `${sortTime} ${ascending ? "ASC" : "DESC"},t.id ${ascending ? "ASC" : "DESC"}`,
      limitParameter: 7,
    },
    [
      query.status,
      query.service,
      query.mode,
      query.id,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
      query.riderId,
      query.driverId,
      query.paymentMethod,
      query.paymentStatus,
      query.dateBasis,
      query.from,
      query.to,
    ],
    query,
  );
  return {
    ...adminPage(rows, query, "requested_at", paging),
    scope: {
      ...adminPage(rows, query, "requested_at", paging).scope,
      sortBasis: `${query.mode?.startsWith("scheduled") ? "scheduled_at" : "requested_at"} ${query.order}`,
      order: query.order,
      dateBasis: query.dateBasis,
      from: query.from,
      to: query.to,
      paymentMethod: query.paymentMethod,
      paymentStatus: query.paymentStatus,
      riderId: query.riderId,
      driverId: query.driverId,
    },
  };
}
export async function getAdminTrip(id: string, actorId: string) {
  const { rows } = await db.query<TripRead>(
    `SELECT ${tripProjection},t.pickup_lat AS "pickupLat",t.pickup_lng AS "pickupLng",t.dropoff_lat AS "dropoffLat",t.dropoff_lng AS "dropoffLng",t.commission_bps_snapshot AS "commissionBps",t.commission_kobo::text AS "commissionKobo",t.driver_earning_kobo::text AS "driverEarningKobo",t.hold_tx_id AS "holdTransactionId",t.settle_tx_id AS "settleTransactionId",t.estimated_distance_m AS "estimatedDistanceM",t.estimated_duration_s AS "estimatedDurationS",t.cancel_reason AS "cancelReason" FROM trips t JOIN users r ON r.id=t.rider_id LEFT JOIN users d ON d.id=t.driver_id WHERE t.id=$1`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, "trip_not_found");
  const history = await db.query(
    `SELECT to_status AS status,created_at AS at,actor_type AS actor,metadata->>'reason' AS reason FROM trip_status_history WHERE trip_id=$1 ORDER BY created_at,id`,
    [id],
  );
  const [offers, feedback, cases, refunds, samples, currentPosition] =
    await Promise.all([
      db.query(
        `SELECT o.id,o.status,u.full_name AS driver,o.sent_at AS "sentAt",o.responded_at AS "respondedAt",o.expires_at AS "expiresAt" FROM trip_offers o JOIN users u ON u.id=o.driver_id WHERE o.trip_id=$1 ORDER BY o.sent_at,o.id`,
        [id],
      ),
      db.query(
        `SELECT r.id,r.rating,r.comment,u.full_name AS rater,r.created_at AS "createdAt" FROM trip_ratings r JOIN users u ON u.id=r.rater_id WHERE r.trip_id=$1 ORDER BY r.created_at,r.id`,
        [id],
      ),
      db.query(
        `SELECT id,subject,status FROM support_cases WHERE trip_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [id],
      ),
      db.query(
        `SELECT id,created_at AS "createdAt" FROM ledger_transactions WHERE type='refund' AND reference_type='trip' AND reference_id=$1 ORDER BY created_at,id`,
        [id],
      ),
      db.query<{
        latitude: number;
        longitude: number;
        at: Date;
        total: string;
      }>(
        `SELECT lat AS latitude,lng AS longitude,recorded_at AS at,COUNT(*) OVER()::text AS total FROM trip_locations WHERE trip_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 200`,
        [id],
      ),
      adminDriverPosition(
        typeof rows[0].driverId === "string" ? rows[0].driverId : null,
        [
          "driver_assigned",
          "driver_arrived",
          "in_progress",
          "returning",
        ].includes(String(rows[0].status)),
      ),
    ]);
  await recordAdminRead(actorId, "trip_context_read", "trip", id);
  return {
    ...rows[0],
    currentPosition,
    sampledPositions: {
      items: samples.rows.map(({ total, ...point }) => point).reverse(),
      total: Number(samples.rows[0]?.total ?? 0),
      limit: 200,
    },
    offers: offers.rows,
    feedback: feedback.rows,
    supportCases: cases.rows,
    refunds: refunds.rows,
    timeline: history.rows,
    asOf: new Date().toISOString(),
  };
}
export async function getAdminOverview(role = "admin", day?: string) {
  if (
    day &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(`${day}T00:00:00+01:00`)) ||
      new Date(`${day}T00:00:00+01:00`).toLocaleDateString("en-CA", {
        timeZone: "Africa/Lagos",
      }) !== day)
  )
    throw new ApiError(400, "invalid_overview_day");
  const today =
    day ??
    new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Lagos",
    });
  const from = new Date(`${today}T00:00:00+01:00`).toISOString();
  const to = new Date(new Date(from).getTime() + 86400000).toISOString();
  const { adminAvailableCount } = await import("../location/admin.service.js");
  const [counts, commission, available, attention, hourly] = await Promise.all([
    db.query<{ active: string; completed: string }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress','returning'))::text AS active,COUNT(*) FILTER (WHERE service_type='ride' AND status='completed' AND completed_at >= $1 AND completed_at < $2)::text AS completed FROM trips`,
      [from, to],
    ),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)::text AS total FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.code='revenue_commission' AND e.created_at >= $1 AND e.created_at < $2`,
      [from, to],
    ),
    adminAvailableCount(),
    db.query<{
      id: string;
      title: string;
      href: string;
      severity: string;
      observedAt: Date;
      detail: string;
    }>(
      `
      SELECT * FROM (
      SELECT id,'Courier return or locked handoff' AS title,'/admin/trips/'||id AS href,'warning' AS severity,updated_at AS "observedAt",status::text AS detail FROM trips WHERE service_type='courier' AND (status='returning' OR (status='in_progress' AND delivery_attempts>=5))
      UNION ALL SELECT id,'Overdue scheduled activation','/admin/trips/'||id,'warning',scheduled_at,'Scheduled booking past activation time' FROM trips WHERE status='scheduled' AND scheduled_at<now()
      UNION ALL SELECT id,'Payment mismatch','/admin/payments/'||id,'danger',updated_at,'Verified amount or currency mismatch' FROM payment_intents WHERE status='mismatch'
      UNION ALL SELECT id,'Unresolved withdrawal','/admin/withdrawals/'||id,'warning',requested_at,'Outcome requires reconciliation' FROM withdrawals WHERE (status='pending' AND requested_at<now()-interval '2 minutes') OR (status='processing' AND updated_at<now()-interval '15 minutes')
      UNION ALL SELECT user_id,'Pending driver application','/admin/applications/'||user_id,'neutral',COALESCE(submitted_at,created_at),'Awaiting review' FROM driver_profiles WHERE status='pending'
      UNION ALL SELECT id,'Safety incident','/admin/safety/'||id,'danger',created_at,'Restricted staff follow-up' FROM safety_incidents WHERE $1='super_admin' AND status IN ('open','acknowledged','responding')
      ) observed ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,"observedAt",id LIMIT 10`,
      [role],
    ),
    db.query<{
      hour: string;
      rideCompleted: string;
      courierDelivered: string;
      courierReturned: string;
    }>(
      `SELECT to_char(h.hour AT TIME ZONE 'Africa/Lagos','HH24:MI') AS hour,COUNT(t.id) FILTER(WHERE service_type='ride')::text AS "rideCompleted",COUNT(t.id) FILTER(WHERE service_type='courier' AND status='completed')::text AS "courierDelivered",COUNT(t.id) FILTER(WHERE service_type='courier' AND status='returned')::text AS "courierReturned" FROM generate_series($1::timestamptz,$2::timestamptz-interval '1 hour',interval '1 hour') h(hour) LEFT JOIN trips t ON t.status IN ('completed','returned') AND (CASE WHEN t.status='returned' THEN t.returned_at ELSE t.completed_at END)>=h.hour AND (CASE WHEN t.status='returned' THEN t.returned_at ELSE t.completed_at END)<h.hour+interval '1 hour' GROUP BY h.hour ORDER BY h.hour`,
      [from, to],
    ),
  ]);
  return {
    hourly: hourly.rows,
    activeTrips: Number(counts.rows[0].active),
    availableDrivers: available,
    completedRides: Number(counts.rows[0].completed),
    commissionKobo: commission.rows[0].total,
    attention: attention.rows,
    attentionAvailable: true,
    asOf: new Date().toISOString(),
    scope: { dateBasis: "completed_at / ledger posting time", from, to },
    limitations: [
      "Driver counts are unavailable if Redis fails or the scan exceeds 1,000 approved drivers. Attention is derived, without read/unread state.",
    ],
  };
}

export function reportRange(input: Record<string, unknown>) {
  for (const key of Object.keys(input))
    if (!["from", "to", "service"].includes(key))
      throw new ApiError(400, "unsupported_filter");
  const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Lagos",
    }),
    defaultFrom = new Date(`${today}T00:00:00+01:00`);
  const from = input.from ?? defaultFrom.toISOString(),
    to = input.to ?? new Date(defaultFrom.getTime() + 86400000).toISOString(),
    service = input.service ?? null;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(to) ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(to) <= Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > 90 * 86400000 ||
    (service !== null && service !== "ride" && service !== "courier")
  )
    throw new ApiError(400, "invalid_report_range");
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    service: service as "ride" | "courier" | null,
  };
}
export async function getAdminReports(range: ReturnType<typeof reportRange>) {
  const { adminMoneyPeriod } = await import("../payments/dashboard.service.js");
  const [outcomes, value, money,operations,ratings,payments] = await Promise.all([
    db.query<{ service: string; status: string; count: string }>(
      `SELECT service_type AS service,status,COUNT(*)::text AS count FROM trips WHERE requested_at >= $1 AND requested_at < $2 AND ($3::text IS NULL OR service_type=$3) GROUP BY service_type,status ORDER BY service_type,status`,
      [range.from, range.to, range.service],
    ),
    db.query<{ settledValueKobo: string; delivered: string; returned: string }>(
      `SELECT COALESCE(SUM(fare_kobo),0)::text AS "settledValueKobo",COUNT(*) FILTER (WHERE service_type='courier' AND status='completed')::text AS delivered,COUNT(*) FILTER (WHERE service_type='courier' AND status='returned')::text AS returned FROM trips WHERE payment_status='settled' AND status IN ('completed','returned') AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END) >= $1 AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END)<$2 AND ($3::text IS NULL OR service_type=$3)`,
      [range.from, range.to, range.service],
    ),
    adminMoneyPeriod(range.from, range.to),
    db.query(`SELECT COUNT(*)::int AS requests,COUNT(*) FILTER(WHERE status='no_drivers_found')::int AS "noDriver",COUNT(*) FILTER(WHERE status='completed')::int AS completed,COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,COUNT(*) FILTER(WHERE accepted_at IS NOT NULL)::int AS assigned,ROUND(AVG(EXTRACT(EPOCH FROM accepted_at-requested_at)) FILTER(WHERE accepted_at>=requested_at),1)::text AS "meanAssignmentSeconds",(SELECT COUNT(*)::int FROM trip_offers o JOIN trips t ON t.id=o.trip_id WHERE t.requested_at>=$1 AND t.requested_at<$2 AND ($3::text IS NULL OR t.service_type=$3)) AS offers FROM trips WHERE requested_at>=$1 AND requested_at<$2 AND ($3::text IS NULL OR service_type=$3)`,[range.from,range.to,range.service]),
    db.query(`SELECT COUNT(*)::int AS count,ROUND(AVG(r.rating),2)::text AS average,COUNT(*) FILTER(WHERE r.rating<=2)::int AS "lowRatings" FROM trip_ratings r JOIN trips t ON t.id=r.trip_id WHERE r.created_at>=$1 AND r.created_at<$2 AND ($3::text IS NULL OR t.service_type=$3)`,[range.from,range.to,range.service]),
    db.query(`SELECT status,COUNT(*)::int AS count FROM payment_intents WHERE created_at>=$1 AND created_at<$2 GROUP BY status ORDER BY status`,[range.from,range.to]),
  ]);
  return {
    operations:operations.rows[0],
    ratings:ratings.rows[0],
    paymentOutcomes:payments.rows,
    outcomes: outcomes.rows,
    settlement: value.rows[0],
    ledger: money,
    asOf: new Date().toISOString(),
    scope: {
      ...range,
      outcomesDateBasis: "requested_at",
      settlementDateBasis: "completed_at / returned_at",
      ledgerDateBasis: "ledger posting time",
      ledgerServiceScope:
        "All services; ledger account postings are not filtered by trip service.",
    },
    currency: "NGN",
  };
}
export async function getAdminPricing() {
  return {
    items: (
      await db.query<FareRecord>(
        "SELECT * FROM fare_config ORDER BY vehicle_type",
      )
    ).rows.map(presentFare),
    asOf: new Date().toISOString(),
  };
}

interface FareRecord {
  vehicle_type: string;
  base_fare_kobo: string;
  per_km_kobo: string;
  per_min_kobo: string;
  min_fare_kobo: string;
  commission_bps: number;
  is_active: boolean;
  updated_at: Date;
}
const fareVersion = (row: FareRecord) =>
  createHash("sha256").update(JSON.stringify(row)).digest("hex");
function presentFare(row: FareRecord) {
  return {
    vehicleType: row.vehicle_type,
    baseFareKobo: row.base_fare_kobo,
    perKmKobo: row.per_km_kobo,
    perMinuteKobo: row.per_min_kobo,
    minimumFareKobo: row.min_fare_kobo,
    commissionBps: row.commission_bps,
    active: row.is_active,
    updatedAt: row.updated_at,
    version: fareVersion(row),
  };
}
export async function updateAdminPricing(
  actorId: string,
  vehicleType: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_pricing_input");
  const audit = auditInput(input.reason, input.requestKey);
  const moneyFields = [
    "baseFareKobo",
    "perKmKobo",
    "perMinuteKobo",
    "minimumFareKobo",
  ] as const;
  const allowed = [
    ...moneyFields,
    "commissionBps",
    "active",
    "expectedVersion",
    "reason",
    "requestKey",
  ];
  if (
    !/^[a-z][a-z0-9_]{0,19}$/.test(vehicleType) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "invalid_pricing_input");
  for (const field of moneyFields) {
    if (
      !Number.isSafeInteger(input[field]) ||
      Number(input[field]) < 0 ||
      Number(input[field]) > 1_000_000_000
    )
      throw new ApiError(400, "invalid_fare_amount");
  }
  if (
    !Number.isSafeInteger(input.commissionBps) ||
    Number(input.commissionBps) < 0 ||
    Number(input.commissionBps) > 10000 ||
    typeof input.active !== "boolean"
  )
    throw new ApiError(400, "invalid_pricing_input");
  if (
    typeof input.expectedVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedVersion)
  )
    throw new ApiError(400, "expected_pricing_version_required");
  return inTransaction(async (client) => {
    const operation = await replayAdminOperation(
      client,
      actorId,
      "pricing_update",
      audit.requestKey,
      { vehicleType, ...input, reason: audit.reason },
      ["super_admin"],
    );
    const before = (
      await client.query<FareRecord>(
        "SELECT * FROM fare_config WHERE vehicle_type=$1 FOR UPDATE",
        [vehicleType],
      )
    ).rows[0];
    if (!before) throw new ApiError(404, "fare_config_not_found");
    if (operation.previous)
      return { ...presentFare(before), auditId: operation.previous.id };
    if (fareVersion(before) !== input.expectedVersion)
      throw new ApiError(409, "pricing_changed");
    const after = (
      await client.query<FareRecord>(
        `UPDATE fare_config SET base_fare_kobo=$2,per_km_kobo=$3,per_min_kobo=$4,min_fare_kobo=$5,commission_bps=$6,is_active=$7,updated_at=now() WHERE vehicle_type=$1 RETURNING *`,
        [
          vehicleType,
          ...moneyFields.map((field) => input[field]),
          input.commissionBps,
          input.active,
        ],
      )
    ).rows[0];
    const saved = (
      await client.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor_id,action,request_key,reason,object_type,metadata) VALUES($1,'pricing_update',$2,$3,'fare_config',$4) RETURNING id::text`,
        [
          actorId,
          audit.requestKey,
          audit.reason,
          { operationHash: operation.hash, vehicleType, before, after },
        ],
      )
    ).rows[0];
    return { ...presentFare(after), auditId: saved.id };
  });
}
export async function listAdminRatings(query: AdminQuery) {
  const { rows, ...paging } = await readAdminRows<{
    id: string;
    _cursor: string;
  }>(
    {
      select: `SELECT r.id,r.trip_id AS "tripId",t.service_type AS service,r.rating,r.comment,r.created_at AS "createdAt",r.created_at::text AS _cursor,u.full_name AS rater,v.full_name AS ratee FROM trip_ratings r JOIN trips t ON t.id=r.trip_id JOIN users u ON u.id=r.rater_id JOIN users v ON v.id=r.ratee_id WHERE ($1::text IS NULL OR t.service_type=$1) AND ($2::uuid IS NULL OR r.id=$2) AND ($3::timestamptz IS NULL OR (r.created_at,r.id)<($3::timestamptz,$4::uuid))`,
      orderBy: `r.created_at DESC,r.id DESC`,
      limitParameter: 5,
    },
    [
      query.service,
      query.id,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
    ],
    query,
  );
  return adminPage(rows, query, "rating.created_at", paging);
}

export async function exportAdminReports(
  actorId: string,
  range: ReturnType<typeof reportRange>,
) {
  const report = await getAdminReports(range);
  await db.query(
    "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,metadata) VALUES($1,'report_export','Staff exported scoped aggregate report','report',$2)",
    [actorId, { scope: report.scope, asOf: report.asOf }],
  );
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const rows = [
    [
      "metric",
      "service",
      "value",
      "unit",
      "date_basis",
      "from",
      "to",
      "observed_at",
    ],
    ...Object.entries(report.operations).map(([key,value])=>["operations_"+key,range.service??"all",value===null?"unknown":String(value),key==='meanAssignmentSeconds'?'seconds':'count','requested_at',range.from,range.to,report.asOf]),
    ...Object.entries(report.ratings).map(([key,value])=>["ratings_"+key,range.service??"all",value===null?"unknown":String(value),key==='average'?'stars':'count','rating created_at',range.from,range.to,report.asOf]),
    ...report.paymentOutcomes.map(r=>["payment_intent_"+r.status,'all',String(r.count),'count','intent created_at',range.from,range.to,report.asOf]),
    ...report.outcomes.map((r) => [
      "outcome_" + r.status,
      r.service,
      r.count,
      "count",
      "requested_at",
      range.from,
      range.to,
      report.asOf,
    ]),
    [
      "settled_trip_value",
      range.service ?? "all",
      report.settlement.settledValueKobo,
      "NGN kobo",
      "completed_at / returned_at",
      range.from,
      range.to,
      report.asOf,
    ],
    ...report.ledger.map((r) => [
      r.code,
      "all",
      r.amountKobo,
      "NGN kobo",
      "ledger posting time",
      range.from,
      range.to,
      report.asOf,
    ]),
  ];
  return (
    rows
      .map((r, index) =>
        [
          ...r,
          index === 0 ? "timezone" : "Africa/Lagos (WAT)",
          index === 0 ? "currency" : "NGN",
        ]
          .map(quote)
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

export async function getAdminTripPosition(id: string, actorId: string) {
  const { rows } = await db.query<{ driverId: string | null; status: string }>(
    `SELECT driver_id AS "driverId",status FROM trips WHERE id=$1`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, "trip_not_found");
  await recordAdminRead(actorId, "trip_location_read", "trip", id);
  return adminDriverPosition(
    rows[0].driverId,
    ["driver_assigned", "driver_arrived", "in_progress", "returning"].includes(
      rows[0].status,
    ),
  );
}

/** Bounded staff lookup; no delivery codes, contact data, or route coordinates are exposed. */
export async function searchAdminTrips(
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    service: string;
    status: string;
    rider: string;
  }>(
    `SELECT t.id,t.service_type AS service,t.status,r.full_name AS rider FROM trips t JOIN users r ON r.id=t.rider_id LEFT JOIN users d ON d.id=t.driver_id WHERE (t.id::text=$1 OR lower(r.full_name) LIKE $2 ESCAPE '!' OR lower(d.full_name) LIKE $2 ESCAPE '!') AND ($3::uuid IS NULL OR t.id>$3) ORDER BY t.id LIMIT $4`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    type: "trip",
    title: `${row.service === "courier" ? "Courier" : "Passenger"} trip`,
    subtitle: `${row.rider} · ${row.status}`,
    href: `/admin/trips/${row.id}`,
  }));
}
