# Courier review design

Approved and implemented on 21 October 2026 in `mobile/src/screens/rider/CourierReviewScreen.tsx`.

The preview `courier-review.png` was generated with the built-in image tool using the user's current screen as a reference. The exact prompt is in `prompts.json`. Amounts and package/recipient details are illustrative.

Keep the real AppMap, route, and markers in the app. Never use the generated mockup as a runtime map. Redesign the white review sheet with a compact header, small existing parcel artwork, package summary, pickup/drop-off timeline, recipient row, short handoff-code notice, and fixed fare/wallet/Send package area. Retain 13–15px shared text variants for body and controls and semantic theme tokens. Recipient and edit controls should reopen the existing package form while preserving the current draft.

Implementation must preserve quote freshness and fare-change review, wallet holds, insufficient-balance top-up, quote retries, submission idempotency, and post-booking navigation. Include optional pickup/delivery instructions when present. The design does not submit an order, reserve funds, or claim a driver is confirmed.

Implementation uses existing parcel artwork and real AppMap imagery, shared theme colors and 13–15px text, package and recipient edit controls, route and optional instructions, the code notice, and a fixed wallet/fare/send area. The package form accepts a review edit mode so opening it does not clear the selected route and Save changes returns to review. The quote/submission controller remains unchanged.

Validation: mobile typecheck, ESLint for both changed screens, and diff whitespace checks passed. Browser verified the real map and fare, editing package and recipient details, optional delivery instructions, saving back to the same route, and scrolling details independently of the fixed footer at 405×804 and 320×640. Booking/payment submission was not executed. Preview `implemented.png` uses an unsent temporary test draft, cleared after verification. Native devices and insufficient-balance/fare-change responses were not exercised; their existing controls and handlers remain.
