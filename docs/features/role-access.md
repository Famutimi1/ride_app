# Rider and driver access

The active mode returned by the backend is the source for mobile screen access.
Driver approval alone does not put an account in driver mode.

## Interim shared admin/customer account policy

An active account with platform role `user`, `admin`, or `super_admin` can use the
mobile rider experience and apply to become a driver on the same user ID and
phone number. `APP_ACCOUNT_ROLES` in `auth.types.ts` is the explicit temporary
policy until dedicated RBAC replaces it. It is shared by driver enrollment,
request preferences, service eligibility, dispatch locking, and customer email.

Platform role does not grant driver approval. Driver mode, account activity,
vehicle classification, per-service approval, consent, request preferences,
online presence, active-job locks, and financial restrictions continue to apply.
Passenger and courier switches control new requests; disabling them does not
remove approval or cancel an accepted job. A service that has not been requested
must be applied for through Manage before it can be enabled.

The same account signs in through the app's existing login flow for mobile use.
App tokens remain app-scoped, and the public app user payload does not expose
staff privileges. Dashboard endpoints still require a separate staff-scoped
session and the appropriate platform role. No account role or approval is changed
by this policy, and no database migration or second registration is required.

Staff may complete driver personal details and update their display name subject
to the existing approved-driver identity checks. Their staff sign-in email and
phone remain protected by the existing staff identity rules; sending an unchanged
email in a profile form is allowed. Public profile payloads cannot set platform
roles, approval, or account activity.

Regression coverage includes both admin roles toggling requests through HTTP,
applying for courier without gaining automatic approval, switching rider/driver
mode, receiving and accepting dispatched passenger offers, inactive/unapproved
account rejection, and denial of dashboard access with an app token.

## Mobile mode access

`mobile/src/utils/roleAccess.ts` declares the audience of every signed-in route
and account section. The signed-in layout checks it before mounting the screen,
so direct links and history cannot open an opposite-mode page or start its reads.
Unknown destinations return to the current mode's home. Account sections also
check the same policy before rendering their child screen.

- Rider-only: booking, destination search, ride selection/details, scheduled
  rides, sending courier packages, rider history, payment and rider benefits.
- Driver-only: dashboard, driver trips/history, earnings, wallet/payouts,
  bank/withdrawal pages, documents, service preferences and driver rewards.
- Shared: menu, profile, settings, safety, support, notifications and trip
  communication/receipt/completion pages. Their contents follow the active mode.
- Application bridge: driver onboarding, application status and the Apply to
  drive entry remain accessible in rider mode. Applicants cannot enter driver
  operational pages before approval. Drivers with an assigned active trip can
  finish it if their approval changes; support and settings remain accessible.

Shared trip pages require the signed-in user to be the participant for the
current mode: `rider_id` in rider mode, `driver_id` in driver mode. Call/chat also
require the requested trip to be the user's actual active, assigned trip. Chat
filters messages by trip ID and starts without a fabricated welcome message.
Receipts and both history views reject opposite-mode data.

A confirmed backend mode change clears trip/offer state, courier drafts, route
state, wallet caches and the notification context. Shared screens remount for the
new account/mode. Late trip, receipt, finance and profile results cannot repopulate
the previous mode. Trip recovery only asks for driver offers in driver mode, and
the global offer overlay requires driver mode and approval. Top-up targets follow
the active mode: rider wallet or driver commission balance; URL parameters cannot
select the other mode's target.

These mobile checks supplement existing server authentication, participant
ownership, driver eligibility and trip state-machine checks. They do not grant
device permissions, start driver availability, create accounts, or move money.

Validation: `mobileRoleAccess.test.ts` exercises the actual mobile policies,
layout, stores and hooks with controlled network responses, including route
inventory coverage, direct links, cross-mode receipt/contact access and late
responses. Existing session, notification, care, settings and permission tests
remain regression coverage. Backend test runs use disposable local databases.
