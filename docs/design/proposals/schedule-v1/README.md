# Schedule a ride

Approved and implemented on 21 October 2026 in `mobile/src/screens/rider/ScheduleRideScreen.tsx`.

`schedule.png` is the approved design, generated with the built-in image tool. The exact prompt is in `prompts.json`. `implemented.png` shows the browser implementation.

The screen uses compact typography, the existing small schedule artwork, horizontally scrolling date chips, a three-column time grid, a driver-confirmation notice, upcoming bookings, and a fixed selection summary and Choose addresses action. The time grid scrolls after three rows so all available times remain accessible. It uses the shared theme and typography rather than colors or fonts baked into the mockup.

Existing WAT formatting, the 30-minute minimum and 7-day maximum, upcoming-trip loading and refresh, cancellation confirmation, and live-ride links remain. Choose addresses still forwards the selected ISO timestamp to `/set-destination` without creating a booking.

Validation: mobile TypeScript and screen ESLint checks; browser date/time selection, disabled action before selection, date changes clearing the selected time, later times in the scrollable grid, the address-selection URL timestamp, and layouts at 405×804 and 320×640. The current account had no scheduled trips, so cancellation and live-trip actions were reviewed in code but not executed against a booking. No booking was created. Native device interaction was not tested.

Scroll controls added on 21 October 2026: small left/right arrows page through dates, and up/down arrows page through pickup times. They follow manual scrolling and disable at either end. Verified both directions, end states, and reset when changing the pickup day.

Upcoming-ride card refined on 21 October 2026: compact date/time header and status badge, route timeline with pickup and drop-off labels, divided fare/payment footer, and an outlined cancellation action. Existing booking data and cancellation API behavior are preserved. Verified the current scheduled booking and opening the confirmation then choosing Keep ride; no cancellation was submitted. TypeScript, screen ESLint, and diff whitespace checks passed. Preview: `upcoming-ride-card.png`.

Compact card refinement: reduced padding and gaps, combined the date/time and fare/payment rows, and collapsed each route address to one line. Tapping the route chevron expands full addresses and the scheduling note; cancellation remains a separate 44-point action. Verified route expansion/collapse in the browser and passed TypeScript, screen ESLint, and whitespace checks. Preview: `upcoming-ride-card-compact.png`.
