import { useEffect, useRef } from 'react';
import { subscribeToTrip } from '@/services/socket';
import { bearingBetween, interpolateCoordinate } from '@/utils/driverAnimation';
import { useMapStore } from '@/store/mapStore';

export function useLiveDriverTracking(tripId?: string) {
  const animation = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!tripId) return;
    const unsubscribe = subscribeToTrip(tripId, (next) => {
      const previous = useMapStore.getState().driverLocations.find((item) => item.driverId === next.driverId);
      if (!previous) return useMapStore.getState().upsertDriverLocation(next);
      if (animation.current) clearInterval(animation.current);
      const startedAt = Date.now();
      const duration = 2_500;
      const heading = next.heading ?? bearingBetween(previous, next);
      animation.current = setInterval(() => {
        const progress = Math.min((Date.now() - startedAt) / duration, 1);
        useMapStore.getState().upsertDriverLocation({ ...interpolateCoordinate(previous, next, progress), driverId: next.driverId, heading, timestamp: next.timestamp });
        if (progress === 1 && animation.current) { clearInterval(animation.current); animation.current = null; }
      }, 50);
    });
    return () => { unsubscribe(); if (animation.current) clearInterval(animation.current); };
  }, [tripId]);
}
