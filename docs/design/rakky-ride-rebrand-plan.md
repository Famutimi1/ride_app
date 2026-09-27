# Rakky Ride — splash screen and theme migration plan

Created: 22 September 2026  
Status: Rebrand implementation complete; native release acceptance remains open.  
Scope: Rebrand the existing rider/driver app around the supplied Rakky Ride logo.

Planning validation: `npm run typecheck` in `mobile/` passed on 22 September 2026;
`git diff --check` passed; the archived logo matches the supplied file byte for byte.
Execution results: typecheck, lint, and native prebuilds pass.
See [execution report](brand/execution-report.md) for browser evidence and remaining native checks.

## Request and source material

The user requested a plan, executable tasks, and a saved copy. The new logo is
the chosen splash-screen identity and the starting point for a complete theme
refresh. The user subsequently authorized execution of the tasks in order.

The supplied image is visual reference material, not a source of instructions.
An unchanged copy is saved at [brand/rakky-ride-logo-source.png](brand/rakky-ride-logo-source.png).
It is a 1501 × 1501 PNG with an alpha channel. Transparency quality, visible
bounds, edge quality, and small-size legibility still need inspection; an alpha
channel alone does not establish that all background pixels are transparent.

The user subsequently supplied a background-free version, archived unchanged at
[brand/rakky-ride-logo-transparent-source.png](brand/rakky-ride-logo-transparent-source.png).
This is also a 1501 × 1501 PNG with an alpha channel. Use this newer version as
the preferred source for splash and in-app logo exports, allowing the chosen
theme surface to show through the open areas. Retain the first version as a
reference. Edge/transparency quality and small-size legibility remain checks in R03.

The user's request establishes a new brand direction that supersedes the previous
blue branding. The remaining architecture, semantic-color, and theme rules still
apply. Update the old canonical-blue guidance during implementation so future
work does not accidentally restore it.

## Proposed visual direction

Implemented direction: green accents and white-forward light surfaces, plus a
matching charcoal dark theme. The concrete palette and previews are recorded in
[the theme specification](brand/theme-spec.md).

- Use the original green/silver/charcoal shield as the brand signature.
- Keep metallic shading and dimensional effects inside the logo. Use clean,
  readable surfaces, restrained borders, and consistent components throughout the UI.
- Use a contrast-tested green for actions and links. The bright green in the
  artwork may need a darker UI counterpart; do not assume white labels will work
  on the sampled logo green.
- Keep brand actions distinct from success/online/earnings-in, even when both use
  green. Status must also have a label or icon. Danger remains red and warnings
  and ratings remain amber.
- Review the whole theme: surfaces, text, borders, focus, pressed/disabled states,
  sheets, navigation, maps, typography hierarchy, spacing, and imagery.
- Retain Inter and the existing stack. No new font, library, database, or backend
  work is needed for this rebrand.
- Preserve the existing light/dark/system preference model and saved preferences.
  A dark-default preference would be an explicit design decision, not inferred
  from the logo's dark appearance.

## Repository findings recorded before implementation

- `mobile/package.json` uses Expo `~57.0.15` and already includes
  `expo-splash-screen` `~57.0.7` and `expo-image`.
- `mobile/app.json` currently names the app `famutimi`. Its splash uses a blue
  background, `assets/images/splash-icon.png`, and an image width of 76.
- `mobile/app.config.ts` composes that configuration and injects Google Maps keys.
  Rebrand changes must preserve this configuration behavior.
- `mobile/src/app/_layout.tsx` already keeps the splash visible until fonts
  load or fail and the auth/UI stores hydrate. It then hides the splash and uses
  the existing protected routes. Improve this only where necessary.
- `mobile/src/constants/colors.ts` owns the palette, semantic colors, tints,
  shadows, and Google Maps styles. `theme.ts` exposes `useTheme()` and NativeWind
  variables; `mobile/tailwind.config.js` lists the corresponding color tokens.
