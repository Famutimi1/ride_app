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

import { useIsSignedIn } from '@/store/authStore';

export default function Index() {
  const isSignedIn = useIsSignedIn();
  return <Redirect href={isSignedIn ? '/home' : '/welcome'} />;
}
