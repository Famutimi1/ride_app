# Email system verification — 17 October 2026

- Backend `npm run verify`: 170 tests passed after adding the outbox migration to existing isolated test setups. Covers existing auth, driver service review, trip settlement, payments and notifications.
- Additional focused email run after adding the worker recovery case: 18 tests passed, including actual BullMQ recovery, late admin configuration, expired leases, signature validation, stable retry requests and staff authorization. Resend transport was mocked throughout.
- Mobile `npm run typecheck`: passed.
- Dashboard typecheck, 18 existing unit tests and production build: passed. The production session smoke check also verifies the new email history/detail pages, safe template iframe, authenticated proxy reads, retry/test proxy mutations, CSRF and HTTP method guards.
- Browser inspection: the canonical logo loads; the driver welcome and mixed-service review templates display correctly. At 375px width, document width is 375px, service decisions are readable, and app/support action links point to the intended configured destinations. Preview links use explicit fixture domains.
- Local development migration check confirmed migrations 001–016 were already applied. `npm run migrate` then applied only `017_email_outbox.sql` successfully.
- Live delivery has not been enabled or tested: the backend currently has no Resend key, verified sender, administrator recipients, webhook signing secret or app/dashboard link configuration. No real email was sent during implementation.

See [configuration and launch instructions](email-system.md).

## Saved email switches

- Owner approved migration `018_email_settings.sql`; it is applied to the local development database.
- Full backend `npm run verify`: 173 tests passed, including saved-switch behavior, pending-message skipping, no backlog replay, retry/test-send enforcement, idempotent saves, super-admin access and concurrent edit protection.
- Dashboard `npm run verify`: typecheck, unit tests, production build and session smoke checks passed. The smoke check includes preference rendering, authenticated reads, the PATCH allowlist, method validation and CSRF protection.
- Sending remains disabled by the deployment environment until the previously documented Resend configuration is supplied.

## Native app buttons

- Customer HTML and plain-text actions now use the dashboard's public `/open-app` handoff; admin actions keep their existing dashboard destinations. `EMAIL_APP_URL` is no longer read or required.
- Backend `npm run verify`: all 174 tests passed. Saved outbound content uses the HTTPS handoff, allowed destinations are retained and arbitrary paths fall back to home. Previously attempted outbound bodies remain frozen for idempotent retries.
- Dashboard `npm run verify`: typecheck, all 20 unit tests, production build and session smoke checks passed. Covers the registered scheme/package, store URL validation, public access without staff cookies, malicious-path fallback and no administrative reads from the handoff page.
- Regenerated all 14 HTML/plain-text designs. Browser review confirmed the public page's canonical logo, branded layout and `rackyride:///driver-dashboard` action.
- No native phone launch or real delivery was tested. Production requires the public dashboard deployment and a phone with the native Rakky Ride build installed. Published store links remain optional owner-supplied environment settings.
