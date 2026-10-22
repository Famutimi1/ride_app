# Ride confirmation modal

Approved and implemented on 21 October 2026 in `mobile/src/components/map/RideConfirmationModal.tsx`. This shared modal is used by ride selection and ride details.

Generated with the built-in image tool. `ride-confirmation.png` is the proposed design; `prompts.json` contains the exact prompt. The map is context from the user's screenshot, not an asset to use in the live app. All fares and route details in the mockup are illustrative.

The design removes the premature success check and generic Ready badge, adds a close control, condenses ride/fare and route details, and presents payment and tracking information with smaller icons. The confirm button remains the explicit final action, with a short note explaining that matching follows confirmation.

Implementation must preserve dynamic ride name, quoted fare and payment, both addresses, scheduled-ride date/time and non-guarantee copy, calculating/loading/disabled behavior, close/back/backdrop handling, modal theme context, and the existing onConfirm callback. Keep the map real and retain semantic theme tokens and 13–15px text for normal UI. Provide scrolling/max-height handling on small screens; keep a 44px close target and 48px confirm control.

The implementation uses shared 13–15px text, semantic light/dark tokens, a 44px close control, compact route and payment rows, and a 48px confirm button. The body scrolls within a safe-area-aware maximum height while the header and confirm action remain available. Dynamic ride/fare/payment, scheduling date/time and driver disclaimer, calculating/disabled/loading states, backdrop dismissal and native onRequestClose are preserved. The parent quote validation and submission callbacks are unchanged.

Validation: mobile typecheck, component ESLint, and whitespace checks passed. Browser verified the existing cash quote/route, close/reopen, wallet payment display, backdrop dismissal, and fit at 405×804 and 320×568. Restored Cash after the check. No confirm action was submitted, no ride was created, and no payment was taken. Scheduled/loading variants and native back behavior were reviewed in code but not exercised on a device. Preview: `implemented.png`.
