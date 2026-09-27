# Screen Inventory

## Rakky Ride rebrand coverage

The current implementation lives in `mobile/src/screens/`, with route wrappers in
`mobile/src/app/`. Shared tokens update every screen in light and dark mode.

- Auth: Welcome, sign-up name/phone, returning-user login, OTP, ProfileSetup,
  Notifications, and AuthScreenLayout. Welcome and sign-up login links route to
  `/login`; the login page routes new users back to `/phone`.
- Shared: Home, AccountMenu, AccountSection (all existing sections).
- Rider: SetDestination, RideSelection, RideDetails, OngoingTrip.
- Driver: DriverDashboard and driver wallet/earnings/payouts/account sections.
- Overlays: address search, ride confirmation, driver response, call/safety/payment sheets.
- Developer reference: `/gallery`, including logo, booking/wallet, components, and theme controls.

See [execution evidence](brand/execution-report.md) for what was verified and
what still needs native release testing. The inventory below is the original
feature plan and does not imply all planned backend flows are implemented.

19 screens total. See docs/architecture/overview.md for how they connect to features.

## Auth (4)
- Splash, Onboarding, Login, Signup

## Shared (5)
- Home, Profile, Edit Profile, Wallet, Notifications

## Rider (6)
- Set Destination, Confirm Ride, Finding Driver, Trip In Progress (rider),
  Trip Summary & Rating, Trip History / Trip Details

## Driver (4)
- Go Online/Offline, Incoming Trip Request, Trip In Progress (driver), Earnings

## Status tracker
Mark each screen [ ] not started / [~] in progress / [x] done as you build.
