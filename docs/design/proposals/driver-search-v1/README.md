# Driver-search radar

Status: Radar approved and implemented. The user also requested an update to the Cancel ride / Keep ride dialog.

The search screen keeps the real Google Maps view, selected pickup and destination, actual trip fare, payment method, and existing cancellation controller. A compact 108px green radar replaces repeated searching messages. Its sweep rotates once every 3.8 seconds around a stationary car icon. It represents activity, with no invented drivers, progress percentage, or arrival estimate.

Text uses the shared 13–15px variants. Utility icons are 17–20px, the back control is 48px, and cancellation controls are at least 44px. The route, optional courier details and fare can scroll; the cancel button stays available at the bottom, above the safe area. The map occupies the visible upper portion with provider attribution unobstructed.

The radar uses React Native Animated and the existing expo-image SVG support. It mounts only while the real trip status is searching, stops on unmount, pauses in the background, and remains static for reduced-motion preferences. Colors come from the existing semantic light/dark tokens. No new dependencies or fixed runtime locations were added.

The shared cancellation dialog retains the existing reason choices and cancellation service. It adds a green Keep ride action, a soft red Cancel ride action, accessible radio selection, loading feedback and retryable error feedback. Reasons and dismissal are disabled during submission, and a synchronous guard blocks duplicate confirmations. Delivery wording is used for courier requests. Only a successful cancellation clears the trip map and returns home.

Validation: mobile TypeScript, targeted ESLint and whitespace checks passed. Browser verification used the production components in a temporary sample-data route, which was removed afterward. Checks covered animation motion and unmounting, 390×844 and 320×640 layouts, long addresses, scrolling with a pinned cancel action, cash/wallet labels, courier details, light/dark appearance, reason selection and checked-state accessibility, modal dismissal, and cancellation loading/error recovery with a local failing callback. No real ride request or cancellation was sent. Native Android rendering and OS reduced-motion/background transitions were not exercised.

The approved motion proposal is retained as `radar-preview.html`; Radar was selected from its two alternatives. Preview locations and fares are sample data only.