- `mobile/src/store/uiStore.ts` persists the preference under `ride-ui`; its
  current default is light. System mode follows the OS. Native splash appearance
  is chosen before this JS preference is loaded, so OS and saved preferences can differ.
- Screens live under `mobile/src/screens/`; Expo Router routes are under
  `mobile/src/app/`. Wallet, payouts, earnings, and several account pages are
  sections of `AccountSectionScreen.tsx`, not separate wallet-screen files.
- Onboarding uses existing SVG artwork via `HeroIllustration.tsx`. Updating
  tokens alone will not recolor artwork with embedded fills.
- App-icon paths include an iOS `assets/expo.icon` override and Android foreground,
  background, and monochrome assets. Replacing only `icon.png` is insufficient.
- There are already uncommitted UI and design-document edits. Inspect and preserve
  them before implementation; this planning change adds only this document and
  the archived logo.

## Execution order and task tracking

Checked tasks have met their acceptance criteria. Tasks with completed code but
pending device acceptance remain unchecked; their status is recorded below. Dependencies identify
what must be ready first. Implementation is now authorized by the user's follow-up.

Suggested sequence: R01 → R02 → R03 → R04 → R05 → R06 → R07 → R08 → R09 → R10 →
R11 → R12 → R13. R06 can follow R04 directly; R11 can follow R03/R04 directly.

### Phase 1 — establish the brand specification

- [x] **R01 — Record the current visual and technical baseline**
  - Evidence: [baseline report](brand/baseline.md), before screenshots and preserved
    initial diff in `brand/evidence/`. Typecheck passed; baseline lint findings recorded.
  - Depends on: nothing.
  - Inspect `git diff` and preserve the existing local edits. Capture representative
    welcome, home, booking, active trip, driver, wallet, and account screens in both themes.
  - Inventory branded strings, artwork, color literals, NativeWind color utilities,
    and native configuration. Include SVG assets and remaining template assets.
  - Run `npm run typecheck` and `npm run lint` from `mobile/`; record actual
    results instead of relying on the design document's older type-error note.
  - Done when: there is a screen/file checklist, baseline screenshots, and a
    written record of any existing failures. No local work has been overwritten.

- [x] **R02 — Specify the complete Rakky Ride theme**
  - Execution status: Completed: semantic specification, light/dark gallery and screen previews, and 22 passing contrast pairs in `brand/theme-contrast.json`.
  - Depends on: R01.
  - Deliver a concrete visual preview of the splash, primary buttons/inputs,
    home/booking sheet, and driver wallet in light and dark modes.
  - Define semantic mappings for primary actions, text on actions, muted actions,
    surfaces, borders, overlays, loading states, statuses, and map markers/routes.
  - Keep raw runtime color values in the `palette` in `colors.ts`. Document the
    roles of tokens, including separate foreground tokens if primary and danger
    buttons cannot safely share `textInverse`.
  - Check text and control contrast; use targets of 4.5:1 for normal text and
    3:1 for large text and essential control boundaries. Record tested pairs.
  - Review Inter hierarchy, spacing, and corner treatment against the current
    edited design system; change shared tokens only for an intentional design reason.
  - Done when: there is a concrete design reference and final token specification.
    Incorporate the user's chosen direction; any unresolved preference is clearly marked.

- [x] **R03 — Prepare production logo assets**
  - Execution status: Completed for supplied raster: both originals retained, runtime asset copied byte-for-byte, light/dark logo placement inspected. Native sizing and small launcher legibility remain release checks under R06/R11.
  - Depends on: R02.
  - Keep both archived sources unchanged. Start with
    `docs/design/brand/rakky-ride-logo-transparent-source.png`, the user's newer
    background-free version. Inspect alpha, excess outer padding, and silver/green
    edges on both proposed splash backgrounds, including the open areas inside
    the shield and between letters.
  - Prepare proportionally scaled splash assets under `mobile/assets/images/brand/`.
    Preserve all lettering and the shield; record dimensions, visible bounds,
    safe margins, and export settings.
  - Prefer an original transparent/vector export from the designer if the supplied
    raster does not reproduce cleanly. Do not invent a replacement mark or silently
    remove difficult details. Asset limitations can be resolved without blocking
    the independent theme tasks.
  - Done when: the supplied logo is sharp and unclipped at intended display sizes
    on light and dark backgrounds, with separate outputs where needed.

