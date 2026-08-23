/**
 * authStore — the single source of truth for "who is signed in".
 *
 * Per AGENTS.md, cross-screen state lives in a Zustand store (not prop-drilling),
 * and auth is one domain → one store file. This store also PERSISTS the session to
 * the device (AsyncStorage) so closing and reopening the app keeps you logged in.
 *
 * Two pieces of state, on purpose:
 *   • session — set only once signup is FULLY finished (token + a complete user).
 *               `session != null` is exactly "the app should show the signed-in area".
 *   • pending — the short-lived scratch space DURING login (the phone we're verifying,
 *               and the token we got back from OTP but haven't attached a profile to
 *               yet). Never persisted — if you kill the app mid-login you just start over.
 *
 * Keeping the half-finished signup in `pending` (not `session`) is what lets the
 * router use one dead-simple rule — "session or no session" — to pick which screens
 * to show. See app/_layout.tsx.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  type AuthUser,
  type UserRole,
  completeProfile as apiCompleteProfile,
  requestOtp as apiRequestOtp,
  verifyOtp as apiVerifyOtp,
} from '@/services/authService';

interface Session {
  token: string;
  user: AuthUser;
}

/** Scratch space that only exists between "entered phone" and "finished profile". */
interface Pending {
  phone: string;
  /** The JWT from verifyOtp, held here until a profile is attached. Empty pre-verify. */
  token: string;
}

interface AuthState {
  session: Session | null;
  pending: Pending | null;
  /** False until AsyncStorage has been read back. The router waits for this so it
   *  doesn't flash the login screen at someone who's actually already logged in. */
  _hasHydrated: boolean;

  // --- actions ---
  /** Step 1: ask for an OTP and remember which phone we're verifying. */
  requestOtp: (phone: string) => Promise<void>;
  /** Step 2: check the code. Returns whether we still need to collect a profile. */
  verifyOtp: (code: string) => Promise<{ needsProfile: boolean }>;
  /** Step 3 (new users): save name + role, which completes the session. */
  completeProfile: (input: { name: string; role: UserRole }) => Promise<void>;
  /** Change the active role (rider/driver/both) for the signed-in user. */
  setRole: (role: UserRole) => void;
  /** Clear everything and return to logged-out. */
  logout: () => void;
  /** Internal: flipped once persisted state has been rehydrated. */
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      pending: null,
      _hasHydrated: false,

      requestOtp: async (phone) => {
        await apiRequestOtp(phone);
        // Remember the phone so verifyOtp knows what it's confirming.
        set({ pending: { phone, token: '' } });
      },

      verifyOtp: async (code) => {
        const pending = get().pending;
        if (!pending) {
          // Defensive: we should always have a pending phone by the time we verify.
          throw new Error('No phone number to verify. Start again.');
        }

        const { token, user } = await apiVerifyOtp(pending.phone, code);

        if (user) {
          // Returning user — profile already exists, so we're fully signed in.
          set({ session: { token, user }, pending: null });
          return { needsProfile: false };
        }

        // New number — hang on to the token; the profile screen finishes the job.
        set({ pending: { phone: pending.phone, token } });
        return { needsProfile: true };
      },

      completeProfile: async ({ name, role }) => {
        const pending = get().pending;
        if (!pending) {
          throw new Error('Nothing to complete. Start again.');
        }

        const user = await apiCompleteProfile({ phone: pending.phone, name, role });
        // Session is born here: token (from verify) + the finished user record.
        set({ session: { token: pending.token, user }, pending: null });
      },

      setRole: (role) => {
        const session = get().session;
        if (!session) return;
        // Roles are a plain profile field (not money/ledger data), so an in-place
        // update is fine. A real backend call would PATCH /users/me here too.
        set({ session: { ...session, user: { ...session.user, role } } });
      },

      logout: () => set({ session: null, pending: null }),

      setHydrated: () => set({ _hasHydrated: true }),
    }),
    {
      name: 'ride-auth',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist ONLY the session. `pending` is deliberately dropped — a half-finished
      // login shouldn't survive an app restart.
      partialize: (state) => ({ session: state.session }),
      // Runs after AsyncStorage is read back (even when nothing was stored).
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);

/** Convenience selector: is there a fully-signed-in user? */
export const useIsSignedIn = () => useAuthStore((s) => s.session !== null);
