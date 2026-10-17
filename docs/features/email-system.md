# Transactional email

Rakky Ride uses the existing backend, PostgreSQL and BullMQ/Redis to deliver transactional email through Resend. The separate dashboard has an **Email** page at `/admin/emails`.

## What sends an email

- Completed rider/driver registration: a role-specific welcome to the customer and a separate signup alert per configured administrator.
- Google registration: use the verified email already returned by Google, once the existing required phone verification completes. Normal logins never resend the welcome.
- Phone-only registration: still succeeds without email. The admin alert sends; the welcome remains `waiting_email`. Adding an address through profile settings or driver onboarding releases that welcome once.
- Driver application submission: acknowledge the application and notify administrators. Repeating the same service submission does not duplicate email. Adding a second service as an approved driver also notifies the applicant and administrators.
- Driver service review: send the current passenger/courier decisions, including approval, rejection, suspension and restoration. Internal review notes are excluded. Replaying an admin decision does not duplicate email.
- Confirmed wallet top-ups, refunds, withdrawal requests/outcomes, completed trips/package returns, and support status changes: send a short activity notice linking to the appropriate authenticated app screen. These reuse committed notification events, including payment reconciliation paths.

Financial amounts, complete receipts, private support messages and driver documents stay inside the app. A contact email typed by a customer is not proof of ownership. Detailed financial emails, trusted security notices and customer-visible support replies require additional verified-email/reply handling; this implementation does not turn existing internal notes into external replies.

Push preferences are separate from transactional email. This system does not send marketing or live location/offer messages by email. It does not send retrospective emails to existing accounts on deployment.

## Brand and links

HTML templates use white/silver surfaces, forest-green actions and the canonical Rakky Ride transparent PNG. Colors are generated from `mobile/src/constants/colors.ts`; there is no independently maintained email palette. Inline styles, presentation tables, system fonts, image alt text and a plain-text alternative support common mail clients. No scripts or external fonts are used.

Run `npm run sync:email-brand` in `backend` after changing the canonical palette, and run the dashboard's existing `npm run sync:brand` if the shared logo changes. Commit the generated email JSON with its source change. The palette checksum test detects drift.

Customer buttons use HTTPS links to the existing dashboard's public `/open-app?path=...` page. This branded page has an **Open Rakky Ride** button using the app's existing `rackyride` scheme. Only the known home, application, driver, trips, wallet and support destinations are accepted; arbitrary URLs and query data fall back to `/home`. No account details, tokens or staff login are needed on the public page. The mobile app's existing authentication and service permissions still apply. A signed-out customer signs in through the normal app flow and may then need to navigate to the relevant section.

Set only `EMAIL_DASHBOARD_URL` for both admin links and this customer handoff. `EMAIL_APP_URL` is no longer read or required and can be removed from existing environments. No separate mobile web deployment is needed. The email opens the HTTPS page first; the customer taps its button to launch the installed native app. If an email's in-app browser blocks app launching, open the page in the phone's regular browser. Desktop browsers cannot launch the phone app; read the email on the phone instead. Expo Go does not register this production scheme; use a native development or production build.

Optional `RAKKY_ANDROID_STORE_URL` and `RAKKY_IOS_STORE_URL` in the dashboard environment show published Google Play/App Store links when available. Empty settings hide store buttons. Android links must match the existing `com.rackyride.app` package; iOS links must be App Store listing URLs. No listing is invented. Install first, then return to the email: this is not deferred deep linking or automatic installation detection. Dashboard `npm run sync:brand` also synchronizes the native scheme/package from `mobile/app.json`.

Admin links target the existing rider/driver directory, application review or email dashboard. Support links use `EMAIL_REPLY_TO`, or the app support screen if no reply-to is set. The public dashboard asset `/brand/rakky-ride-logo.png` is the default logo source. Check that this PNG is publicly reachable over HTTPS; Gmail cannot load a logo from localhost. `EMAIL_LOGO_URL` can point to the same canonical image on another trusted public HTTPS asset host.

## Turn email types on or off

Open **System → Email → Email preferences** in the dashboard. A super-admin can change the switches, then select **Save email preferences** and record the reason. Other staff can view the saved settings.

The **Allow email sending** master switch controls all emails, including administrative test sends. Individual switches control rider welcomes, driver welcomes, admin signup alerts, application acknowledgements, admin application alerts, approvals, rejections, mixed/service decisions, top-ups/refunds, withdrawals, trip receipt notices, and support updates.

These choices are saved in the owner-approved `email_settings` table (migration `018_email_settings.sql`). They apply across backend instances without restarting the server. `EMAIL_ENABLED` remains the separate deployment gate: dashboard switches cannot enable delivery while it is false or while provider configuration is missing. Initial saved preferences allow all types, preserving existing behavior until the owner makes a selection.

Turning a type off skips its unattempted pending messages and records future events as skipped. Turning it back on affects new events only; it never replays skipped messages. Messages with an earlier provider attempt are held as uncertain if their pending retry is disabled, since the earlier request may already have been accepted. Requests already in flight can still complete. Manual retries cannot bypass the switches, recipient suppression or the provider retry window. Existing sent/delivered and known terminal failure history is retained.

