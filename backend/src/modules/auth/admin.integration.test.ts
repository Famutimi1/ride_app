import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readFile, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import dotenv from "dotenv";
import express from "express";
import type { AddressInfo } from "node:net";
import type { TripRow } from "../trips/trip.types";
import {
  parseStaffSearch,
  staffSearchPage,
  type StaffSearchHit,
} from "../../shared/utils/adminSearch";
import {
  adminQuery,
  adminPage,
  entryPageQuery,
} from "../../shared/utils/adminQuery";

dotenv.config();
// Explicitly enable staff mutations only inside the disposable test schema.
process.env.ENABLE_ADMIN_MONEY_ACTIONS="true";
const databaseUrl = process.env.DATABASE_URL;
test("admin query rejects invalid input and preserves microsecond pagination boundaries", () => {
  for (const input of [
    { limit: "1.5" },
    { limit: "101" },
    { status: "invented" },
    { cursor: "bad" },
    { id: "' OR true" },
    { phone: "private" },
  ])
    assert.throws(() => adminQuery(input));
  const id = "00000000-0000-0000-0000-000000000001";
  const at = "2026-10-09 10:30:00.123456+00";
  const page = adminPage(
    [
      { id, _cursor: at },
      { id: "00000000-0000-0000-0000-000000000002", _cursor: at },
    ],
    adminQuery({ limit: "1" }),
    "created_at",
  );
  assert.equal(adminQuery({ cursor: page.nextCursor! }).cursor?.at, at);
  assert.equal("_cursor" in page.items[0], false);
});
test("audit changes whitelist excludes contacts, messages and operation hashes",async()=>{
  const {visibleAuditChanges}=await import("../../shared/utils/adminAudit.js");
  assert.deepEqual(visibleAuditChanges({before:{name:"Staff",email:"SECRET",phone:"SECRET",operationHash:"SECRET"},after:{active:false,body:"SECRET"}}),{before:{name:"Staff"},after:{active:false}});
});
test("page parsing rejects mixed cursors and uses bounded row counts", () => {
  assert.equal(adminQuery({ page: "1" }).limit, 20);
  assert.equal(adminQuery({}).limit, 50);
  assert.deepEqual(entryPageQuery({ page: "2", limit: "10" }), {
    page: 2,
    before: null,
    limit: 10,
  });
  for (const input of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: ["1", "2"] },
    { page: "1", limit: "101" },
  ]) {
    assert.throws(() => adminQuery(input));
    assert.throws(() => entryPageQuery(input));
  }
  assert.throws(() => entryPageQuery({ page: "1", before: "1" }));
});
test("staff search validates literal prefixes and binds cursors to the search context", () => {
  for (const body of [
    null,
    [],
    { query: "ab" },
    { query: "x".repeat(81) },
    { query: "Ada\nOkafor" },
    { query: "Ada", scope: "unknown" },
    { query: "Ada", phone: "private" },
  ])
    assert.throws(() => parseStaffSearch(body));
  assert.equal(parseStaffSearch({ query: "%!_" }).prefix, "!%!!!_%");
  const hit: StaffSearchHit = {
    id: "00000000-0000-0000-0000-000000000001",
    type: "person",
    title: "Ada",
    subtitle: "Masked",
    href: "/admin/riders/test",
  };
  const input = parseStaffSearch({ query: "Ada", scope: "people" });
  const cursor = staffSearchPage(
    "people",
    "People",
    Array.from({ length: 21 }, () => hit),
    input,
  ).nextCursor!;
  assert.equal(
    parseStaffSearch({ query: "Ada", scope: "people", cursor }).after?.id,
    hit.id,
  );
  assert.throws(() =>
    parseStaffSearch({ query: "Bisi", scope: "people", cursor }),
  );
  assert.throws(() =>
    parseStaffSearch({ query: "Ada", scope: "trips", cursor }),
  );
  assert.throws(() => parseStaffSearch({ query: "Ada", scope: "all", cursor }));
});
test(
  "staff reads deny nonstaff, mask secrets, paginate ties and include returned escrow",
  { skip: !databaseUrl },
  async (t) => {
    const schema = `admin_dashboard_test_${process.pid}_${Date.now()}`;
    const owner = new Pool({ connectionString: databaseUrl });
    await owner.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    // Modules use the same pool as the app; redirect that pool to the disposable schema.
    const {env}=await import("../../config/env.js");
    const originalMoneyFlag=env.ENABLE_ADMIN_MONEY_ACTIONS;
    Object.assign(env,{ENABLE_ADMIN_MONEY_ACTIONS:true});
    const { db } = await import("../../shared/config/db.js");
    const originalQuery = db.query.bind(db);
    const originalConnect = db.connect.bind(db);
    db.connect = pool.connect.bind(pool) as typeof db.connect;
    db.query = pool.query.bind(pool) as typeof db.query;
    const searchKeys: string[] = [];
    const documentDirectories:string[]=[];
    let server: ReturnType<typeof express.application.listen> | undefined;
    try {
      for (const name of [
        "001_auth.sql",
        "002_trip_system.sql",
        "003_payments_ledger.sql",
        "004_scheduled_trips.sql",
        "005_courier_trips.sql",
        "006_courier_returns.sql",
        "007_courier_return_columns.sql",
        "008_driver_courier_preference.sql",
        "009_courier_code_rotation.sql",
        "010_admin_care_audit.sql",
        "011_support_settings.sql",
        "012_auth_session_scope.sql",
        "013_trip_commission_snapshot.sql",
        "014_auth_session_families.sql",
        "015_notifications.sql",
        "016_driver_service_eligibility.sql",
        "017_email_outbox.sql",
        "018_email_settings.sql",
      ])
        await pool.query(await readFile(resolve("migrations", name), "utf8"));
      const staff = (
        await pool.query<{ id: string }>(
          "INSERT INTO users(full_name,phone,role) VALUES('Admin Test','+2348000000010','admin') RETURNING id",
        )
      ).rows[0].id;
      const rider = (
        await pool.query<{ id: string }>(
          "INSERT INTO users(full_name,phone,email) VALUES('Rider Test','+2348000000011','private@example.test') RETURNING id",
        )
      ).rows[0].id;
      const { tripAdminRouter } = await import("../trips/admin.routes.js");
      const { peopleAdminRouter } = await import("./admin.routes.js");
      const { financeDashboardRouter } =
        await import("../payments/dashboard.routes.js");
      const { driverAdminRouter } = await import("../driver/admin.routes.js");
      const { locationAdminRouter } =
        await import("../location/admin.routes.js");
      const { careAdminRouter } = await import("../care/care.routes.js");
      const { paymentAdminRouter } =
        await import("../payments/admin.routes.js");
      const { signAccessToken: signFixtureAccess } = await import("./jwt.service.js");
      const signAccessToken = (user:{id:string},scope:'app'|'staff'='app') => signFixtureAccess(user,scope,scope==='staff'?{id:user.id,startedAt:new Date()}:undefined);
      await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) SELECT id,id,id::text,'staff',now()+interval '12 hours' FROM users");
      const app = express();
      app.use(express.json());
      app.use("/api/admin/payments", paymentAdminRouter);
      app.use(
        "/api/admin",
        tripAdminRouter,
        peopleAdminRouter,
        financeDashboardRouter,
        driverAdminRouter,
        locationAdminRouter,
        careAdminRouter,
      );
      app.use(
        (
          error: Error & { status?: number; code?: string },
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) => {
          res
            .status(error.status ?? 500)
            .json({ error: error.code ?? "error" });
        },
      );
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
      const get = (path: string, user?: string) =>
        fetch(base + path, {
          headers: user
            ? { Authorization: `Bearer ${signAccessToken({ id: user }, "staff")}` }
            : {},
        });
      for (const path of [
        "/trips",
        "/users",
        "/drivers",
        "/driver-applications",
        "/overview",
        "/environment",
        "/payment-intents",
        "/withdrawals",
        "/accounts",
        "/reconciliation",
        "/audit",
        "/live",
        "/reports",
        "/pricing",
        "/ratings",
        "/health",
        "/support",
      ]) {
        assert.equal((await get(path)).status, 401, path + " anonymous");
        assert.equal(
          (await get(path, rider)).status,
          403,
          path + " ordinary user",
        );
        assert.equal((await get(path, staff)).status, 200, path + " staff");
        assert.equal((await fetch(base + path, {
          headers: { Authorization: `Bearer ${signAccessToken({ id: staff })}` },
        })).status, 403, path + " staff account in ride app");
      }
      const users = (await (await get("/users", staff)).json()) as {
        items: Record<string, unknown>[];
      };
      const customer = users.items.find((item) => item.id === rider)!;
      assert.equal(customer.phone, undefined);
      assert.equal(customer.email, undefined);
      assert.equal(customer.phoneMasked, "••• 0011");
      const seedTrip = async (id: string) => {
        await pool.query(
          `INSERT INTO trips(id,rider_id,status,service_type,payment_method,payment_status,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key,courier_details,requested_at) VALUES($1,$2,'returned','courier','wallet','held',6.4,3.4,'Pickup',6.5,3.5,'Dropoff',1000,300,100000,$3,'{"recipientPhone":"SECRET","recipientName":"SECRET","weightKg":2,"code":"SECRET"}','2026-10-09T10:30:00.123456Z')`,
          [id, rider, id],
        );
      };
      await seedTrip("00000000-0000-0000-0000-000000000001");
      await seedTrip("00000000-0000-0000-0000-000000000002");
      const first = (await (await get("/trips?limit=1", staff)).json()) as {
        items: { id: string }[];
        nextCursor: string;
      };
      const second = (await (
        await get(`/trips?limit=1&cursor=${first.nextCursor}`, staff)
      ).json()) as { items: { id: string }[]; nextCursor: string | null };
      assert.equal(first.items.length, 1);
      assert.equal(second.items.length, 1);
      assert.notEqual(first.items[0].id, second.items[0].id);
      assert.equal(second.nextCursor, null);
      const detail = await (
        await get(`/trips/${first.items[0].id}`, staff)
      ).text();
      assert.equal(detail.includes("SECRET"), false);
      assert.equal(detail.includes("delivery_code"), false);
      const recon = (await (await get("/reconciliation", staff)).json()) as {
        exceptions: { kind: string; count: string }[];
      };
      assert.equal(
        recon.exceptions.find(
          (e) => e.kind === "Terminal trips with held funds",
        )?.count,
        "2",
      );
      await t.test("real trip ordering and safe webhook paging",async()=>{
        assert.equal((await get("/trips?order=invalid",staff)).status,400);
        const asc=await (await get("/trips?page=1&order=asc",staff)).json() as {items:{requestedAt:string}[]};
        assert.ok(asc.items.every((r,i)=>!i || Date.parse(r.requestedAt)>=Date.parse(asc.items[i-1].requestedAt)));
        await pool.query(`INSERT INTO payment_webhook_events(provider,dedupe_key,event_type,status,payload,error) VALUES('paystack',$1,'test.receipt','received',$3,null),('paystack',$2,'test.failure','failed',$3,'SECRET provider error')`,[randomUUID(),randomUUID(),{secret:'SECRET',contact:'PRIVATE CONTACT'}]);
        const response=await get("/reconciliation/webhooks?page=1&limit=1",staff);assert.equal(response.status,200);
        const text=await response.text();assert.equal(text.includes('SECRET'),false);assert.equal(text.includes('PRIVATE CONTACT'),false);
        const page=JSON.parse(text) as {items:{id:string;hasError:boolean}[];pagination:{total:number};nextCursor:string};
        assert.equal(page.pagination.total,2);assert.equal(page.items.length,1);
        const next=await (await get("/reconciliation/webhooks?page=2&limit=1",staff)).json() as {items:{id:string}[]};
        assert.notEqual(next.items[0].id,page.items[0].id);
      });
      assert.equal((await get("/trips?status=unknown", staff)).status, 400);
      assert.equal((await get("/trips?limit=999", staff)).status, 400);
      const applicant = (
        await pool.query<{ id: string }>(
          "INSERT INTO users(full_name) VALUES('Application Test') RETURNING id",
        )
      ).rows[0].id;
      const reviewDirectory=resolve('.private-uploads','driver-documents',applicant);
      documentDirectories.push(reviewDirectory);
      await mkdir(reviewDirectory,{recursive:true});
      const reviewReferences=await Promise.all(Array.from({length:3},async()=>{const name=`${randomUUID()}.pdf`;await writeFile(resolve(reviewDirectory,name),'%PDF-1.4\n% Disposable review fixture\n');return `private://driver-documents/${applicant}/${name}`;}));
      await pool.query(
        `INSERT INTO driver_profiles(vehicle_category,ride_service_status,service_review_details,service_consent_history,user_id,status,residential_address,vehicle_make,vehicle_model,vehicle_year,plate_number,license_doc_url,vehicle_reg_doc_url,insurance_doc_url) VALUES('car','pending','{"ride":{"requestedPreference":true}}','[{"service":"ride","action":"accepted","version":"service-choice-2026-10-16"}]',$1,'pending','Test address','Toyota','Camry',2020,'TEST-001',$2,$3,$4)`,
        [applicant,...reviewReferences],
      );
      const appData = (await (
        await get(`/driver-applications/${applicant}`, staff)
      ).json()) as { version: string };
      const post = (path: string, body: object) =>
        fetch(base + path, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${signAccessToken({ id: staff }, "staff")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      const decision = {
        decision: "rejected",
        reason: "Insurance must be updated",
        expectedVersion: appData.version,
        requestKey: randomUUID(),
      };
      const decisions = await Promise.all([
        post(`/driver-applications/${applicant}/review`, decision),
        post(`/driver-applications/${applicant}/review`, {
          ...decision,
          decision: "approved",
          requestKey: randomUUID(),
        }),
      ]);
      assert.deepEqual(
        decisions.map((response) => response.status).sort(),
        [200, 409],
      );
      const winning = decisions[0].ok
        ? decision
        : { ...decision, decision: "approved" };
      if (decisions[0].ok) {
        assert.equal(
          (await post(`/driver-applications/${applicant}/review`, decision))
            .status,
          200,
          "exact decision replay",
        );
        assert.equal(
          (
            await post(`/driver-applications/${applicant}/review`, {
              ...decision,
              reason: "Changed reason",
            })
          ).status,
          409,
          "changed payload rejected",
        );
      }
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='driver_application_review' AND target_user_id=$1",
            [applicant],
          )
        ).rows[0].count,
        1,
        "one decision audit",
      );
      const adjustment = {
        userId: rider,
        account: "wallet",
        direction: "credit",
        amountKobo: 50000,
        reason: "Customer balance correction",
        requestKey: randomUUID(),
      };
      Object.assign(env,{ENABLE_ADMIN_MONEY_ACTIONS:false});
      assert.equal((await post("/payments/adjustments",adjustment)).status,403,"server rollout gate rejects staff money actions");
      Object.assign(env,{ENABLE_ADMIN_MONEY_ACTIONS:true});
      const corrected = await Promise.all([
        post("/payments/adjustments", adjustment),
        post("/payments/adjustments", adjustment),
      ]);
      assert.ok(corrected.every((response) => response.status === 200));
      assert.equal(
        (
          await pool.query(
            "SELECT balance_kobo::text AS balance FROM ledger_accounts WHERE owner_user_id=$1 AND kind='user_wallet'",
            [rider],
          )
        ).rows[0].balance,
        "50000",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE request_key=$1",
            [adjustment.requestKey],
          )
        ).rows[0].count,
        1,
        "adjustment retry has one audit",
      );
      const freeze = {
        account: "wallet",
        frozen: true,
        reason: "Account under investigation",
        requestKey: randomUUID(),
      };
      assert.ok(
        (
          await Promise.all([
            post(`/payments/accounts/${rider}/freeze`, freeze),
            post(`/payments/accounts/${rider}/freeze`, freeze),
          ])
        ).every((response) => response.ok),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE request_key=$1",
            [freeze.requestKey],
          )
        ).rows[0].count,
        1,
        "freeze retry has one audit",
      );
      const frozenDebit = await post("/payments/adjustments", {
        ...adjustment,
        direction: "debit",
        requestKey: randomUUID(),
      });
      assert.equal(
        frozenDebit.status,
        409,
        "frozen accounts reject decreasing postings",
      );
      const allowedCredit = await post("/payments/adjustments", {
        ...adjustment,
        requestKey: randomUUID(),
      });
      assert.equal(
        allowedCredit.status,
        200,
        "frozen accounts allow incoming credit",
      );
      const intake = {
        subject: "Fare discrepancy report",
        body: "Customer reports a fare discrepancy after this delivery.",
        category: "payment",
        severity: "medium",
        customerId: rider,
        tripId: first.items[0].id,
        reason: "Customer phone follow-up",
        requestKey: randomUUID(),
      };
      const created = await post("/support", intake);
      assert.equal(created.status, 200);
      const caseData = (await created.json()) as {
        id: string;
        version: number;
      };
      const replayed = await post("/support", intake);
      assert.equal(replayed.status, 200);
      assert.equal(((await replayed.json()) as { id: string }).id, caseData.id);
      assert.equal(
        (await post("/support", { ...intake, body: "Changed content" })).status,
        409,
      );
      const transitions = await Promise.all([
        post(`/support/${caseData.id}/activity`, {
          action: "transition",
          version: 1,
          status: "resolved",
          reason: "Customer accepted the explained fare",
          requestKey: randomUUID(),
        }),
        post(`/support/${caseData.id}/activity`, {
          action: "transition",
          version: 1,
          status: "assigned",
          reason: "Assign to payments investigation",
          requestKey: randomUUID(),
        }),
      ]);
      assert.deepEqual(
        transitions.map((r) => r.status).sort(),
        [200, 409],
        "stale care action rejected",
      );
      assert.equal(
        (
          await pool.query("SELECT version FROM support_cases WHERE id=$1", [
            caseData.id,
          ])
        ).rows[0].version,
        2,
      );
      assert.equal(
        (
          await post(`/support/${caseData.id}/activity`, {
            action: "transition",
            version: 2,
            status: "open",
            reason: "Invalid support state change",
            requestKey: randomUUID(),
          })
        ).status,
        409,
      );
      assert.equal(
        (await get("/safety", staff)).status,
        403,
        "safety is restricted",
      );
      assert.equal(
        (await get("/team", staff)).status,
        403,
        "team is restricted",
      );
      assert.equal((await get(`/support/${caseData.id}`, staff)).status, 200);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='support_sensitive_read'",
          )
        ).rows[0].n,
        1,
      );
      for (const sql of [
        "UPDATE admin_audit_log SET reason=reason",
        "DELETE FROM care_activity",
        "TRUNCATE admin_audit_log",
        "TRUNCATE care_activity",
      ])
        await assert.rejects(pool.query(sql), /append-only/);
      const superStaff = (
        await pool.query<{ id: string }>(
          "INSERT INTO users(full_name,role) VALUES('Safety Owner','super_admin') RETURNING id",
        )
      ).rows[0].id;
      await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1::uuid,$1::uuid,$1::uuid::text,'staff',now()+interval '12 hours')",[superStaff]);
      const config = (await (
        await get("/payments/settings", staff)
      ).json()) as { version: string };
      const patch = (user: string, body: object) =>
        fetch(base + "/payments/settings", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${signAccessToken({ id: user }, "staff")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      const firstSetting = {
          minTopupKobo: 10001,
          expectedVersion: config.version,
          reason: "Test approved minimum configuration",
          requestKey: randomUUID(),
        },
        secondSetting = {
          ...firstSetting,
          minTopupKobo: 10002,
          requestKey: randomUUID(),
        };
      assert.equal((await patch(staff, firstSetting)).status, 403);
      const competing = await Promise.all([
        patch(superStaff, firstSetting),
        patch(superStaff, secondSetting),
      ]);
      assert.deepEqual(
        competing.map((r) => r.status).sort(),
        [200, 409],
        "settings use current version",
      );
      const won = competing[0].ok ? firstSetting : secondSetting;
      assert.equal(
        (await patch(superStaff, won)).status,
        200,
        "exact settings retry",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='settings_update'",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await patch(superStaff, {
            ...won,
            requestKey: randomUUID(),
            transferFeeTiers: [null],
          })
        ).status,
        400,
        "malformed tier rejected safely",
      );
      assert.equal(
        (await get(`/trips?riderId=${rider}&paymentStatus=held`, staff)).status,
        200,
      );
      assert.equal((await get("/trips?riderId=invalid", staff)).status, 400);
      assert.equal((await get("/trips?dateBasis=invalid", staff)).status, 400);
      assert.equal(
        (
          await get(
            "/trips?from=2026-10-10T00:00:00Z&to=2026-10-09T00:00:00Z",
            staff,
          )
        ).status,
        400,
      );
      const intent = (
        await pool.query<{ id: string }>(
          "INSERT INTO payment_intents(user_id,target,amount_kobo,provider_reference,access_code,authorization_url) VALUES($1,'wallet',10000,$2,'PRIVATE_ACCESS_SECRET','PRIVATE_CHECKOUT_SECRET') RETURNING id",
          [rider, "tu_test_" + randomUUID()],
        )
      ).rows[0].id;
      const matchingIntents = (await (
        await get(
          `/payment-intents?target=wallet&userId=${rider}&minKobo=10000&maxKobo=10000`,
          staff,
        )
      ).json()) as { items: { id: string }[] };
      assert.ok(matchingIntents.items.some((r) => r.id === intent));
      const differentTarget = (await (
        await get("/payment-intents?target=earnings", staff)
      ).json()) as { items: unknown[] };
      assert.equal(differentTarget.items.length, 0);
      assert.equal(
        (await get("/payment-intents?minKobo=1.5", staff)).status,
        400,
      );
      assert.equal(
        (await get("/accounts?kind=earnings&ownerUserId=invalid", staff))
          .status,
        400,
      );
      const intentDetail = await get(`/payment-intents/${intent}`, staff);
      assert.equal(intentDetail.status, 200);
      assert.equal(
        (await intentDetail.text()).includes("PRIVATE_"),
        false,
        "checkout secrets excluded from staff detail",
      );
      const safety = await fetch(base + "/safety", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${signAccessToken({ id: superStaff }, "staff")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: "Review reported incident",
          body: "Staff recorded the reported concern",
          severity: "high",
          nextAction: "Contact assigned incident responder",
          reason: "Staff intake from support",
          requestKey: randomUUID(),
        }),
      });
      assert.equal(safety.status, 200);
      const visibleAudit = await (await get("/audit", staff)).text();
      assert.equal(
        visibleAudit.includes("safety_created"),
        false,
        "safety audit excluded from ordinary staff",
      );
      assert.equal((await get("/safety", superStaff)).status, 200);
      assert.equal((await get("/team", superStaff)).status, 200);
      const search = (body: object, user?: string) =>
        fetch(base + "/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(user
              ? { Authorization: `Bearer ${signAccessToken({ id: user }, "staff")}` }
              : {}),
          },
          body: JSON.stringify(body),
        });
      const { ensureRedis: searchRedis } =
        await import("../../shared/config/redis.js");
      const searchCache = await searchRedis();
      searchKeys.push(
        `rakky:admin-search:${staff}`,
        `rakky:admin-search:${superStaff}`,
      );
      assert.equal((await search({ query: "Rider" })).status, 401);
      assert.equal((await search({ query: "Rider" }, rider)).status, 403);
      type SearchResult = {
        groups: {
          scope: string;
          items: StaffSearchHit[];
          nextCursor: string | null;
          hasMore: boolean;
        }[];
      };
      for (const query of [
        "Rider",
        "+2348000000011",
        "private@example.test",
        rider,
      ]) {
        const response = await search({ query, scope: "people" }, staff);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(response.headers.get("cache-control"), "no-store");
        const output = await response.text();
        assert.ok(output.includes(rider));
        assert.equal(output.includes("+2348000000011"), false);
        assert.equal(output.includes("private@example.test"), false);
      }
      const plateSearch = (await (
        await search({ query: "TEST-001", scope: "people" }, staff)
      ).json()) as SearchResult;
      assert.equal(plateSearch.groups[0].items[0].id, applicant);
      const moneySearch = await search(
        { query: intent, scope: "finance" },
        staff,
      );
      assert.equal(moneySearch.status, 200, await moneySearch.clone().text());
      const moneyBody = await moneySearch.text();
      assert.ok(moneyBody.includes(intent));
      assert.equal(moneyBody.includes("PRIVATE_"), false);
      const tripSearch = (await (
        await search({ query: "Rider", scope: "trips" }, staff)
      ).json()) as SearchResult;
      assert.ok(
        tripSearch.groups[0].items.some((item) => item.type === "trip"),
      );
      const ordinary = (await (
        await search({ query: "Rider" }, staff)
      ).json()) as SearchResult;
      assert.equal(
        ordinary.groups.some((group) => group.scope === "safety"),
        false,
      );
      assert.equal(
        (await search({ query: "Review", scope: "safety" }, staff)).status,
        403,
      );
      const safetySearch = await search(
        { query: "Review", scope: "safety" },
        superStaff,
      );
      assert.equal(safetySearch.status, 200, await safetySearch.clone().text());
      assert.ok(
        (await safetySearch.text()).includes("Review reported incident"),
      );
      for (const query of ["%__", "' OR true"]) {
        const literal = (await (
          await search({ query, scope: "people" }, staff)
        ).json()) as SearchResult;
        assert.equal(
          literal.groups[0].items.length,
          0,
          "wildcards do not widen lookup",
        );
      }
      await pool.query(
        "INSERT INTO users(full_name) SELECT 'Search Fixture ' || n FROM generate_series(1,26) n",
      );
      const searchFirst = (await (
        await search({ query: "Search Fixture", scope: "people" }, staff)
      ).json()) as SearchResult;
      assert.equal(searchFirst.groups[0].items.length, 20);
      assert.ok(searchFirst.groups[0].nextCursor);
      const searchNext = (await (
        await search(
          {
            query: "Search Fixture",
            scope: "people",
            cursor: searchFirst.groups[0].nextCursor,
          },
          staff,
        )
      ).json()) as SearchResult;
      assert.equal(searchNext.groups[0].items.length, 6);
      assert.equal(
        new Set(
          [...searchFirst.groups[0].items, ...searchNext.groups[0].items].map(
            (item) => item.id,
          ),
        ).size,
        26,
      );
      assert.equal(searchNext.groups[0].nextCursor, null);
      assert.equal(
        (
          await search(
            {
              query: "Changed",
              scope: "people",
              cursor: searchFirst.groups[0].nextCursor,
            },
            staff,
          )
        ).status,
        400,
      );
      const bounded = (await (
        await search({ query: "Search Fixture" }, staff)
      ).json()) as SearchResult;
      assert.equal(bounded.groups[0].items.length, 5);
      assert.equal(bounded.groups[0].hasMore, true);
      const searches = (
        await pool.query(
          "SELECT metadata,object_type FROM admin_audit_log WHERE action='staff_record_search'",
        )
      ).rows;
      assert.ok(searches.some((row) => row.object_type === "safety"));
      assert.equal(
        JSON.stringify(searches).includes("private@example.test"),
        false,
      );
      assert.ok(
        searches.every(
          (row) => Object.keys(row.metadata).join(",") === "scope",
        ),
      );
      await searchCache.set(searchKeys[0], 30, "EX", 60);
      assert.equal((await search({ query: "Rider" }, staff)).status, 429);
      assert.ok((await searchCache.ttl(searchKeys[0])) > 0);
      await searchCache.del(...searchKeys);
      const teamFirst = (await (
        await get("/team?limit=1", superStaff)
      ).json()) as {
        items: { id: string; role: string }[];
        nextCursor: string;
      };
      assert.equal(teamFirst.items.length, 1);
      const teamNext = (await (
        await get(`/team?limit=1&cursor=${teamFirst.nextCursor}`, superStaff)
      ).json()) as typeof teamFirst;
      assert.equal(teamNext.items.length, 1);
      assert.notEqual(teamFirst.items[0].id, teamNext.items[0].id);
      const teamFiltered = (await (
        await get(`/team?id=${staff}&status=admin`, superStaff)
      ).json()) as typeof teamFirst;
      assert.equal(teamFiltered.items[0].id, staff);
      assert.equal((await get("/team?status=user", superStaff)).status, 400);
      assert.equal((await get("/team?service=ride", superStaff)).status, 400);
      assert.equal((await get(`/team?id=${staff}`, staff)).status, 403);
      const searchAudit = (await (
        await get(`/audit?action=staff_record_search&actorId=${staff}`, staff)
      ).json()) as {
        items: { action: string; actorId: string; objectType: string }[];
      };
      assert.ok(searchAudit.items.length > 0);
      assert.ok(
        searchAudit.items.every(
          (row) =>
            row.action === "staff_record_search" &&
            row.actorId === staff &&
            row.objectType !== "safety",
        ),
      );
      const hiddenSafetyAudit = (await (
        await get("/audit?action=safety_created", staff)
      ).json()) as typeof searchAudit;
      assert.equal(hiddenSafetyAudit.items.length, 0);
      const visibleSafetyAudit = (await (
        await get("/audit?action=safety_created", superStaff)
      ).json()) as typeof searchAudit;
      assert.ok(visibleSafetyAudit.items.length > 0);
      const objectAudit = await get(`/audit?objectId=${rider}`, staff);
      assert.equal(objectAudit.status, 200, await objectAudit.clone().text());
      assert.equal((await get("/audit?action=' OR true", staff)).status, 400);
      assert.equal((await get("/audit?objectId=invalid", staff)).status, 400);
      assert.equal((await get("/audit?phone=private", staff)).status, 400);
      await t.test(
        "numbered API pages count filtered rows and preserve permission boundaries",
        async () => {
          type Page = {
            items: { id: string; action?: string; objectType?: string }[];
            entries: { id: string }[];
            pagination: {
              page: number;
              pageSize: number;
              total: number;
              totalPages: number;
              from: number;
              to: number;
              hasPrevious: boolean;
              hasNext: boolean;
            };
            count?: { value: number; exact: boolean };
          };
          const readPage = async (path: string, actor = staff) => {
            const response = await get(path, actor);
            assert.equal(
              response.status,
              200,
              path + ": " + (await response.clone().text()),
            );
            return (await response.json()) as Page;
          };
          const count = async (sql: string, values: unknown[] = []) =>
            Number((await pool.query<{ n: string }>(sql, values)).rows[0].n);
          const totalUsers = await count(
            "SELECT count(*)::text AS n FROM users",
          );
          const usersOne = await readPage("/users?page=1&limit=10");
          const usersTwo = await readPage("/users?page=2&limit=10");
          assert.equal(usersOne.pagination.total, totalUsers);
          assert.deepEqual(usersOne.count, { value: totalUsers, exact: true });
          assert.equal(usersOne.items.length, 10);
          assert.equal(usersTwo.pagination.from, 11);
          assert.equal(usersTwo.items.length, 10);
          assert.equal(
            usersOne.items.some((row) =>
              usersTwo.items.some((next) => next.id === row.id),
            ),
            false,
          );
          const last = await readPage("/users?page=999999&limit=10");
          assert.equal(last.pagination.page, Math.ceil(totalUsers / 10));
          assert.equal(last.pagination.to, totalUsers);
          assert.equal(last.pagination.hasNext, false);
          const empty = await readPage(`/users?page=5&id=${randomUUID()}`);
          assert.deepEqual(empty.pagination, {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 1,
            from: 0,
            to: 0,
            hasPrevious: false,
            hasNext: false,
          });
          await pool.query("UPDATE users SET is_active=false WHERE id=$1", [
            rider,
          ]);
          const inactive = await readPage(
            `/users?page=1&mode=inactive&id=${rider}`,
          );
          assert.equal(inactive.pagination.total, 1);
          assert.equal(inactive.items[0].id, rider);
          assert.equal(
            (await readPage(`/users?page=1&mode=active&id=${rider}`)).pagination
              .total,
            0,
          );
          await pool.query("UPDATE users SET is_active=true WHERE id=$1", [
            rider,
          ]);
          const tripsOne = await readPage(
            `/trips?page=1&limit=1&service=courier&status=returned&riderId=${rider}`,
          );
          const tripsTwo = await readPage(
            `/trips?page=2&limit=1&service=courier&status=returned&riderId=${rider}`,
          );
          assert.equal(tripsOne.pagination.total, 2);
          assert.equal(tripsTwo.pagination.from, 2);
          assert.notEqual(tripsOne.items[0].id, tripsTwo.items[0].id);
          const payments = await readPage(
            `/payment-intents?page=1&limit=1&id=${intent}`,
          );
          assert.equal(payments.pagination.total, 1);
          assert.equal(payments.items[0].id, intent);
          assert.equal(
            (await readPage(`/withdrawals?page=1&id=${randomUUID()}`))
              .pagination.total,
            0,
          );
          const accounts = await readPage(
            `/accounts?page=1&limit=1&ownerUserId=${rider}&kind=wallet`,
          );
          assert.equal(accounts.pagination.total, 1);
          const entriesTotal = await count(
            "SELECT count(*)::text AS n FROM ledger_entries WHERE account_id=$1",
            [accounts.items[0].id],
          );
          const entriesOne = await readPage(
            `/accounts/${accounts.items[0].id}?page=1&limit=1`,
          );
          assert.equal(entriesOne.pagination.total, entriesTotal);
          assert.equal(entriesOne.entries.length, Math.min(1, entriesTotal));
          if (entriesTotal > 1) {
            const entriesTwo = await readPage(
              `/accounts/${accounts.items[0].id}?page=2&limit=1`,
            );
            assert.notEqual(entriesOne.entries[0].id, entriesTwo.entries[0].id);
          }
          for (const path of [
            "/drivers",
            "/driver-applications",
            "/ratings",
            "/support",
            "/reconciliation/topups",
            "/reconciliation/withdrawals",
            "/reconciliation/escrow",
          ])
            assert.ok(
              (await readPage(path + "?page=1&limit=1")).pagination.total >= 0,
              path,
            );
          const teamOne = await readPage("/team?page=1&limit=1", superStaff);
          const exactEscrow = await readPage(
            `/reconciliation/escrow?page=3&limit=1&id=${first.items[0].id}`,
          );
          assert.equal(exactEscrow.pagination.total, 1);
          assert.equal(exactEscrow.pagination.page, 1);
          assert.equal(exactEscrow.items[0].id, first.items[0].id);
          assert.equal(
            (await readPage(`/reconciliation/escrow?page=1&id=${randomUUID()}`))
              .pagination.total,
            0,
          );
          for (const kind of ["topups", "withdrawals", "escrow"])
            assert.equal(
              (await get(`/reconciliation/${kind}?page=1&service=ride`, staff))
                .status,
              400,
              "unsupported service filters cannot silently change queue scope",
            );
          const teamTwo = await readPage("/team?page=2&limit=1", superStaff);
          assert.equal(teamOne.pagination.total, 2);
          assert.notEqual(teamOne.items[0].id, teamTwo.items[0].id);
          assert.equal((await get("/team?page=1", staff)).status, 403);
          assert.equal((await get("/safety?page=1", staff)).status, 403);
          assert.equal(
            (await readPage("/safety?page=1", superStaff)).pagination.total,
            1,
          );
          const audit = await readPage(
            "/audit?page=1&limit=100&action=staff_record_search",
          );
          const allowedAudit = await count(
            "SELECT count(*)::text AS n FROM admin_audit_log WHERE action='staff_record_search' AND COALESCE(object_type,'')<>'safety'",
          );
          assert.equal(audit.pagination.total, allowedAudit);
          assert.ok(audit.items.every((row) => row.objectType !== "safety"));
          assert.equal(
            (await readPage("/audit?page=1&action=safety_created")).pagination
              .total,
            0,
          );
          assert.equal(
            (await readPage("/audit?page=1&action=safety_created", superStaff))
              .pagination.total,
            1,
          );
          for (const query of [
            "page=0",
            "page=-1",
            "page=1.5",
            "page=1000000",
            "page=1&page=2",
            "page=1&limit=101",
            "page=1&cursor=invalid",
          ])
            assert.equal(
              (await get("/users?" + query, staff)).status,
              400,
              query,
            );
          assert.equal(
            (await get("/audit?page=1&before=1", staff)).status,
            400,
          );
          assert.equal(
            (
              await get(
                `/accounts/${accounts.items[0].id}?page=1&before=1`,
                staff,
              )
            ).status,
            400,
          );
        },
      );
      const exported = await get("/reports/export", staff);
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-type")!, /text\/csv/);
      assert.match(await exported.text(), /Africa\/Lagos \(WAT\)/);
      assert.equal((await get(`/users/${rider}`, staff)).status, 200);
      const auditedAccount = (
        await pool.query(
          "SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind='user_wallet'",
          [rider],
        )
      ).rows[0].id;
      const auditedTransaction = (
        await pool.query(
          "SELECT ledger_transaction_id AS id FROM admin_audit_log WHERE request_key=$1",
          [adjustment.requestKey],
        )
      ).rows[0].id;
      assert.equal(
        (await get(`/accounts/${auditedAccount}`, staff)).status,
        200,
      );
      assert.equal(
        (await get(`/transactions/${auditedTransaction}`, staff)).status,
        200,
      );
      for (const action of [
        "trip_context_read",
        "person_context_read",
        "finance_directory_read",
        "ledger_account_read",
        "ledger_transaction_read",
        "live_supply_read",
      ]) {
        const reads = await pool.query(
          "SELECT count(*)::int AS n FROM admin_audit_log WHERE actor_id=$1 AND action=$2",
          [staff, action],
        );
        assert.ok(reads.rows[0].n > 0, `${action} is audited`);
      }
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='report_export'",
          )
        ).rows[0].n,
        1,
      );
      await pool.query(
        "UPDATE trips SET payment_status='settled',returned_at='2026-10-09T23:10:00Z' WHERE id=$1",
        [first.items[0].id],
      );
      const returnedReport = (await (
        await get(
          "/reports?from=2026-10-09T23:00:00Z&to=2026-10-10T23:00:00Z&service=courier",
          staff,
        )
      ).json()) as {
        settlement: {
          returned: string;
          delivered: string;
          settledValueKobo: string;
        };
        outcomes: unknown[];
      };
      assert.equal(returnedReport.settlement.returned, "1");
      assert.equal(returnedReport.settlement.delivered, "0");
      assert.equal(returnedReport.settlement.settledValueKobo, "100000");
      assert.equal(
        returnedReport.outcomes.length,
        0,
        "request cohort is separate from fulfillment time",
      );
      const directory = resolve(
          ".private-uploads",
          "driver-documents",
          applicant,
        ),
        fileId = randomUUID();
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(
          resolve(directory, fileId + ".pdf"),
          "%PDF-1.7\nTest-only document",
        );
        await pool.query(
          "UPDATE driver_profiles SET license_doc_url=$2 WHERE user_id=$1",
          [applicant, `private://driver-documents/${applicant}/${fileId}.pdf`],
        );
        const document = await get(
          `/driver-applications/${applicant}/documents/license`,
          staff,
        );
        assert.equal(document.status, 200);
        assert.match(document.headers.get("content-type")!, /application\/pdf/);
        assert.match(
          document.headers.get("content-security-policy")!,
          /sandbox/,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='driver_document_view' AND target_user_id=$1",
              [applicant],
            )
          ).rows[0].n,
          1,
        );
        await writeFile(
          resolve(directory, fileId + ".pdf"),
          "<script>invalid content</script>",
        );
        assert.equal(
          (
            await get(
              `/driver-applications/${applicant}/documents/license`,
              staff,
            )
          ).status,
          415,
        );
        await pool.query(
          "UPDATE driver_profiles SET license_doc_url=$2 WHERE user_id=$1",
          [applicant, `private://driver-documents/${rider}/${fileId}.pdf`],
        );
        assert.equal(
          (
            await get(
              `/driver-applications/${applicant}/documents/license`,
              staff,
            )
          ).status,
          404,
          "another user private path denied",
        );
        await pool.query(
          "UPDATE driver_profiles SET license_doc_url=$2 WHERE user_id=$1",
          [applicant, `private://driver-documents/${applicant}/${fileId}.png`],
        );
        await symlink(
          resolve("package.json"),
          resolve(directory, fileId + ".png"),
        );
        assert.equal(
          (
            await get(
              `/driver-applications/${applicant}/documents/license`,
              staff,
            )
          ).status,
          404,
          "symlink escape denied",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      const { ensureRedis } = await import("../../shared/config/redis.js");
      const cache = await ensureRedis();
      await pool.query(
        "UPDATE driver_profiles SET status='approved',ride_service_status='approved',accepts_ride=true WHERE user_id=$1",
        [applicant],
      );
      // Availability requires the approved account to be in driver mode.
      await pool.query("UPDATE users SET active_role='driver' WHERE id=$1", [applicant]);
      await cache.set(`driver:${applicant}:status`, "online", "EX", 60);
      await cache.set(
        `driver:${applicant}:location`,
        JSON.stringify({
          driverId: applicant,
          latitude: 6.4,
          longitude: 3.4,
          timestamp: Date.now(),
        }),
        "EX",
        60,
      );
      try {
        const live = (await (await get("/live", staff)).json()) as {
          drivers: { id: string; availability: string; location: unknown }[];
        };
        assert.equal(
          live.drivers.find((d) => d.id === applicant)?.availability,
          "available",
        );
        const evidenceTrip = randomUUID();
        await pool.query(
          `INSERT INTO trips(id,rider_id,driver_id,status,service_type,payment_method,payment_status,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key) VALUES($1,$2,$3,'in_progress','ride','cash','unpaid',6.4,3.4,'Pickup',6.5,3.5,'Dropoff',1000,300,100000,$4)`,
          [evidenceTrip, rider, applicant, evidenceTrip],
        );
        await pool.query(
          `INSERT INTO trip_locations(trip_id,lat,lng,recorded_at) SELECT $1,6.4+n*0.00001,3.4,'2026-10-09T10:00:00Z'::timestamptz+n*interval '1 second' FROM generate_series(1,205) n`,
          [evidenceTrip],
        );
        const evidencePath = `/trips/${evidenceTrip}/location`;
        assert.equal((await get(evidencePath)).status, 401);
        assert.equal((await get(evidencePath, rider)).status, 403);
        const evidence = (await (
          await get(`/trips/${evidenceTrip}`, staff)
        ).json()) as {
          currentPosition: { state: string; location: unknown };
          sampledPositions: { items: { latitude: number }[]; total: number };
        };
        assert.equal(evidence.currentPosition.state, "fresh");
        assert.ok(evidence.currentPosition.location);
        assert.equal(evidence.sampledPositions.items.length, 200);
        assert.equal(evidence.sampledPositions.total, 205);
        assert.ok(
          Math.abs(evidence.sampledPositions.items[0].latitude - 6.40006) <
            0.0000001,
          "most recent bounded samples returned in time order",
        );
        const freshTripPoint = (await (
          await get(evidencePath, staff)
        ).json()) as { state: string; location: unknown };
        assert.equal(freshTripPoint.state, "fresh");
        assert.ok(freshTripPoint.location);
        await pool.query("UPDATE trips SET driver_id=$1 WHERE id=$2", [
          applicant,
          first.items[0].id,
        ]);
        const endedPoint = (await (
          await get(`/trips/${first.items[0].id}/location`, staff)
        ).json()) as typeof freshTripPoint;
        assert.equal(endedPoint.state, "not_applicable");
        assert.equal(
          endedPoint.location,
          null,
          "ended trip never exposes the driver's later position",
        );
        await cache.set(
          `driver:${applicant}:location`,
          JSON.stringify({
            driverId: applicant,
            latitude: 6.4,
            longitude: 3.4,
            timestamp: Date.now() - 31000,
          }),
          "EX",
          60,
        );
        const stale = (await (await get("/live", staff)).json()) as typeof live;
        assert.equal(
          stale.drivers.find((d) => d.id === applicant)?.location,
          null,
          "stale positions withheld",
        );
        const expiredTripPoint = (await (
          await get(evidencePath, staff)
        ).json()) as typeof freshTripPoint;
        assert.equal(
          expiredTripPoint.location,
          null,
          "historical samples never become a live fallback",
        );
        assert.equal(expiredTripPoint.state, "unavailable");
        await cache.set(
          `driver:${applicant}:location`,
          JSON.stringify({
            driverId: applicant,
            latitude: 7.8,
            longitude: 3.4,
            timestamp: Date.now(),
          }),
          "EX",
          60,
        );
        const outside = (await (
          await get("/live", staff)
        ).json()) as typeof live;
        assert.equal(
          outside.drivers.some((d) => d.id === applicant),
          false,
          "fresh out-of-bounds position omitted",
        );
      } finally {
        await cache.del(
          `driver:${applicant}:status`,
          `driver:${applicant}:location`,
        );
      }
      // Configuration and row controls use the real routes against this disposable schema.
      const mutate = (path: string, user: string, body: object, method = "PATCH") => fetch(base + path, {
        method, headers: {Authorization: `Bearer ${signAccessToken({id:user}, "staff")}`, "Content-Type":"application/json"}, body:JSON.stringify(body),
      });
      const ledgerBefore = JSON.stringify((await pool.query("SELECT * FROM ledger_entries ORDER BY id")).rows);
      const pricing = (await (await get("/pricing", superStaff)).json()).items.find((row: {vehicleType:string}) => row.vehicleType === "economy");
      const fareBody = {
        baseFareKobo:Number(pricing.baseFareKobo)+100, perKmKobo:Number(pricing.perKmKobo), perMinuteKobo:Number(pricing.perMinuteKobo),
        minimumFareKobo:Number(pricing.minimumFareKobo), commissionBps:pricing.commissionBps, active:true,
        expectedVersion:pricing.version, reason:"Approved test fare revision", requestKey:randomUUID(),
      };
      assert.equal((await mutate("/pricing/economy", staff, fareBody)).status,403);
      assert.equal((await mutate("/pricing/economy", rider, fareBody)).status,403);
      assert.equal((await mutate("/pricing/economy", superStaff, [])).status, 400);
      const fareOther = {...fareBody, baseFareKobo:fareBody.baseFareKobo+100, requestKey:randomUUID()};
      const fareRace = await Promise.all([mutate("/pricing/economy",superStaff,fareBody),mutate("/pricing/economy",superStaff,fareOther)]);
      assert.deepEqual(fareRace.map(response=>response.status).sort(),[200,409]);
      const fareWon = fareRace[0].ok ? fareBody : fareOther;
      assert.equal((await mutate("/pricing/economy",superStaff,fareWon)).status,200);
      assert.equal((await mutate("/pricing/economy",superStaff,{...fareWon,commissionBps:10001,requestKey:randomUUID()})).status,400);
      assert.equal((await mutate("/pricing/economy",superStaff,{...fareWon,baseFareKobo:fareWon.baseFareKobo+1})).status,409);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM admin_audit_log WHERE action='pricing_update'")).rows[0].n,1);
      const latestFare = (await (await get("/pricing",superStaff)).json()).items.find((row:{vehicleType:string})=>row.vehicleType==="economy");
      assert.equal(latestFare.baseFareKobo,String(fareWon.baseFareKobo));
      assert.equal((await mutate("/pricing/economy",superStaff,{...fareWon,active:false,expectedVersion:latestFare.version,requestKey:randomUUID()})).status,200);
      const {getFareConfig} = await import("../trips/fare.service.js");
      const fareClient = await pool.connect();
      try {
        await assert.rejects(getFareConfig(fareClient,"economy"));
        assert.equal((await getFareConfig(fareClient,"economy",false)).vehicle_type,"economy","existing trips can settle after service is disabled");
      } finally {fareClient.release();}

      const editableUser = (await pool.query<{id:string}>("INSERT INTO users(full_name,phone) VALUES('Editable Customer','+2348000000888') RETURNING id")).rows[0].id;
      const person = await (await get(`/users/${editableUser}`,superStaff)).json();
      const personBody = {name:"Updated Customer",active:true,expectedVersion:person.version,reason:"Correcting test customer name",requestKey:randomUUID()};
      assert.equal((await mutate(`/users/${editableUser}`,staff,personBody)).status,403);
      assert.equal((await mutate(`/users/${editableUser}`,superStaff,{...personBody,email:"unauthorized@example.test"})).status,400);
      assert.equal((await mutate(`/users/${editableUser}`, superStaff, [])).status, 400);
      const personOther = {...personBody,name:"Other Customer",requestKey:randomUUID()};
      const personRace = await Promise.all([mutate(`/users/${editableUser}`,superStaff,personBody),mutate(`/users/${editableUser}`,superStaff,personOther)]);
      assert.deepEqual(personRace.map(response=>response.status).sort(),[200,409]);
      const personWon = personRace[0].ok ? personBody : personOther;
      assert.equal((await mutate(`/users/${editableUser}`,superStaff,personWon)).status,200);
      const personLatest = await (await get(`/users/${editableUser}`,superStaff)).json();
      assert.equal(personLatest.name,personWon.name);
      const editableDevice=(await pool.query<{id:string}>("INSERT INTO push_devices(user_id,expo_push_token,platform,device_identifier) VALUES($1,'ExponentPushToken[admin-deactivation-fixture]','android','admin-deactivation-device') RETURNING id",[editableUser])).rows[0];
      assert.equal((await mutate(`/users/${editableUser}`,superStaff,{...personWon,active:false,expectedVersion:personLatest.version,requestKey:randomUUID()})).status,200);
      assert.equal((await pool.query('SELECT enabled FROM push_devices WHERE id=$1',[editableDevice.id])).rows[0].enabled,false);
      assert.equal((await get("/trips",editableUser)).status,401,"inactive users cannot reuse an access token");
      const inactive = await (await get(`/users/${editableUser}`,superStaff)).json();
      assert.equal((await mutate(`/users/${editableUser}`,superStaff,{...personWon,active:true,expectedVersion:inactive.version,requestKey:randomUUID()})).status,200);
      const staffPerson = await (await get(`/users/${superStaff}`,superStaff)).json();
      assert.equal((await mutate(`/users/${superStaff}`,superStaff,{...personBody,expectedVersion:staffPerson.version,requestKey:randomUUID()})).status,403,"profile controls cannot change staff accounts");

      const seedSchedule = async (hours:number) => (await pool.query<{id:string}>(`INSERT INTO trips(rider_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key,scheduled_at) VALUES($1,'scheduled','cash',6.4,3.4,'Pickup',6.5,3.5,'Dropoff',1000,300,100000,$2,now()+$3*interval '1 hour') RETURNING id`,[editableUser,randomUUID(),hours])).rows[0].id;
      const booking = await seedSchedule(1);
      const bookingDetail = await (await get(`/trips/${booking}`,superStaff)).json();
      const scheduleBody = {action:"reschedule",scheduledAt:new Date(Date.now()+2*3600_000).toISOString(),expectedVersion:bookingDetail.version,reason:"Approved test pickup change",requestKey:randomUUID()};
      assert.equal((await mutate(`/trips/${booking}/schedule`,staff,scheduleBody,"POST")).status,403);
      assert.equal((await mutate(`/trips/${booking}/schedule`,superStaff,{...scheduleBody,scheduledAt:new Date(Date.now()+1000).toISOString()},"POST")).status,400);
      assert.equal((await mutate(`/trips/${booking}/schedule`, superStaff, [], "POST")).status, 400);
      const scheduleOther = {...scheduleBody,scheduledAt:new Date(Date.now()+3*3600_000).toISOString(),requestKey:randomUUID()};
      const scheduleRace = await Promise.all([mutate(`/trips/${booking}/schedule`,superStaff,scheduleBody,"POST"),mutate(`/trips/${booking}/schedule`,superStaff,scheduleOther,"POST")]);
      assert.deepEqual(scheduleRace.map(response=>response.status).sort(),[200,409]);
      const scheduleWon = scheduleRace[0].ok ? scheduleBody : scheduleOther;
      assert.equal((await mutate(`/trips/${booking}/schedule`,superStaff,scheduleWon,"POST")).status,200);
      const rescheduled = await (await get(`/trips/${booking}`,superStaff)).json();
      assert.equal(rescheduled.scheduledAt,scheduleWon.scheduledAt);
      assert.equal(rescheduled.fareKobo,"100000");
      const otherBooking = await seedSchedule(4);
      const otherDetail = await (await get(`/trips/${otherBooking}`,superStaff)).json();
      assert.equal((await mutate(`/trips/${booking}/schedule`,superStaff,{...scheduleBody,scheduledAt:otherDetail.scheduledAt,expectedVersion:rescheduled.version,requestKey:randomUUID()},"POST")).status,409,"overlapping scheduled rides rejected");
      const currentPerson = await (await get(`/users/${editableUser}`,superStaff)).json();
      assert.equal((await mutate(`/users/${editableUser}`,superStaff,{...personWon,active:false,expectedVersion:currentPerson.version,requestKey:randomUUID()})).status,409,"pending bookings prevent account deactivation");
      const cancelBody = {action:"cancel",expectedVersion:rescheduled.version,reason:"Approved test booking cancellation",requestKey:randomUUID()};
      assert.equal((await mutate(`/trips/${booking}/schedule`,superStaff,cancelBody,"POST")).status,200);
      assert.equal((await mutate(`/trips/${booking}/schedule`,superStaff,cancelBody,"POST")).status,200);
      assert.equal((await mutate(`/trips/${booking}/schedule`,superStaff,{...cancelBody,requestKey:randomUUID()},"POST")).status,409);
      const cancelled = await (await get(`/trips/${booking}`,superStaff)).json();
      assert.equal(cancelled.status,"cancelled");
      const terminalResponse = await mutate(`/trips/${booking}/schedule`, superStaff, {
        ...scheduleBody, expectedVersion: cancelled.version, requestKey: randomUUID(),
      }, "POST");
      assert.equal(terminalResponse.status, 409);
      assert.equal((await terminalResponse.json()).error, "schedule_already_dispatched");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM trip_status_history WHERE trip_id=$1 AND to_status='cancelled' AND actor_id=$2 AND metadata->>'staffAction'='true'",[booking,superStaff])).rows[0].n,1);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM admin_audit_log WHERE action='schedule_update' AND object_id=$1",[booking])).rows[0].n,2);
      assert.equal(JSON.stringify((await pool.query("SELECT * FROM ledger_entries ORDER BY id")).rows),ledgerBefore,"configuration and scheduled cash edits do not rewrite money history");
      // A scheduled wallet cancellation appends one release and preserves every old posting.
      assert.equal((await mutate("/payments/adjustments", superStaff, {
        userId: editableUser, account: "wallet", direction: "credit", amountKobo: 100000,
        reason: "Fund disposable scheduled cancellation test", requestKey: randomUUID(),
      }, "POST")).status, 200);
      const walletBooking = await seedSchedule(6);
      await pool.query("UPDATE trips SET payment_method='wallet' WHERE id=$1", [walletBooking]);
      const { holdTripFare } = await import("../payments/tripPayments.service.js");
      const holdClient = await pool.connect();
      try {
        await holdClient.query("BEGIN");
        const heldTrip = (await holdClient.query<TripRow>("SELECT * FROM trips WHERE id=$1 FOR UPDATE", [walletBooking])).rows[0];
        await holdTripFare(holdClient, heldTrip);
        await holdClient.query("COMMIT");
      } catch (error) {
        await holdClient.query("ROLLBACK");
        throw error;
      } finally {
        holdClient.release();
      }
      const heldDetail = await (await get(`/trips/${walletBooking}`, superStaff)).json();
      assert.equal(heldDetail.paymentStatus, "held");
      const originalEntries = (await pool.query("SELECT * FROM ledger_entries ORDER BY id")).rows;
      const maxEntry = originalEntries.at(-1).id;
      const releaseBody = {
        action: "cancel", expectedVersion: heldDetail.version,
        reason: "Cancel disposable funded booking", requestKey: randomUUID(),
      };
      assert.equal((await mutate(`/trips/${walletBooking}/schedule`, superStaff, releaseBody, "POST")).status, 200);
      assert.equal((await mutate(`/trips/${walletBooking}/schedule`, superStaff, releaseBody, "POST")).status, 200);
      const released = await (await get(`/trips/${walletBooking}`, superStaff)).json();
      assert.equal(released.status, "cancelled");
      assert.equal(released.paymentStatus, "released");
      assert.equal((await pool.query("SELECT balance_kobo::text AS balance FROM ledger_accounts WHERE owner_user_id=$1 AND kind='user_wallet'", [editableUser])).rows[0].balance, "100000");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM ledger_transactions WHERE reference_id=$1 AND type='trip_hold_release'", [walletBooking])).rows[0].n, 1);
      assert.deepEqual((await pool.query("SELECT * FROM ledger_entries WHERE id<=$1 ORDER BY id", [maxEntry])).rows, originalEntries);
      await pool.query("UPDATE users SET role=$2 WHERE id=$1", [staff, "user"]);
      assert.equal(
        (await get("/trips", staff)).status,
        403,
        "role changes apply to existing access tokens",
      );
    } finally {
      await Promise.all(documentDirectories.map(directory=>rm(directory,{recursive:true,force:true})));
      if (server)
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      Object.assign(env,{ENABLE_ADMIN_MONEY_ACTIONS:originalMoneyFlag});
      db.query = originalQuery;
      db.connect = originalConnect;
      const { redis } = await import("../../shared/config/redis.js");
      if (redis?.status === "ready" && searchKeys.length)
        await redis.del(...searchKeys);
      redis?.disconnect();
      const {stopTripWorkers}=await import("../trips/tripQueue.js");
      const {stopPaymentWorkers}=await import("../payments/paymentQueue.js");
      await Promise.all([stopTripWorkers(),stopPaymentWorkers()]);
      await pool.end();
      await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      await owner.end();
      await db.end();
    }
  },
);