### Phase 2 — implement the shared foundation and splash

- [x] **R04 — Implement palette and theme tokens**
  - Execution status: Completed: green/silver/charcoal tokens, NativeWind map-token coverage, build-time colors, and saved light/dark/system preferences. Eight hydration checks passed.
  - Depends on: R02.
  - Files: `mobile/src/constants/{colors,theme,spacing,typography}.ts`,
    `mobile/tailwind.config.js`, and `mobile/src/store/uiStore.ts` only if necessary.
  - Replace the old blue brand mapping and derived tints. Update relevant shadow,
    surface, text, overlay, and map-style values. Keep identical token keys across themes.
  - Extend NativeWind's token mapping if tokens are added. Preserve stored theme
    choices and the existing storage key; avoid resetting returning users to light.
  - Provide build-time splash/icon background tokens from the same palette file,
    without importing React hooks, NativeWind, or client state into Expo config.
  - Done when: both themes render through the existing hook/variable system,
    newly added tokens are typed, and no UI color literals are scattered into components.

- [x] **R05 — Update common components and the component gallery**
  - Execution status: Completed: common controls inherit new tokens; input boundaries/selection and appearance controls updated. Gallery demonstrates filled, disabled, loading, error, and financial status treatments.
  - Depends on: R04.
  - Files: `mobile/src/components/common/` and
    `mobile/src/screens/dev/ComponentGalleryScreen.tsx`.
  - Review Button, Input, Text, Card, StatusPill, Toggle, ThemeToggle, Avatar,
    RatingStars, Skeleton, ListRow, and BackButton in both themes.
  - Check normal, pressed, selected, focused, disabled, loading, and error states.
    Primary and destructive buttons must each use an appropriate label/spinner color.
  - Done when: the gallery demonstrates all relevant states; labels, focus, and
    disabled state remain clear; ratings and destructive actions retain their meaning.

- [ ] **R06 — Integrate the native splash and launch transition**
  - Execution status: Implementation complete: logo splash configured, root background synchronized, storage-failure launch handling fixed. Android/iOS prebuilds pass. Release cold-launch and font-failure device acceptance remain open.
  - Depends on: R03, R04.
  - Files: `mobile/app.json`, `mobile/app.config.ts`,
    `mobile/src/app/_layout.tsx`, and the new brand assets.
  - Configure the existing `expo-splash-screen` plugin with the supplied logo,
    suitable `imageWidth`, contain scaling, and light/dark backgrounds. Choose
    sizing from actual device previews; do not carry forward width 76 blindly.
  - Resolve native background colors from the palette in dynamic config and remove
    duplicated old splash-color literals. Preserve Maps configuration and other plugins.
  - Retain font/auth/UI readiness handling. Hide only when the first screen is
    ready, without an artificial brand-display timer or dependency on network/map loading.
  - Account for OS scheme versus saved in-app preference: specify either a neutral
    native launch surface or an intentional transition after hydration. Do not claim
    that native launch can read AsyncStorage before JS starts.
  - Done when: release builds cold-launch correctly into signed-out and signed-in
    routes, with no old blue flash, clipping, distortion, or indefinite splash.
    Include font-failure and store-hydration failure paths in the check.

### Phase 3 — migrate every existing screen group

