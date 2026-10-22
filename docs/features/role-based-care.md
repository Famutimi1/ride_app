# Rider and driver Safety / Support

The active role in the auth store selects separate content definitions under `mobile/src/constants/care/rider.ts` and `driver.ts`. Shared UI keeps the established compact typography, theme tokens, emergency actions, support settings loader and error states. There are no new dependencies, backend endpoints or database changes.

Driver Safety replaces rider vehicle-matching advice with vehicle checks, safe pickups, safe phone use and protection of login/payout codes. Driver incident guidance covers passenger concerns, accidents/breakdowns and courier safety when relevant. The unused Trusted contacts placeholder is omitted for drivers. The driver active-trip header now has a direct Safety button.

Driver Support links to Driver trips, Driver wallet/payouts, Vehicle & documents, Services/request preferences, Application status and Account. Its answers cover pickup problems, recorded fare/commission/earnings, payout status, documents and going online. Rider content retains booking/payment holds, receipts and vehicle matching, with a lost-item contact guide.

Service-specific articles follow actual approval or current trip type. A courier-only driver does not see passenger articles. A service can still have relevant help when its request toggle is off or renewed consent is required; help content does not grant service eligibility or change any preference.

Trip actions require an active trip belonging to the signed-in participant in the current role. Terminal, scheduled, stale, other-role and other-account trips cannot enable sharing. Driver sharing contains only a trip reference, service and available vehicle details; it excludes passenger identity/addresses, recipient contacts, package contents, handoff codes and GPS coordinates. Rider sharing preserves the established route/vehicle summary.

Safety contact navigation opens the existing Support page with a safety topic. An email action opens the configured email client with a role/topic subject only, with no automatic message or private trip details. The staff-configured contact details and availability remain shared; separate driver staffing/contact endpoints have not been invented. Customer incident submission remains a separate feature: the current customer care API supplies contact settings, while incident creation is staff-only.

## Sources reviewed

These are references for topic organisation, not claims that Rakky Ride has another platform's features, policies or staffing:

- [Uber driver and delivery support](https://help.uber.com/en/driving-and-delivering?previewmode=true): driver topics include trips, earnings, account/app, delivery and safety.
- [Uber driver safety topics](https://help.uber.com/en/driving-and-delivering/section/safety?nodeId=9f5e0b5d-196e-4f19-82b0-67474630f54c): distinct driver concerns such as rider incidents, accidents and suspicious packages.
- [Lagos State emergency contacts](https://www.lagosstate.gov.ng/connect) and [Citizens Gate](https://citizensgate.lagosstate.gov.ng/): confirm the existing 112/767 emergency contacts.

## Verification

Focused tests in `backend/src/modules/notifications/mobileCareRoles.test.ts` exercise the actual mobile helpers, content, controllers and views with controlled native/network dependencies. They cover role/service content, eligibility and ownership of active trips, private-data exclusion from driver shares, role-specific destinations, email subjects, duplicate/stale share actions, guarded support navigation, available contact controls, and the driver in-trip Safety action.

All 11 focused tests passed. Mobile TypeScript, the backend build performed by the isolated test runner, targeted mobile ESLint and whitespace checks passed.

Browser checks use actual driver navigation plus inert, fictional previews for rider/courier variants. Narrow 320 × 640 checks cover both rider pages and courier support, expandable guidance, wrapped text and scrolling. No emergency calls, external email, real trip sharing, service application, payout or role switch is performed. The preview route and temporary tab are removed after verification. Native Android dialer/share-sheet integration remains untested by this change.
