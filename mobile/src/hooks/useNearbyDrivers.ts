import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { getNearbyDrivers } from '@/services/mapsService';
import { useMapStore, type MapCoordinate } from '@/store/mapStore';

export function useNearbyDrivers(location?: MapCoordinate, enabled = true, serviceType:'ride'|'courier'='ride') {
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  useFocusEffect(useCallback(() => {
    if (latitude === undefined || longitude === undefined || !enabled) {
      useMapStore.getState().setDriverLocations([],serviceType);
      return;
    }
    useMapStore.getState().setDriverLocations([],serviceType);
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if(refreshing)return;
      refreshing=true;
      try {
        const drivers = await getNearbyDrivers({ latitude, longitude },5,serviceType);
        if (active) useMapStore.getState().setDriverLocations(drivers.map((driver) => ({ ...driver, timestamp: Date.now() })),serviceType);
      } catch { if(active)useMapStore.getState().setDriverLocations([],serviceType); } finally { refreshing=false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [enabled, latitude, longitude, serviceType]));
}
