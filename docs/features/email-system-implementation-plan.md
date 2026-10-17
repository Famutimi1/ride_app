# Rakky Ride transactional email implementation plan

Date: 17 October 2026
Status: Resend and implementation approved. Signup/application workflows, branded templates, durable delivery, webhook tracking, administrative controls and the separate dashboard Email section are implemented and verified. Migration 017 is applied to the local development database. Live sending awaits provider/sender/recipient/link configuration.

Signup delivery preference clarified with the user: use the verified email supplied by Google signup directly; keep email optional for phone registration. Returning Google sign-ins do not generate another welcome email.

## Outcome

Send customers and administrators the right emails when accounts are created, drivers apply, and applications are reviewed. Add an Email section to the separate Rakky Ride dashboard so staff can see what was queued, accepted by the provider, delivered, or failed, and safely retry eligible failures.

This is application-generated transactional email. Recipients can use Gmail or another mailbox provider. Sending comes from a verified Rakky Ride domain through a transactional email provider.

## Confirmed starting point

- Mobile/backend repository: `/Users/mac/Desktop/ride_app`.
- Dashboard repository: `/Users/mac/Desktop/rakkydashboard` (Next.js 16.4).
- Existing push notifications already use PostgreSQL records, BullMQ, and Redis. There is no transactional email sender in the inspected backend.
- `backend/src/modules/auth/auth.service.ts::verifyRegistration` completes phone registration and knows whether the account was requested for a rider or driver. Phone signup currently has no email input. Account type is returned to the app; it is not a separate driver user account in the database.
- Google sign-in can create an account before phone verification finishes. Send signup emails when registration completes, not whenever the user logs in or an incomplete Google account is first inserted.
- The mobile app has optional email fields in profile setup and driver onboarding. Driver onboarding saves its email in `users.email`.
- `backend/src/modules/driver/driver.service.ts::submitApplication` handles application submission.
- `backend/src/modules/driver/admin.service.ts::reviewAdminApplication` commits review decisions, records an audit entry, and already supports replay protection and per-service decisions for rides/courier.
- The dashboard uses authenticated server-side reads and an allowlisted API proxy for mutations. Both repositories contain substantial existing changes; preserve them.

## Approved architecture

Approved: one new PostgreSQL table, `email_outbox`, and Resend as the external sending provider. Use Node's existing `fetch`, the existing BullMQ/Redis installation, and the existing notifications module; no new npm library or independently deployed service is needed.

Implementation details and launch instructions: [Transactional email](email-system.md).

The owner subsequently approved persistent dashboard switches. Migration `018_email_settings.sql` adds the single email-settings record and a control classification on outbox rows. Dashboard **Email preferences** provides a master switch and 12 individual controls; changes are audited, versioned, and enforced both when saving an email request and before provider dispatch.

Follow-on events now send privacy-preserving receipt-ready, wallet/withdrawal and support-status notices. Full financial receipts and trusted security notices remain dependent on a dedicated verified-email flow. Customer-visible support replies are not implemented because the current care note workflow stores internal notes; those notes must never be repurposed as email replies.

Why the table is necessary: saving the email request in the same database transaction as registration or approval prevents losing the message if the process stops immediately after committing the business action. It also provides delivery history, duplicate prevention, retry scheduling, and dashboard visibility. Push delivery status cannot safely represent independent email delivery status.

Why Resend: its HTTP API supports HTML/text emails, provider message IDs, idempotency keys, and delivery/bounce/complaint webhooks. If Rakky Ride already has a preferred transactional provider, substitute that choice before implementation rather than installing a second provider.

Sender configuration and admin recipients will initially live in backend environment variables and appear as configuration status in the dashboard. This avoids introducing a second settings table. Changing recipient lists in the dashboard can be a separately approved addition.

Project instruction requiring this decision: AGENTS.md section 11 says, “If a request conflicts with anything in this file, or requires a decision not covered here (new table, new dependency, architecture change), stop and ask before proceeding rather than guessing.”

## Email workflows

### Initial implementation

1. **Rider registration completed**
   - Customer subject: “Welcome to Rakky Ride, {firstName}”.
   - Confirm account creation; explain booking rides, saved destinations, and where to find support.
   - Admin subject: “New rider signup: {fullName}”. Include account ID, account type, signup time in Lagos, and an authenticated dashboard link. Avoid unnecessary private information.

2. **Driver registration completed**
   - Customer subject: “Welcome to Rakky Ride — complete your driver application”.
   - Explain personal details, vehicle details, required documents, service selection, submission, and review. Clearly state that registration does not grant driving approval.
   - Admin subject: “New driver signup: {fullName}”. Distinguish a new driver account from a submitted application.

3. **Driver application submitted**
   - Driver subject: “We received your driver application”. Confirm receipt and explain how to check status without inventing a review deadline.
   - Admin subject: “Driver application ready for review: {fullName}”. Link to the existing application review screen.
   - A rider who later applies to drive receives this application email without receiving a second account-created welcome.

