import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Documentation only. No environment loading, database connection or secrets.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  "src/app.ts",
  "src/index.ts",
  "src/routes/health.ts",
  "src/shared/config/db.ts",
  "src/shared/config/migrate.ts",
  "src/modules/auth/auth.middleware.ts",
  "src/modules/auth/auth.routes.ts",
  "src/modules/auth/auth.controller.ts",
  "src/modules/auth/auth.service.ts",
  "src/modules/auth/auth.types.ts",
  "src/modules/auth/jwt.service.ts",
  "src/modules/auth/otp.service.ts",
  "src/websocket/index.ts",
  "src/websocket/notifications.ts",
  "src/modules/auth/google.service.ts",
  "src/modules/auth/admin.routes.ts",
  "src/modules/auth/admin.controller.ts",
  "src/modules/auth/admin.service.ts",
  "src/modules/trips/admin.routes.ts",
  "src/modules/trips/admin.controller.ts",
  "src/modules/trips/admin.service.ts",
  "src/modules/trips/fare.service.ts",
  "src/modules/trips/trips.service.ts",
  "src/modules/trips/tripStateMachine.ts",
  "src/modules/driver/admin.routes.ts",
  "src/modules/driver/admin.controller.ts",
  "src/modules/driver/admin.service.ts",
  "src/modules/driver/driver.service.ts",
  "src/modules/location/admin.routes.ts",
  "src/modules/location/admin.controller.ts",
  "src/modules/location/admin.service.ts",
  "src/modules/care/care.routes.ts",
  "src/modules/care/care.controller.ts",
  "src/modules/care/care.service.ts",
  "src/modules/payments/dashboard.routes.ts",
  "src/modules/payments/dashboard.controller.ts",
  "src/modules/payments/dashboard.service.ts",
  "src/modules/payments/admin.routes.ts",
  "src/modules/payments/admin.service.ts",
  "src/shared/utils/queueHealth.ts",
  "src/modules/trips/tripQueue.ts",
  "src/modules/payments/paymentQueue.ts",
  "src/modules/payments/reconciliation.service.ts",
  "src/modules/payments/gateway.ts",
  "src/modules/payments/tripPayments.service.ts",
  "src/modules/payments/topups.service.ts",
  "src/modules/payments/withdrawals.service.ts",
  "src/modules/payments/webhook.service.ts",
  "src/modules/payments/ledger.service.ts",
  "src/modules/payments/payoutAccounts.service.ts",
  "src/config/env.ts",
  "src/shared/utils/adminQuery.ts",
  "src/shared/utils/adminPagination.ts",
  "src/shared/utils/adminAudit.ts",
  "src/shared/utils/adminSearch.ts",
  "src/shared/errors.ts",
];
const sections: string[] = [];
for (const source of sources) {
  const code = await readFile(resolve(root, source), "utf8");
  const checksum = createHash("sha256").update(code).digest("hex");
  sections.push(
    `## ${source}\n\n[Open source](../${source})\n\nSHA-256: \`${checksum}\`\n\n<details>\n<summary>Full TypeScript implementation</summary>\n\n\`\`\`ts\n${code.trimEnd()}\n\`\`\`\n\n</details>`,
  );
}
const document = [
  "# Rakky admin API implementation snapshot",
  "Read the [API reference](admin-api-reference.md) first for endpoint contracts, auth, examples and operational limits. This appendix contains the current checked-out source, including uncommitted work. Source files are authoritative. Regenerate after code changes with `node --experimental-strip-types scripts/document-admin-api.ts` from the backend directory.",
  "This generator reads only the explicit TypeScript source list below. It never loads `.env`, contacts PostgreSQL/Redis, issues tokens or writes operational records. Checksums let reviewers detect a stale snapshot. Internal imports point to the existing domain services rather than duplicating ledger/matching/auth implementations.",
  sources.map((source) => `- [${source}](../${source})`).join("\n"),
  ...sections,
].join("\n\n");
await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(resolve(root, "docs/admin-api-implementation.md"), document + "\n");
console.log(`Documented ${sources.length} implementation files without operational access.`);
