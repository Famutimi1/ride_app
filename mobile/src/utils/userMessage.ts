/** Public copy only: never display an arbitrary server response or exception. */
export const DEFAULT_ERROR_MESSAGE = 'We couldn’t complete that. Please try again.';

const messages: Record<string, string> = {
  otp_invalid: 'That code isn’t correct. Check it and try again.',
  invalid_otp: 'That code isn’t correct. Check it and try again.',
  otp_expired: 'Your code has expired. Request a new one.',
  otp_not_found: 'Request a new verification code to continue.',
  otp_attempts_exceeded: 'Too many attempts. Request a new code and try again.',
  otp_delivery_failed: 'We couldn’t send your code. Please try again shortly.',
  otp_provider_not_configured: 'Text verification is temporarily unavailable. Please try again later.',
  invalid_phone: 'Enter a valid phone number, including the country code.',
  phone_already_registered: 'This phone number already has an account. Sign in instead.',
  email_already_registered: 'This email is already linked to another account.',
  account_not_found: 'We couldn’t find your account. Check your number or sign up.',
  user_not_found: 'We couldn’t find your account. Please sign in again.',
  account_inactive: 'Your account is unavailable. Contact support for help.',
  account_frozen: 'Your account is temporarily restricted. Contact support for help.',
  unauthorized: 'Please sign in again to continue.',
  invalid_or_expired_token: 'Your session has expired. Please sign in again.',
  invalid_refresh_token: 'Your session has expired. Please sign in again.',
  refresh_token_expired: 'Your session has expired. Please sign in again.',
  invalid_google_token: 'Google sign-in couldn’t be verified. Please try again.',
  invalid_google_sign_in: 'Google sign-in couldn’t be verified. Please try again.',
  google_account_link_required: 'Sign in with your phone number to link your Google account.',
  google_sign_in_not_configured: 'Google sign-in is temporarily unavailable. Try signing in with your phone.',
  authentication_service_unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  invalid_full_name: 'Enter your full name.',
  invalid_email: 'Enter a valid email address.',
  invalid_profile: 'Check your profile details and try again.',
  invalid_personal_info: 'Check your name, email and address before continuing.',
  missing_profile_changes: 'Update a detail before saving.',
  phone_unchanged: 'Enter a different phone number.',
  invalid_phone_change_challenge: 'Request a new code to change your phone number.',
  phone_change_challenge_expired: 'Your code has expired. Request a new one.',
  phone_change_unavailable: 'Phone changes are temporarily unavailable. Please try again later.',
  active_trip_prevents_role_switch: 'Finish your current trip before switching modes.',
  active_trip_prevents_material_changes: 'Finish your current trip before changing these details.',
  approved_driver_material_requires_review: 'Contact support to update your verified details.',
  driver_account_required: 'Complete your driver registration before using this service.',
  approved_driver_required: 'Your driver application needs approval before you can continue.',
  driver_not_approved: 'Your driver application needs approval before you can go online.',
  switch_to_driver_mode: 'Switch to driver mode from the menu to continue.',
  switch_to_rider_mode: 'Switch to rider mode from the menu to continue.',
  no_enabled_driver_services: 'Turn on an approved service before going online.',
  service_not_approved: 'This service needs approval before you can turn requests on.',
  service_suspended_contact_support: 'This service is paused. Contact support for help.',
  service_consent_required: 'Accept the service terms to continue.',
  service_settings_changed: 'Your service settings changed. Refresh and try again.',
  service_application_changed: 'Your application changed. Refresh to see the latest details.',
  choose_driver_services: 'Choose at least one service to continue.',
  choose_vehicle_category: 'Choose your vehicle type to continue.',
  motorcycle_courier_only: 'Motorcycles can be used for courier deliveries only.',
  vehicle_classification_requires_review: 'Contact support to review your vehicle type.',
  driver_application_incomplete: 'Complete your details and upload all required documents.',
  all_documents_required: 'Upload your licence, registration and insurance to continue.',
  personal_info_required: 'Save your personal information before uploading documents.',
  invalid_vehicle_info: 'Check your vehicle details and try again.',
  application_material_changed: 'Your application changed. Reload it before uploading again.',
  application_changed: 'Your application changed. Refresh to see the latest details.',
  file_too_large: 'This file is too large. Choose a smaller file.',
  document_too_large: 'This document is too large. Choose a smaller file.',
  unsupported_file_content: 'Choose a supported image or PDF file.',
  unsupported_document_content: 'Choose a clear image or PDF of your document.',
  invalid_document_type: 'Choose a supported image or PDF file.',
  file_extension_mismatch: 'This file couldn’t be read. Choose another image or PDF.',
  document_content_type_mismatch: 'This file couldn’t be read. Choose another image or PDF.',
  profile_photo_changed: 'Your photo changed on another device. Refresh before trying again.',
  media_version_required: 'Refresh your profile before uploading a new photo.',
  media_upload_in_progress: 'An upload is already in progress. Please wait a moment.',
  media_upload_busy: 'An upload is already in progress. Please wait a moment.',
  media_upload_failed: 'We couldn’t upload your file. Check your connection and try again.',
  media_upload_unavailable: 'Uploads are temporarily unavailable. Please try again later.',
  media_uploads_not_configured: 'Uploads are temporarily unavailable. Please try again later.',
  document_storage_unavailable: 'Documents are temporarily unavailable. Please try again later.',
  document_unavailable: 'This document is unavailable. Please try again later.',
  media_upload_expired: 'Your upload expired. Please select the file again.',
  insufficient_funds: 'Your wallet balance is too low. Top up to continue.',
  insufficient_earnings: 'This amount exceeds your available earnings. Choose a smaller amount.',
  cash_debt_limit_exceeded: 'Settle your outstanding cash commission before going online.',
  cash_debt_limit_reached: 'Settle your outstanding cash commission before going online.',
  payout_account_unavailable: 'Choose an active bank account for this withdrawal.',
  payout_account_not_found_or_in_use: 'This account is unavailable or has a pending payout. Refresh your bank accounts.',
  payout_name_mismatch: 'The account name doesn’t match your profile. Check the bank details or contact support.',
  invalid_bank_account: 'Check your bank and account number, then try again.',
  unknown_bank: 'Choose a bank from the list.',
  invalid_amount: 'Enter a valid amount.',
  topup_amount_out_of_range: 'This top-up amount is outside the allowed limits. Choose another amount.',
  withdrawal_below_minimum: 'This amount is below the withdrawal minimum shown on this page.',
  daily_withdrawal_limit_exceeded: 'You’ve reached today’s withdrawal limit. Try again tomorrow.',
  withdrawal_fee_changed: 'The withdrawal fee changed. Review the latest amount before confirming.',
  paystack_unavailable: 'Payments are temporarily unavailable. Check your payment history before trying again.',
  paystack_not_configured: 'Payments are temporarily unavailable. Please try again later.',
  live_payments_disabled: 'Payments are temporarily unavailable. Please try again later.',
  provider_payout_funds_unavailable: 'Payouts are temporarily unavailable. Please try again later.',
  payout_funds_unavailable: 'Payouts are temporarily unavailable. Please try again later.',
  courier_requires_wallet: 'Choose your wallet to pay for this delivery.',
  card_payment_not_available: 'Card payment is unavailable for this trip. Choose cash or wallet.',
  invalid_payment_method: 'Choose a payment method to continue.',
  rider_has_active_trip: 'You already have an active trip. Return to it before booking another.',
  driver_has_active_trip: 'Finish your current trip before accepting another request.',
  account_has_active_trip: 'Finish your current trip before continuing.',
  trip_no_longer_available: 'This request is no longer available. Wait for the next one.',
  offer_expired_or_invalid: 'This request has expired. Wait for the next one.',
  trip_not_found: 'This trip is unavailable. Return to your trip history.',
  courier_trip_not_found: 'This delivery is unavailable. Return to your trip history.',
  trip_not_in_progress: 'This trip’s status changed. Refresh before completing it.',
  trip_state_changed: 'This trip’s status changed. Refresh to see the latest update.',
  invalid_trip_state: 'This trip’s status changed. Refresh to see the latest update.',
  invalid_transition: 'This trip’s status changed. Refresh to see the latest update.',
  trip_cannot_be_cancelled: 'This trip can no longer be cancelled. Check its current status or contact support.',
  trip_already_rated: 'You’ve already rated this trip. Thank you for your feedback.',
  trip_not_completed: 'You can rate this trip after it is completed.',
  invalid_rating: 'Choose a rating from one to five stars.',
  invalid_delivery_code: 'That delivery code isn’t correct. Ask the recipient to check it.',
  delivery_code_locked: 'Too many incorrect codes. Ask the sender for a new code or contact support.',
  delivery_code_reset_limit: 'You’ve reached the code replacement limit. Contact support for help.',
  delivery_code_unavailable: 'The delivery code is unavailable for this trip’s current status.',
  delivery_code_rotation_unavailable: 'A new code can only be requested during an active delivery.',
  pickup_matches_dropoff: 'Choose a destination different from your pickup.',
  invalid_courier_details: 'Check the package and recipient details before continuing.',
  trip_quote_expired: 'Your fare has expired. Refresh it before booking.',
  trip_quote_required: 'Refresh your fare before booking.',
  trip_quote_mismatch: 'Your trip details changed. Review the latest fare before booking.',
  vehicle_type_unavailable: 'This ride type is unavailable. Choose another option.',
  scheduled_time_out_of_range: 'Choose a pickup time between 30 minutes and 7 days from now.',
  invalid_scheduled_time: 'Choose a valid pickup day and time.',
  scheduled_trip_overlaps_existing: 'You already have a ride around this time. Choose a different time.',
  schedule_already_dispatched: 'Driver search has already started. Open the active trip for updates.',
  trip_messaging_unavailable: 'Messaging is unavailable for this trip. Return to your trip for other contact options.',
  trip_message_rate_limited: 'You’re sending messages too quickly. Wait a moment and try again.',
  invalid_trip_message: 'Write a message before sending. Keep it under the message limit.',
  trip_calling_unavailable: 'Calling is unavailable for this trip. Try sending a message.',
  call_participant_busy: 'They’re on another call. Try again in a moment or send a message.',
  call_rate_limited: 'Please wait a moment before calling again.',
  call_not_ready: 'Your call is still connecting. Please wait a moment.',
  notification_not_found: 'This notification is no longer available. Refresh your notifications.',
};