Each save uses a version check and an idempotent request key. Concurrent edits cannot silently overwrite each other. Changes are recorded under `email_settings_updated` in the audit log with their before/after choices. No provider credentials are editable through these controls.

## Configure Resend

1. Verify a Rakky Ride sending domain in Resend and publish the DNS records shown by the provider.
2. Create a sending API key and put it only in the backend environment. Never add it to `EXPO_PUBLIC_*` or dashboard client configuration.
3. Set `EMAIL_FROM` to the verified sender, optionally including the display name, such as `Rakky Ride <your verified address>`. Set `EMAIL_REPLY_TO` to a monitored support mailbox.
4. Set `EMAIL_ADMIN_RECIPIENTS` to explicit comma-separated mailboxes. Gmail recipients work without Gmail OAuth. The system does not automatically email every staff account.
5. Set `EMAIL_DASHBOARD_URL` to the public HTTPS dashboard origin. Deploy the dashboard's public `/open-app` page and check it on a phone with the native app installed. Optionally set `EMAIL_LOGO_URL` and the dashboard's published store-link settings.
6. Configure Resend to POST delivery events to the backend's `/webhooks/resend`, and save its signing secret as `RESEND_WEBHOOK_SECRET`. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained` and `email.suppressed`.
7. Keep `EMAIL_ENABLED=false` while deploying migrations `017_email_outbox.sql` and `018_email_settings.sql` and both applications. Run `npm run migrate` from `backend` using the intended deployment database, then build and restart the backend and dashboard. Review your saved email preferences before enabling delivery.
8. Review the dashboard configuration and worker status, set `EMAIL_ENABLED=true`, restart the backend, and use **Send test email** as a super-admin. It queues only to configured admin recipients, is audited, and is limited to three requests per staff account per hour.

The environment example lists all variables. Defaults do not contain real sender addresses, provider credentials or invented domain names. Sending remains disabled until the sender, key and dashboard origin are configured. Administrators not configured yet produce visible `waiting_admin` records; adding recipient configuration and restarting allows recovery to fan them out.

Turning sending on releases emails saved while disabled; it does not create signup events for historical users. Review the saved backlog in the dashboard before enabling a deployment. Already attempted requests retain their original sender/content/links for retry idempotency.

## Delivery and recovery

`email_outbox` is written inside the same transaction as signup, application review or the source notification. Database rollback removes the email request as well. One durable row is stored per event and recipient. Redis schedules rows already in PostgreSQL; it is not the only copy of the work.

The email worker scans every 15 seconds, claims rows with PostgreSQL locks and a two-minute lease, and performs provider requests outside the transaction. Claim tokens prevent expired workers from overwriting newer results. Temporary failures have up to five automatic attempts with backoff/jitter. Current account activity, address changes, administrative recipient removal and prior bounce/complaint/suppression are checked before sending.

Resend requests reuse a stable idempotency key and a frozen body. Automatic sends stop 23 hours after the first attempt, inside Resend's 24-hour idempotency window. An expired or unresolved outcome becomes `uncertain`, requiring provider inspection rather than blind retransmission. Configuration/recipient rejection is not automatically retried. Staff may retry eligible known temporary failures within the same window, with a reason, request key and current version; the original provider key/body are preserved.

`accepted` means Resend accepted the API request. `delivered` means the recipient's mail server accepted it; this does not prove inbox placement or that the user read it. Raw-body webhook signatures and a five-minute timestamp tolerance authenticate delivery events. Signed outbox tags handle callbacks arriving before the send response. Duplicate callbacks are safe, delayed events do not overwrite delivery, and bounce/complaint/suppression outcomes block later sends to that address.

No body, API key or webhook secret is printed in application logs or returned in configuration responses. History masks recipient addresses. Preview/detail access and mutations require a current staff session; detail inspection, retries and test sends are audited. The dashboard proxy enforces its existing origin checks and operation allowlist.

## Preview and verify

From `backend`:

```sh
npm run preview:emails
npm run verify
```

The preview command writes 14 HTML/plain-text examples to the project-root `email-templates/` folder, with a visual gallery at `email-templates/index.html`. Separate examples cover approvals, rejections, mixed decisions and suspensions. The unchanged canonical PNG is saved once in `email-templates/assets/`, so the library works offline without embedding large image data in each HTML file. The folder's README explains which source to edit for live changes and how to preserve experimental review drafts before regenerating.

The existing `backend/docs/email-previews/` folder receives a compatibility copy of the same gallery. All review links use explicit `example.test` fixture addresses; they are never production sender configuration. The dashboard catalogue uses the deployment's actual configured links and isolates HTML previews in sandboxed iframes.

From `mobile`, run `npm run typecheck`. From `rakkydashboard`, run `npm run verify`. The backend runner uses a disposable local PostgreSQL database and Redis process; it strips email credentials and disables delivery for the general suite. Email tests replace transport with fixtures; they never contact Resend or actual mailboxes.

Reference contracts: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys), [webhook meanings](https://resend.com/docs/webhooks/event-types), and [Svix manual signature verification](https://docs.svix.com/receiving/verifying-payloads/how-manual).
