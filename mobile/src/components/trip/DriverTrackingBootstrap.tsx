import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getSocket } from '@/services/socket';
import { startDriverBackgroundUpdates, startDriverLocationUpdates } from '@/services/locationService';
import { useAuthStore } from '@/store/authStore';
import { useTripStore } from '@/store/tripStore';

/** Keep tracking alive across driver trip/chat/navigation screens, including web. */
export function DriverTrackingBootstrap() {
  const driverId = useAuthStore((state) => state.session?.user.role === 'driver' ? state.session.user.id : null);
  const tripId = useTripStore((state) => state.trip && ['driver_assigned', 'driver_arrived', 'in_progress', 'returning'].includes(state.trip.status) ? state.trip.id : null);
  useEffect(() => {
    if (!driverId || !tripId) return;
    let disposed = false;
    let starting = false;
    let stop: (() => void) | undefined;
    const start = async () => {
      if (disposed || starting || stop) return;
      starting = true;
      try {
        const release = await startDriverLocationUpdates(driverId, tripId);
        if (disposed) { release(); return; }
        stop = release;
        // Keep foreground tracking if background permission/service is unavailable.
        await startDriverBackgroundUpdates(driverId, tripId).catch(() => undefined);
      } catch {
        stop?.();
        stop = undefined;
      } finally { starting = false; }
    };
    void start();
    const socket = getSocket();
    socket.on('connect', start);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void start(); });
    return () => { disposed = true; stop?.(); socket.off('connect', start); listener.remove(); };
  }, [driverId, tripId]);
  return null;
}
