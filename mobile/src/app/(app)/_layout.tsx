import { Redirect, Stack, usePathname } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { appRouteRedirect } from '@/utils/roleAccess';
import { useTripStore } from '@/store/tripStore';

/** Gate the screen before its data reads and effects can mount. */
export default function AppLayout() {
  const pathname = usePathname();
  const user = useAuthStore(state => state.session?.user);
  const status = useAuthStore(state => state.driverApplication?.status);
  const completingTrip = useTripStore(state => Boolean(user?.role === 'driver' && state.trip?.driver_id === user.id && ['driver_assigned', 'driver_arrived', 'in_progress', 'returning'].includes(state.trip.status)));
  if (!user) return <Redirect href="/welcome" />;
  const redirect = appRouteRedirect(pathname, user.role, status, completingTrip);
  if (redirect) return <Redirect href={redirect} />;
  // Shared screens must also discard local forms/results when the mode changes.
  return <Stack key={`${user.id}:${user.role}`} screenOptions={{ headerShown: false }} />;
}
