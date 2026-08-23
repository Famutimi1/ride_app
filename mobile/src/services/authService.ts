/**
 * authService — the ONE place the app talks to the "auth backend".
 *
 * Right now the backend Auth module doesn't exist yet, so every function here is
 * a MOCK that fakes a network round-trip with a short delay and returns canned
 * data. That's deliberate: screens and the auth store are written against this
 * service's shape, so when the real backend lands we only rewrite the insides of
 * these three functions (call `api.ts` → `POST /auth/*`) and nothing above them
 * changes.
 *
 * Flow these model (phone + OTP, the Lagos/Bolt-style norm, matching the backend's
 * planned `otp_verifications` table):
 *   1. requestOtp(phone)        → "we texted you a code"
 *   2. verifyOtp(phone, code)   → { token, user } — user is null for a brand-new
 *                                 number (needs a profile) or a full record for a
 *                                 returning one.
 *   3. completeProfile(...)     → the finished user record after they pick a name/role.
 */

/** Roles are stored on the single `users` table via a `role` column (AGENTS.md §5). */
export type UserRole = 'rider' | 'driver' | 'both';

/** A fully-onboarded user. `name`/`role` are always set — a half-finished signup
 *  lives in the store's transient `pending` slice, never as an AuthUser. */
export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
}

export interface VerifyOtpResult {
  /** JWT access token. In the mock it's a fake string; the real API returns a signed one. */
  token: string;
  /** Null means "verified, but this is a new number" → the app collects a profile next. */
  user: AuthUser | null;
}

// ---------------------------------------------------------------------------
// Mock plumbing — delete this block when the real API is wired in.
// ---------------------------------------------------------------------------

/** The code the mock accepts. Shown as a hint on the OTP screen so it's testable. */
export const MOCK_OTP_CODE = '123456';

/** Pretend a request took a beat, so loading states are visible while testing. */
function fakeNetwork<T>(value: T, ms = 700): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// ---------------------------------------------------------------------------
// Public API (stable shape — screens/store depend on these signatures).
// ---------------------------------------------------------------------------

/**
 * Ask the backend to text an OTP to `phone`.
 * MOCK: always "succeeds" after a short delay.
 * REAL: `await api.post('/auth/request-otp', { phone })`.
 */
export async function requestOtp(phone: string): Promise<{ success: true }> {
  // (No validation here — the phone screen validates before calling us. The real
  //  backend would also validate and rate-limit.)
  return fakeNetwork({ success: true } as const);
}

/**
 * Verify the code the user typed.
 * MOCK: throws on anything but MOCK_OTP_CODE, and always reports the number as new
 *       (user: null) so the profile step is exercised. Returning users are covered
 *       by session persistence, so the mock doesn't need to fake them.
 * REAL: `await api.post('/auth/verify-otp', { phone, code })`.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  if (code !== MOCK_OTP_CODE) {
    // Throwing is how the store/screen learn the code was wrong (caught → error UI).
    throw new Error('That code is incorrect. Try 123456.');
  }
  return fakeNetwork<VerifyOtpResult>({
    token: `mock-jwt-${Date.now()}`,
    user: null,
  });
}

/**
 * Save the new user's name + role after OTP.
 * MOCK: echoes back a constructed user record.
 * REAL: `await api.patch('/auth/profile', { name, role })` (authenticated with the
 *       token from verifyOtp).
 */
export async function completeProfile(input: {
  phone: string;
  name: string;
  role: UserRole;
}): Promise<AuthUser> {
  return fakeNetwork<AuthUser>({
    id: `usr_${Date.now()}`,
    phone: input.phone,
    name: input.name,
    role: input.role,
  });
}
