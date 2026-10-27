# Driver completed-trip summary

Verified on 25 October 2026 in the actual Expo web UI with fictional participants and disposable PostgreSQL/Redis instances.

The driver gets an earnings summary, fare and commission breakdown, payment method, pickup/destination details, optional rating, and a fixed footer for submission or returning to driver home. The rider retains the existing completion screen. Returned deliveries have no rating form.

Amounts come from the server and preserve kobo precision. Missing earnings or commission display as pending rather than assuming the gross fare is net earnings.

## Verification

- Mobile TypeScript and targeted ESLint passed.
- All six existing driver-trip lifecycle tests passed.
- Seven browser scenarios passed: actual cash completion and settlement, compact-phone scrolling, rating failure/retry and persistence, dark/desktop layout, pending settlement and kobo formatting, courier return without rating, and rider-screen regression.
- Browser viewports: 375 × 667, 430 × 960, and 1440 × 960. No browser runtime errors were reported.

The cash completion and rating use actual backend endpoints in the disposable database. Visual edge cases use synthetic completed/returned rows, restored through a test-only active-trip response. One rating response intentionally fails with HTTP 503 to exercise retry. Reverse geocoding reports the expected missing-server-key error in this isolated environment. Native device rendering was not tested in this pass. No operational trips, balances, or payments were changed.

## Screenshots

- [Light theme](driver-completed-light.png)
- [Small phone, scrolled to rating](driver-completed-small-phone.png)
- [Dark theme](driver-completed-dark.png)
- [Desktop](driver-completed-desktop.png)
- [Settlement pending](driver-completed-pending.png)
- [Courier returned](driver-courier-returned.png)

Detailed browser scenario results: [results.json](results.json).