/** Only explicitly written public copy may be carried across catch boundaries. */
export class UserFacingError extends Error {
  constructor(message: string) { super(message); this.name = 'UserFacingError'; }
}

/** Last line of defence for old string-based view props; never show SQL, JSON or stacks. */
export function safeMessage(message: string, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (Object.prototype.hasOwnProperty.call(messages, message)) return messages[message];
  const value = message.trim();
  if (!value || value.length > 500 || /<[^>]+>|[{}]|\n\s*at\s|(?:SELECT|INSERT|UPDATE|DELETE)\s.+(?:FROM|INTO|SET)|(?:SQLSTATE|postgres|pgerror|constraint|relation|column|syntax error|duplicate key|ECONN|ENOTFOUND|TypeError|ReferenceError|undefined is|stack trace)|(?:EXPO_PUBLIC_|CLOUDINARY_|PAYSTACK_|\.tsx?:\d)|^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(value)) return fallback;
  return value;
}

interface ErrorResponse { status?: number; data?: unknown }
interface ErrorLike { message?: unknown; name?: unknown; code?: unknown; response?: ErrorResponse; isAxiosError?: boolean; status?: number }

export function userErrorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof UserFacingError) return safeMessage(error.message, fallback);
  if (!error || typeof error !== 'object') return fallback;
  const failure = error as ErrorLike;
  const response = failure.response;
  const data = response?.data;
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const code = typeof body?.error === 'string' ? body.error : typeof failure.code === 'string' ? failure.code : null;
  if (code === 'otp_cooldown') {
    const seconds = typeof body?.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)
      ? Math.max(1, Math.min(3600, Math.ceil(body.retryAfterSeconds))) : 60;
    return `Please wait ${seconds} seconds before requesting another code.`;
  }
  // Infrastructure failures must never be disguised as a field error, even if a proxy supplies a code.
  const status = response?.status ?? failure.status;
  if (status && status >= 500) return status === 504
    ? 'This is taking longer than expected. Check the latest status before trying again.'
    : 'The service is temporarily unavailable. Please try again shortly.';
  if (code && Object.prototype.hasOwnProperty.call(messages, code)) return messages[code];
  if (status === 401 || failure.name === 'SessionExpiredError') return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You can’t use this feature right now. Check your account or contact support.';
  if (status === 404) return 'We couldn’t find that item. Refresh the page and try again.';
  if (status === 409 || status === 412 || status === 428) return 'These details have changed. Refresh and review them before trying again.';
  if (status === 413) return 'This file is too large. Choose a smaller file.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (failure.code === 'ECONNABORTED' || failure.code === 'ETIMEDOUT' || failure.name === 'TimeoutError') return 'This is taking longer than expected. Check the latest status before trying again.';
  if (failure.isAxiosError && !response || failure.name === 'TypeError' && typeof failure.message === 'string' && /fetch|network/i.test(failure.message)) return 'We couldn’t connect. Check your internet connection and try again.';
  if (failure.name === 'LocationUnavailableError' && typeof failure.message === 'string') return safeMessage(failure.message, fallback);
  if (failure.name === 'TripQuoteError') return messages.trip_quote_expired;
  return fallback;
}