4. **Driver application/service reviewed**
   - Approval subject: “Your Rakky Ride driver application is approved”. Explain approved services and the next steps in the app.
   - Rejection subject: “An update on your Rakky Ride driver application”. Include only a deliberately customer-facing explanation and resubmission guidance; never expose internal staff notes automatically.
   - Handle passenger rides and courier decisions individually. Mixed approvals/rejections and service suspensions/restorations must describe exactly what changed. Do not claim all services are approved based on the aggregate profile status.
   - Replaying the same admin request must not generate another email.

### Next workflows, using the same delivery system

Implement after the signup/application flows pass their checks, in this order:

1. Completed trip receipts, once final fare/payment state is authoritative. Identify cash versus online payment accurately and include only customer-visible receipt details.
2. Confirmed wallet top-up/refund and withdrawal requested/completed/failed/reversed notifications. Queue from the committed payment transition, including reconciliation paths. Do not announce success from a browser callback or an unverified webhook.
3. Support case acknowledgements and customer-visible staff replies/status changes. Internal notes must remain private.
4. Account security notices for sensitive contact changes, subject to verified-email handling. Email verification itself needs its own explicit token/expiry flow before email becomes a trusted security channel.

Exclude marketing campaigns, bulk mail to historical users, and emails for every live trip/location update. Keep existing push and SMS authentication flows working.

## Email collection and compatibility

- Keep phone-only registration available without requiring an email address. If an optional email field is added to the current phone registration screen, carry it through the Zustand pending registration data, registration service payloads, and backend validation.
- Google registration uses the verified email already supplied by Google; no additional email entry or Gmail inbox access is needed. Send the welcome once registration completes, including the current required phone verification. Returning Google sign-ins do not trigger signup mail.
- Reuse Google's verified address when linking a Google-created account to a phone. Do not let an untrusted request overwrite that identity address during registration.
- For any phone-only registration with no email, record the customer welcome as waiting for an address. The admin signup alert still sends, and registration is confirmed in the app. On later profile/driver-personal-info email save, resolve that pending welcome once using its saved rider/driver intent. Dashboard lists show “No email address” rather than a delivery failure for these accounts.
- Preserve one users table and existing driver profiles. Do not infer signup intent from the user's current active role at delivery time.
- Do not treat a typed email as verified or use it to link accounts. Unverified welcome messages contain no secrets, financial details, or private documents.
- Bound field lengths and reject control characters; escape all customer-provided text when rendering HTML.

## Backend implementation

Extend `backend/src/modules/notifications` with clearly named email files for types, templates, provider access, outbox persistence, queue processing, webhook handling, and admin controller/routes. Business modules import the email enqueue service rather than sending provider requests themselves.

### Outbox migration

Proposed `email_outbox` fields:

- UUID ID; optional subject user ID referencing `users(id)`; event type; business event key; audience (`customer` or `admin`).
- Stable recipient identity/address and rider/driver intent snapshot. One row per recipient so administrator addresses are never exposed to each other.
- Template name/version and the minimum payload required to render the message. Freeze the actual outbound request before the first send so provider retries reuse identical content.
- Status, attempts, next attempt timestamp, worker lease/token/expiry, and sanitized last error.
- Provider message ID, first send attempt timestamp, accepted/delivered/bounced timestamps, provider event timestamp/ID, created/updated timestamps.
- Unique event/recipient constraint; indexed queue recovery, user history, provider ID, and paginated admin listing.

Keep email bodies and addresses out of ordinary application logs. No payment-card data, OTPs, access tokens, refresh tokens, or private driver-document links in the outbox payload.

### Dispatch and recovery

1. Write outbox rows inside the existing business transaction. Transaction rollback must roll back the emails too.
2. An existing-process BullMQ worker and periodic database recovery scan discover committed pending rows. Redis outages must not discard committed email work.
3. Claim work atomically with database row locks/leases so multiple backend instances cannot independently process the same row. Perform provider I/O outside long database transactions. Use claim tokens to reject stale worker updates.
4. Use a stable provider idempotency key per frozen outbound request. Retry temporary failures with bounded exponential backoff and jitter; distinguish permanent configuration/recipient failures.
5. Resend's idempotency protection lasts 24 hours. Stop automatic retransmission of ambiguous attempts before that protection expires and require reconciliation. Do not promise exactly-once email delivery or silently resend an uncertain old attempt.
6. Track accepted and delivered separately. Provider acceptance is not proof the recipient's server accepted the message, nor proof the user read it.
7. Start/stop workers alongside the existing workers and expose useful queue/configuration health. When sending is disabled or unconfigured, keep messages visibly blocked rather than marking them delivered.

### Delivery webhooks

- Add a narrow provider-authenticated webhook route before JSON parsing, preserving the raw request bytes for signature verification.
- Verify the documented signature and timestamp, reject invalid requests, and apply duplicate events idempotently.
- Correlate events by provider ID, account for callbacks racing the send response, and prevent late events from regressing terminal delivery states.
- Track delivery, delays, bounces, failures, complaints, and suppression. Respect provider suppression on later sends; do not make retry controls bypass it.
- Keep this callback separate from the existing Paystack webhook. Staff email endpoints use existing authentication and staff scope checks.

