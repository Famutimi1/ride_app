# App feedback

Implemented 27 October 2026 for the shared rider/driver app.

## Reusable pieces

- `mobile/src/utils/userMessage.ts`: the public error catalogue, status/network fallbacks, `UserFacingError`, and a final string sanitiser. Unknown exceptions, database messages, HTML and unknown server codes are never copied straight into an error label.
- `mobile/src/components/common/AppMessage.tsx`: inline error, success, warning and information messages. Uses existing semantic light/dark colours and caption typography (13/18 on web and 15/22 on Android), 16px icons, subtle fills and a narrow accent. Retry targets are at least 44px tall; copy wraps and respects the system font scale.
- `mobile/src/components/common/Input.tsx`: compact error below its field, matching border and an accessible description.
- `mobile/src/store/feedbackStore.ts` and `FeedbackHost.tsx`: dismissible safe-area toasts and explicit in-app confirmations on web/iOS/Android. Success/information toasts last six seconds; error toasts stay until dismissed. Timers cannot dismiss a newer toast, duplicate confirmations cannot replace a pending decision, and an account/mode change clears feedback and cancels pending decisions.
- Root route `ErrorBoundary`: a friendly retry screen for rendering failures, without exception text or source paths.

## Placement and behaviour

Field validation stays at the input. Courier validation scrolls to the first invalid field. Login service failures appear beside Continue, rather than marking the phone input invalid when a provider is down.

Section load errors stay with that content and its retry control. This applies to history, receipt, notifications, vehicle documents, safety, support, balances and finance resources. Existing information stays visible where the screen previously supported stale data.

Booking/request failures stay beside the booking action. Schedule loading, time-selection and cancellation errors have separate state: refreshing upcoming trips cannot erase a failed cancellation, and a cancellation error remains in that trip’s confirmation. Existing trip completion and cancellation dialogs keep their business rules and show errors inside the dialog, allowing a deliberate retry.

Profile/photo saves, bank saves and successful code resend use brief success toasts. Important phone-change instructions and pending payout status stay inline. Placeholder promotion/family/work actions now say they are unavailable rather than falsely reporting a successful save or invitation.

Logout asks for confirmation. Existing confirmations for booking, cancelling, completing and withdrawing service consent remain in place. Financial requests are never automatically retried by the messaging components; ambiguous payment timeouts direct users to check status/history first.

## Adding a new message

Use `apiErrorMessage(error)` (from `lib/apiClient`) or `userErrorMessage(error, contextFallback)` in a catch. Add known server codes to the catalogue with plain public wording; never display `response.data.error` or arbitrary `error.message` directly. Axios error response/status/code metadata is retained for existing recovery and state logic.

Use `UserFacingError` only for locally authored public instructions, not for untrusted server/provider messages. Expected API errors remain mapped by code. Unexpected backend errors already return `internal_server_error` and remain in server logs; this change adds client-side protection as well.

Render `AppMessage` beside the content/action that failed. Use `compact` below a particular field, and `actionLabel`/`onAction` for a deliberate retry. Use `feedback.success('Your changes have been saved.')` only after confirmed persistence. Use `await feedback.confirm({ title, message, confirmLabel, cancelLabel, destructive })` before a consequential action; false means cancel, dismissal or account cleanup.

## Verification

- `cd mobile && npm run typecheck && npm run lint && npm run test:feedback`
- Mobile regression harnesses in `backend/src/modules/{auth,trips,payments,notifications}/mobile*.test.ts` exercise session/mode boundaries, OTP retry, trip actions, finance, settings and support without changing live user data.
- Browser visual/interaction checks at 390×844: light/dark messages, success toast/dismissal, confirmation/Keep ride, and login with an intercepted HTTP 500 containing PostgreSQL details. Only the friendly fallback appeared; no page errors occurred.
- Local screenshots: ignored `design-reference-archive/feedback-system-2026-10-27/`.
- Native emulator visual testing and a new Android build were not run for this change.

A visual component reference is available at `/gallery` in the existing design-system gallery. Its confirmation and toast preview buttons do not alter a trip or account.
