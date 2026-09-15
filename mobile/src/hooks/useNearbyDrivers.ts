import { useEffect } from 'react';
import { getNearbyDrivers } from '@/services/mapsService';
import { useMapStore, type MapCoordinate } from '@/store/mapStore';

export function useNearbyDrivers(location?: MapCoordinate, enabled = true) {
  useEffect(() => {
    if (!location || !enabled) return;
    const refresh = async () => {
      try {
        const drivers = await getNearbyDrivers(location);
        useMapStore.getState().setDriverLocations(drivers.map((driver) => ({ ...driver, timestamp: Date.now() })));
      } catch { /* The map remains usable if Redis/backend is temporarily offline. */ }
    };
    void refresh();
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  }, [enabled, location]);
}
