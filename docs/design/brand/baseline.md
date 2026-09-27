# R01 — baseline, 22 September 2026

The implementation starts from the existing working tree, including 15 modified
files. `evidence/pre-rebrand.patch` preserves those changes before this work.
No reset, stash, or replacement of the user's edits was performed.

## Checks

- `mobile/`: `npm run typecheck` passed.
- `npm run lint`: two errors and two warnings already present.
  - `AddressSheet.tsx:39`: synchronous state updates inside an effect.
  - `OngoingTripScreen.tsx:30`: React refs rule on PanResponder setup.
  - `AccountSectionScreen.tsx`: readonly-array style and unused `theme` warnings.
- iOS simulator unavailable: `xcrun simctl` is not installed with the current tools.
- Existing Metro web preview at `http://localhost:8081` renders successfully.

## Visual coverage

Web viewport: 390 × 844. Screenshots in `evidence/before-*.png` cover welcome,
home, ride selection, ongoing trip, driver dashboard, driver wallet, and account
menu in light and dark themes. These are browser previews, not native launch tests.
The signed-in flow used the local mock auth service with a synthetic number and
its documented test code. No real SMS or payment was sent.

## Migration inventory

- Native identity: `mobile/app.json`, `mobile/app.config.ts`, splash and launcher
  images; iOS has an Expo template Icon Composer override.
- Theme: `constants/colors.ts`, `theme.ts`, NativeWind mapping, persisted UI store.
- Components: `components/common/`, including input, button, pills, stars, switches.
- Auth: Welcome, Phone, OTP, ProfileSetup, Notifications, AuthScreenLayout.
- Rider/maps: Home, SetDestination, RideSelection, RideDetails, OngoingTrip;
  address, confirmation, response, map, and location components.
- Driver: DriverDashboard, DriverOnlineControl, driver account sections.
- Shared: AccountMenu and every AccountSection entry, including wallet and payouts.
- SVG onboarding assets contain embedded blue fills; recoloring only tokens will
  not change them. Template images are retained until their references are checked.
- Product references include Ride wallet, Drive with Ride, Ride Plus, shared-trip
  copy, permission descriptions, and native display name `famutimi`.
- Package, slug, bundle/package ID, deep-link scheme, and AsyncStorage keys are
  integration identifiers and must be preserved.

## Supplied asset inspection

Both sources are 1501 × 1501. The first has 1,551,263 fully transparent pixels.
The newer background-free source has 1,696,926 fully transparent pixels; the bulk
of the mark has alpha 254. It also has faint edge pixels, including one at the
lower-left canvas edge. Keep the original bytes; inspect actual rendering on
white and charcoal before deciding whether a designer export is needed.