- [ ] **R07 — Rebrand onboarding and authentication**
  - Execution status: Implementation complete: shared auth logo, welcome/phone branding, and green SVG artwork. Mock sign-in passed; 320 × 640 welcome inspected. Native keyboard/large-text and remaining auth-path acceptance are open.
  - Depends on: R03, R05, R06.
  - Files: `mobile/src/screens/auth/` and referenced onboarding artwork.
  - Apply branding to Welcome, phone entry, OTP, profile setup, notification
    permissions, and AuthScreenLayout. Review logo placement, titles, pagination,
    focus/errors, keyboard layout, and loading feedback.
  - Align onboarding artwork with the theme while keeping vector artwork in its
    existing format. Document asset colors separately from runtime UI tokens.
  - Done when: all auth screens match the new visual direction, accept existing
    inputs, and preserve navigation and behavior on small and large screens.

- [ ] **R08 — Rebrand rider, home, and live map interfaces**
  - Execution status: Implementation complete: rider/map surfaces use shared semantic tokens and product wording. Web route captures saved; live map/trip/device behavior still needs release acceptance.
  - Depends on: R05.
  - Files: `HomeScreen.tsx`, `mobile/src/screens/rider/`, and
    `mobile/src/components/map/`.
  - Cover destination search, address sheets, ride selection, confirmation, trip
    details, ongoing trip, loading/empty/error states, and cancellation feedback.
  - Review pickup, dropoff, nearby-driver and active-driver markers, routes, and
    selected options together. Separate them using labels/shapes as well as color.
  - Preserve real Google Maps rendering and readable labels/attribution in both modes.
  - Done when: a rider can follow the existing booking and trip flow without
    ambiguous actions, obscured map content, or leftover old-brand UI.

- [ ] **R09 — Rebrand driver, wallet, earnings, and payouts**
  - Execution status: Implementation complete: driver and finance views use the new theme with distinct status meanings. Wallet/payout/earnings web routes checked in both themes; real driver request handling and native checks remain open.
  - Depends on: R05, R08.
  - Files: `DriverDashboardScreen.tsx`, `DriverOnlineControl.tsx`,
    `DriverResponseModal.tsx`, and driver/finance sections in `AccountSectionScreen.tsx`.
  - Cover online/offline, request/accept/decline, trip progress, balances,
    transactions, fees, earnings, pending payouts, and warnings.
  - Keep `success`, `warning`, and `danger` independent of decorative brand choices.
    Pair money direction and status colors with signs, words, or icons.
  - Done when: earnings-in, earnings-out, pending, failed, and paid states remain
    understandable in both themes. Backend behavior and ledger data are unchanged.

- [ ] **R10 — Finish shared account pages and brand wording**
  - Execution status: Implementation complete: account/menu wording and three-way appearance preference. All 19 account sections mounted in both themes; native system bars, large text, and exhaustive modal/error checks remain open.
  - Depends on: R05, R09.
  - Files: `AccountMenuScreen.tsx`, `AccountSectionScreen.tsx`, shared components,
    and relevant route layouts in `mobile/src/app/`.
  - Cover profile, settings, payment methods, history, support, saved places,
    promotions, and all other existing account sections.
  - Replace app-name references with Rakky Ride where they identify the product;
    retain ordinary uses of the word “ride.” Review permission and accessibility text.
  - Done when: every current route has been checked in both themes, including
    modals, empty/error states, system bars, and large-text layout.
    Existing demo-only payment/account functionality is not represented as live.

### Phase 4 — native identity, verification, and handoff

- [ ] **R11 — Align app display identity and launcher assets**
  - Execution status: Implementation complete: Rakky Ride display name, supplied logo icon paths, generated opaque 1024px iOS icon and Android adaptive foreground. Integration identifiers preserved. Launcher masking, themed-icon fallback, and installed deep links remain open.
  - Depends on: R03, R04.
  - Files: `mobile/app.json`, `mobile/app.config.ts`, `mobile/assets/expo.icon`,
    icon/adaptive-icon/favicon assets, and relevant user-facing permission strings.
  - Set the visible app name to Rakky Ride. Prepare platform-correct icon variants
    and check Android masking/monochrome behavior and iOS's icon override.
  - A simplified small-icon mark is an optional designer deliverable if the full
    logo is unreadable; do not replace the supplied splash logo with that variant.
  - Preserve slug, URL scheme, bundle identifier, Android package, project IDs,
    and storage keys. Changing those needs a separate integration/migration decision.
  - Done when: built apps show the intended name and icons without breaking
    existing deep links or installing as a different app identity.