## Dashboard Email section

Add `/admin/emails` to System navigation in `/Users/mac/Desktop/rakkydashboard` and integrate it through existing server-side reads, contracts, and the API allowlist.

- Summary counts: waiting/blocked, queued, accepted, delivered, failed, bounced/complained; use accurate status labels.
- Paginated history with filters for event, audience, status, user, and dates. Show masked recipients in lists, subject, related record, attempt count, and last update.
- Record details with sanitized errors, timestamps, associated account/application, and safe text/template preview. Never render arbitrary email HTML as executable dashboard markup.
- Retry eligible failed messages with a staff reason, request key, current-record check, and admin audit entry. No retry for delivered, actively sending, suppressed, or unresolved ambiguous messages.
- Template catalogue showing rider welcome, driver welcome, admin signup alert, application receipt, and review outcomes. Initial templates live in TypeScript so edits remain versioned and reviewable.
- Configuration panel: enabled/disabled status, sender/reply-to, masked admin recipients, API-key presence, webhook setup status, and worker health. Never return credentials to the browser.
- Authenticated super-admin test sending restricted to the configured administrative recipients, explicitly initiated from the dashboard, rate-limited and audited.
- Match existing dashboard components and responsive styles; support loading, unavailable, and empty-history states. Preview mode must never send operational email.

## Configuration and launch

Document placeholder configuration names in `backend/.env.example` and the setup guide:

- `EMAIL_ENABLED` (default false)
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `EMAIL_FROM` (verified Rakky Ride sender)
- `EMAIL_REPLY_TO` (monitored support address)
- `EMAIL_ADMIN_RECIPIENTS` (explicit comma-separated list)
- `EMAIL_DASHBOARD_URL` (trusted HTTPS dashboard origin in production)
- Optional trusted app/download URL for message calls to action; no invented store links.

Before enabling real sends, obtain the chosen provider credentials, verify the sending domain and required DNS records, set the administrator recipients, and configure the delivery webhook. A Gmail recipient does not require Gmail OAuth or the user's Gmail password. No Gmail inbox access is needed for this implementation.

Use mocked transport for tests and local template previews. Deploy the migration and both codebases with delivery disabled, verify configuration, then enable the new workflows. Do not bulk-send old signup events on launch.

## Verification and acceptance

Backend checks:

- One rider signup produces one rider welcome and one alert per configured admin recipient.
- One driver signup produces the driver-specific welcome/alerts; later application submission is a distinct event.
- Google phone linking triggers signup once; normal logins, failed OTPs, rolled-back writes, and replayed review requests generate no duplicate signup/review mail.
- Missing addresses become visible pending work and resolve once when an address is added. Invalid addresses are rejected consistently.
- Partial service approvals, rejection, suspension/restoration, and resubmission produce accurate content with no internal notes.
- Concurrent workers, worker crashes, Redis recovery, rate limits, provider timeouts, duplicate/out-of-order callbacks, signature rejection, suppression, and the idempotency-window boundary are covered.
- Staff access, pagination/filter validation, secret redaction, test-send restrictions, and audited retry replay/concurrency are covered.

Mobile/dashboard checks:

- Validate phone-only signup without email, optional email validation, Google-provided email, resend behavior, and rider/driver routing. Confirm returning Google sign-ins never resend the welcome.
- Dashboard navigation, filters, pagination, safe previews, retry feedback, access restrictions, preview mode, and narrow-screen layout work against the actual API contracts.
- Run `npm run typecheck` in backend, mobile, and dashboard; run backend isolated tests and dashboard tests/build. Do not use an operational database for test fixtures.
- Confirm a real administrative test email only after credentials and recipient configuration are supplied. Report provider acceptance/delivery evidence accurately; do not claim guaranteed inbox placement.

## Execution sequence

1. Approve the single outbox table and provider choice.
2. Add migration, email types/templates, provider adapter, outbox/worker, and focused tests.
3. Wire signup email collection, signup/admin events, application submission, and all service-review outcomes.
4. Add authenticated admin email APIs, webhook delivery tracking, health, and recovery.
5. Add and verify the separate dashboard Email section.
6. Add the next transactional events above after the core flows pass; update this document with completed scope and any deferred prerequisites.
7. Document configuration and launch checks; run required checks across both repositories and the mobile app.

## Reference documentation checked

- Expo SDK 57: https://docs.expo.dev/versions/v57.0.0/
- Resend send API: https://resend.com/docs/api-reference/emails/send-email
- Resend retry/idempotency contract: https://resend.com/docs/dashboard/emails/idempotency-keys
- Resend delivery event meanings: https://resend.com/docs/webhooks/event-types
- Before dashboard code changes, read the relevant installed Next.js documentation under `/Users/mac/Desktop/rakkydashboard/node_modules/next/dist/docs/`, as its AGENTS.md requires.
