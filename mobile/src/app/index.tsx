/**
 * Entry route ("/") — the landing gate.
 *
 * By the time this renders, the root layout has already waited for the persisted
 * session to load (see _layout.tsx), so we can immediately point the user at the
 * right place: their home if signed in, otherwise the welcome screen. Keeping this
 * decision in one tiny place means every other screen can assume it's on the right
 * side of the auth boundary.
 */
import { Redirect } from 'expo-router';

import { useAuthStore, useIsSignedIn } from '@/store/authStore';

export default function Index() {
  const isSignedIn = useIsSignedIn();
  const role = useAuthStore((state) => state.session?.user.role);
  const driverApplication = useAuthStore((state) => state.driverApplication);
  if (!isSignedIn) return <Redirect href="/welcome" />;
  if (role === 'driver') {
    if (driverApplication?.status === 'approved') return <Redirect href="/driver-dashboard" />;
    return <Redirect href={driverApplication?.status === 'pending' || driverApplication?.status === 'rejected' ? '/driver-status' : '/driver-onboarding'} />;
  }
  return <Redirect href="/home" />;
}
