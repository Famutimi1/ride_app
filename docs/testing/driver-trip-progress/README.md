# Driver trip progress screen

Verified on 25 October 2026 using the running Expo web app, real Google Maps, and fictional participants in a disposable PostgreSQL database and Redis instance.

The driver screen follows the rider progress composition: a map background, floating destination and navigation header, rounded bottom panel, participant details, communication actions, and trip route details. Driver status and confirmation flows remain attached to the existing trip store. The fare and next action stay outside scrolling content.

## Validation

- Mobile TypeScript and targeted ESLint checks passed.
- All six existing `mobileDriverTrip.test.ts` checks passed, covering arrival, start, completion, retry, courier handoff codes, and the fixed primary action.
- Eight browser scenarios passed. These cover rendered font and panel measurements against the rider screen, real arrival/start requests, completion dismissal, message and call navigation, expanded details, courier delivery and return confirmation, light/dark themes, and phone/desktop layout.
- Viewports: 375 × 667, 430 × 960, and 1440 × 960. No browser runtime errors were reported.

The isolated backend deliberately has no Google Maps server key. Reverse geocoding and route requests therefore returned the expected configuration errors; the browser loaded the real Google Maps JavaScript map. Live directions, physical-device GPS, and native rendering were not verified in this pass. No operational trips or payments were changed.

## Screenshots

- [Pickup](driver-pickup.png)
- [Rider reference](rider-reference.png)
- [Trip in progress](driver-in-progress.png)
- [Compact phone](driver-small-phone.png)
- [Dark theme](driver-dark.png)
- [Desktop](driver-desktop.png)
- [Courier delivery](driver-courier.png)
- [Return to sender](driver-return.png)

Browser scenario results are recorded in [results.json](results.json).
