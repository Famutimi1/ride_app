# Rider and driver settings

Settings now follows the signed-in user's active role, rather than whether their driver application has ever been approved. Rider mode does not expose driver request controls, even for an approved driver. Driver mode does not include rider payment-method shortcuts or scheduled ride notification preferences.

Separate content definitions live in `mobile/src/constants/settings/driver.ts` and `rider.ts`. The shared Settings UI keeps the existing compact type, small semantic icons, theme tokens, scrolling, appearance picker and logout flow. The unused Privacy and data / Coming soon row has been removed.

Driver settings is limited to Appearance settings, Service settings, Notification settings, Location settings and Log out. Duplicate profile, documents, payout, application-status, safety, support and notification-history shortcuts were removed from this page. Those features remain available in the existing menu, vehicle/documents, notification center and wallet flows. Notification settings also omits the driver's duplicate history shortcut. Rider settings retains its existing content. The three driver settings links open their existing preference screens; no values or permissions are changed by this simplification.

The notification preferences panel also follows active mode. Driver mode shows ride/courier offers, driver trip updates, earnings/payout alerts, promotions, sound and vibration. Rider mode shows trip updates, scheduled ride reminders, wallet/payment alerts, promotions, sound and vibration. The existing preference keys and backend storage are preserved. Trip, wallet and general alert preferences remain account-wide, and the page explains this; there is no second persistence layer or fake independent setting. Hidden opposite-role controls cannot be saved through a stale callback.

Location access has its own page. Installed apps read actual device location-service, foreground and (driver only) background permission states through existing location-service helpers. Reading the page never requests access, changes online status, fetches GPS coordinates or starts tracking. OS permissions are managed through the device settings button. On web, the page provides browser instructions, with no native settings call or fabricated background permission. Errors clear previously loaded permission status rather than presenting stale Allowed text as current. Returning to the app refreshes the status.

Controllers are remounted by account/role and reject late callbacks from the previous context. Driver-services settings also redirects rider-mode deep links back to Settings. The existing logout behavior still handles failed remote revocation after local credentials have been cleared, with duplicate-action protection.

## Validation

Focused tests in `backend/src/modules/notifications/mobileSettingsRoles.test.ts` use the actual mobile content, controllers, views and helpers with controlled network/native dependencies. Existing native notification permission tests are run alongside them. Coverage includes role visibility/routes, rider mode for an approved driver, opposite-mode deep links, stale callbacks, logout cleanup/failure, real notification keys, request/register/save order, refused permission, late permission answers after a mode change, driver-only background reads, browser fallbacks, stale permission errors and unmounted requests.

Browser checks cover driver Settings → Notifications and Location access, the role-specific notification controls, browser location guidance, and narrow 320 × 640 rider/driver/settings/notification/location layouts with no horizontal overflow. Sample permission states and callbacks in temporary previews are fictional and inert; no live notification preferences, OS permissions, account role, service consent, payout settings or logout are changed. Temporary preview routes/tabs are removed after verification. Physical Android/iOS settings and permission integration still require a device check.

No backend business logic, database migration, dependency or native permission declaration changes are required.
