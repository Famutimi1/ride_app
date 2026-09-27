# Rakky Ride implementation and release checks

Updated 22 September 2026. Rebrand code is implemented. Native release acceptance
is still pending; prebuild and web previews do not establish production launch behavior.

## Implemented

- Supplied background-free logo used in the welcome/auth/account UI, native splash,
  launcher configuration, and favicon. Both original images are archived unchanged.
- Forest-green actions, white/silver light surfaces, charcoal dark surfaces, and
  distinct success, warning, and danger tokens. Existing Inter typography and local
  compact-radius changes are preserved. Maps continue using real Google Maps.
- Common inputs, component gallery, onboarding SVGs, rider/driver screens, wallet,
  account sections, product wording, and permission descriptions aligned to Rakky Ride.
  Sign-up collects the rider name separately from the phone number, and both auth
  entry points link to a dedicated phone-and-OTP login screen at `/login`.
- Settings expose Light, Dark, and System with accessible checked states. Stored
  theme choices and integration identifiers are preserved.
- Auth/UI hydration finishes after failed storage reads without writing defaults
  over stored data. Server rendering skips browser storage. The splash still waits
  for font completion/failure and store hydration; no artificial delay was added.
- Design guidance, Expo notes, changelog, and the saved task tracker updated.

## Asset and native configuration

Runtime source: `mobile/assets/images/brand/rakky-ride-logo.png`, 1501 × 1501 RGBA.
Its SHA-256 is `7392476d750e5dfec1ddae47717b42d6f6013038fad0f78700157f225f091361`,
identical to the archived second source. No artwork was regenerated or recolored.
The source includes generous transparent margins and a faint stray edge pixel;
the main mark occupies approximately x233–1225 and y307–1290. The shared BrandLogo
uses a proportional layout window rather than changing the source pixels.

Native splash uses contain scaling, imageWidth 288, and palette-derived white or
charcoal backgrounds. This width includes the source's transparent margins and
must be checked on devices. Native appearance follows the OS before JavaScript;
a differing saved app preference produces an intentional theme transition.

Expo generates platform images from this source during prebuild. Android and iOS
prebuilds succeeded. The generated iOS icon is 1024 × 1024 and fully opaque.
The previous template icon overrides are no longer referenced. No custom Android
monochrome mark was invented; themed-icon fallback and small-size readability need
device review. A cleaner vector/small-icon export can be supplied by the designer.

Generated `mobile/android/` and `mobile/ios/` projects are ignored build outputs;
the tracked config and logo reproduce them. Dynamic config was validated with
Node 24.20.0. Package/slug `famutimi`, scheme `famutimi`, native ID
`com.famutimi.ride`, and AsyncStorage keys remain unchanged.

## Verification completed

- `npm run typecheck`: passed after final component changes.
- `git diff --check`: passed.
- `npm run lint`: passed with zero errors and zero warnings. Both baseline errors
  are now resolved: query-specific autocomplete state replaces effect resets, and
  the trip sheet retains a stable gesture responder without reading refs in render.
- Six focused component checks pass for out-of-order results, clearing a query,
  cancelled errors, unmounting, drag limits, and gesture interruption. These run the
  actual transpiled components with mocked hooks/native services; they do not
  replace device interaction testing. See [regression evidence](evidence/interaction-regressions.json).
- 22 contrast pairs pass their 4.5:1 text or 3:1 boundary targets. See
  [contrast results](theme-contrast.json).
- Eight actual-store runtime checks passed using real Zustand and mocked storage:
  saved values, read failures, read/write failures, and server rendering for both
  stores. Hydration performs no storage writes. See
  [hydration evidence](evidence/hydration-checks.json).
- Browser smoke checks used the existing local mock auth service with a synthetic
  number. Sign-in, role switching, logout, dark preference persistence, and system
  preference persistence were exercised. No real SMS, payment, or payout was sent.
- All 19 account sections mounted in both themes. See
  [account route evidence](evidence/account-route-checks.json).
- Browser captures cover welcome, phone, home, destination, ride selection/details,
  ongoing trip, driver dashboard, wallet, payment, menu, settings, and gallery.
  Viewports were 390 × 844, plus a 320 × 640 welcome check. These verify rendered
  UI, not real trip dispatch, Paystack, native permissions, or map-provider availability.
- Selected appearance is exposed as a checked radio control on the web.
- Android and iOS `expo prebuild --platform <platform> --no-install`: passed.
  Generated splash resources contain the expected light/dark backgrounds.

Example captures:

- [Welcome light](evidence/after-welcome-light.png) / [dark](evidence/after-welcome-dark.png)
- [Compact welcome](evidence/after-welcome-small-dark.png)
- [Gallery light](evidence/after-gallery-light.png) / [dark](evidence/after-gallery-dark.png)
- [Wallet light](evidence/after-account-driver-wallet-light.png) / [dark](evidence/after-account-driver-wallet-dark.png)
- [Appearance settings](evidence/after-settings-dark.png)

## Remaining release tasks

1. Repeat browser address-search and trip-sheet interactions after the lint fixes.
   The Mac became locked before this final browser pass; an unlock was requested.
   Earlier visual checks and the focused mocked-component regression checks passed.
   The original local changes remain archived in [the baseline patch](evidence/pre-rebrand.patch).
2. Build an Android release binary. The offline attempt lacked
   `com.android.tools.lint:lint-gradle:31.12.0`; the dependency-download request was
   declined. No release APK was produced, and that request was not retried.
3. Build iOS with Xcode and install both release builds on test devices. Xcode and
   its simulator are unavailable in this environment; prebuild alone is insufficient.
4. Verify cold starts: signed in/out, offline, failed fonts/storage, and mismatched
   OS/app appearance. Check splash size/transition, launcher masks, themed-icon
   fallback, status bars, large text, keyboard layouts, and screen readers.
5. Exercise native map/location permissions, booking/tracking, driver request states,
   and modal/error paths. Test integrations in their configured test environment.
6. Attach device/build details and screenshots to the plan before closing R06–R13.

Native splash/icon updates require a new binary; an OTA-only update is insufficient.
Store submission or deployment has not been performed. For rollback, use a reviewed
revision restoring prior assets/config/tokens together, preserving unrelated local
edits, and rebuild the native binary. Do not reset the entire working tree.
