# No drivers found

Redesigned and implemented on 21 October 2026 in `mobile/src/screens/rider/NoDriversFoundView.tsx`, rendered by the existing no_drivers_found branch in `OngoingTripScreen.tsx`.

The view uses compact shared text variants, a conventional car symbol with an unavailable badge, the actual pickup address, and two inset action buttons. It supports the shared semantic theme, safe areas, scrolling for short screens, and a courier-specific heading. The conventional icon is built with existing code assets; no generated image or new dependency is used.

Try again and Change pickup preserve the existing clear-trip-and-navigate callbacks. A new Back to home control clears the terminal trip and returns home. None of these actions creates a request, retries matching automatically, or changes a backend trip status.

Validation: mobile typecheck, ESLint for both screens, and diff whitespace checks passed. Browser reviewed the actual no-driver result at 405×804 and 320×568, then verified Try again returns to ride selection with the original route. No new ride request was submitted. Change pickup and home callbacks were reviewed in code, not separately exercised after clearing the terminal trip. Native devices were not tested. `implemented.png` is the browser preview.