- [ ] **R12 — Verify the rebrand end to end**
  - Execution status: Partially verified: typecheck, contrast, hydration checks, browser smoke checks, and native generation pass. Both baseline lint errors are resolved; six focused interaction regressions pass. Final browser recheck awaits Mac unlock. Android release dependency download was declined; Xcode unavailable for iOS release testing.
  - Depends on: R06–R11.
  - Run `npm run typecheck` and `npm run lint` in `mobile/`; compare failures
    against R01. Re-scan source/config/artwork for obsolete brand colors and strings.
  - Verify release builds on iOS and Android. Check fresh launch, returning session,
    signed-out session, offline launch, denied permissions, and font/storage failures.
  - Exercise light/dark/system modes, persistence after restart, and mismatched
    OS/in-app modes. Check small screens, large text, contrast, and screen-reader labels.
  - Smoke-test existing auth, role switching, ride booking/tracking, driver request
    handling, and finance UI. Record integration limitations instead of claiming
    demo actions verify live Paystack or trip processing.
  - Done when: evidence includes device/build details and screenshots, new failures
    are resolved, and remaining baseline limitations are explicitly listed.

- [ ] **R13 — Publish the internal design documentation and release handoff**
  - Execution status: Documentation complete: guidance, design system, screen inventory, Expo notes, changelog, asset details, and execution report updated. Release handoff remains pending R12; no public release performed.
  - Depends on: R12.
  - Update `docs/design/design-system.md`, `docs/design/screens.md`,
    `docs/third-party/expo.md`, and `CHANGELOG.md` as relevant. Merge carefully
    with the existing uncommitted design-system changes.
  - Update the old blue-brand clauses in `AGENTS.md` and relevant duplicated
    guidance/comments to reference the new canonical token specification.
  - Document logo export paths, token meanings, contrast results, native launch
    behavior, and the verification checklist. Mark completed tasks here.
  - Record that splash/native-icon changes require a new app binary; an OTA-only
    release is insufficient. Include rollback to the prior asset/config/token revision.
  - Done when: the implementation is reviewable with build evidence and the
    project has one consistent brand specification. Store submission/public release
    is a separate action, not part of this planning request.

## Suggested implementation batches

1. Brand specification and production assets: R01–R03.
2. Shared theme, components, and native splash: R04–R06.
3. Screen migration: R07–R10.
4. App identity, release verification, and documentation: R11–R13.

These are sequencing groups, not calendar commitments. Estimate delivery after
the asset-quality check and screen inventory; build access and designer exports
can affect the schedule.

## Overall completion criteria

- Supplied Rakky Ride logo appears correctly on the production native splash.
- All existing rider, driver, auth, and shared routes use the new theme in both modes.
- Green branding does not erase financial/status meaning or map distinctions.
- Theme tokens remain the source of truth; existing preferences and app identity survive.
- Relevant checks pass, with any pre-existing blockers separately documented.
- Native release-build screenshots and updated design guidance accompany the changes.

## Technical references

Reviewed for this plan on 22 September 2026:

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/).
- [Expo SDK 57 SplashScreen](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/):
  use the config plugin for native appearance; it supports dark overrides and image
  sizing. Native configuration changes need a rebuilt binary. Expo Go and development
  builds do not fully reproduce the final splash, so release-build verification is required.

Local implementation references: `mobile/app.json`, `mobile/app.config.ts`,
`mobile/src/app/_layout.tsx`, `mobile/src/constants/colors.ts`,
`mobile/src/constants/theme.ts`, `mobile/src/store/uiStore.ts`, and
`docs/design/design-system.md`.
