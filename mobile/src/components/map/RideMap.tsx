import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppMap } from './AppMap';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { useNearbyDrivers } from '@/hooks/useNearbyDrivers';
import { HomeLocationFallback } from './HomeLocationFallback';
import type { AppMapHandle, AppMapProps } from './mapTypes';

export const RideMap = forwardRef<AppMapHandle, { mapPadding?: AppMapProps['mapPadding'] }>(function RideMap({ mapPadding }, ref) {
  const mapRef = useRef<AppMapHandle>(null);
  const [zoomSpan, setZoomSpan] = useState({ latitudeDelta: 0.12, longitudeDelta: 0.12 });
  useImperativeHandle(ref, () => ({
    animateToRegion: next => {
      setZoomSpan({ latitudeDelta: next.latitudeDelta, longitudeDelta: next.longitudeDelta });
      mapRef.current?.animateToRegion(next);
    },
    fitToCoordinates: points => mapRef.current?.fitToCoordinates(points),
  }), []);
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Date.now()); const first = setTimeout(tick, 0); const timer = setInterval(tick, 10_000); return () => { clearTimeout(first); clearInterval(timer); }; }, []);
  const current = useMapStore((state) => state.currentLocation);
  const drivers = useMapStore((state) => state.driverLocations);
  const supplyService=useMapStore(state=>state.driverLocationsService);
  const trip = useTripStore((state) => state.trip);
  const assignedLocation = useTripStore((state) => state.driverLocation);
  const assigned = Boolean(trip?.driver_id && ['driver_assigned', 'driver_arrived', 'in_progress', 'returning'].includes(trip.status));
  const liveAssignedLocation = assignedLocation && assignedLocation.driverId === trip?.driver_id && now > 0 && now - assignedLocation.timestamp < 45_000 ? assignedLocation : null;
  useNearbyDrivers(current ?? undefined, Boolean(current) && !assigned);
  if (!current) return <HomeLocationFallback />;
  const homeRegion = { ...current, ...zoomSpan };
  const markers = assigned
    ? liveAssignedLocation ? [{ id: trip!.driver_id!, kind: 'driver' as const, latitude: liveAssignedLocation.latitude, longitude: liveAssignedLocation.longitude, heading: liveAssignedLocation.heading, title: trip!.driver_name ?? 'Your driver' }] : []
    : (supplyService==='ride'?drivers:[]).map((driver) => ({ ...driver, id: driver.driverId, kind: 'nearby-driver' as const }));
  return <AppMap ref={mapRef} region={homeRegion} mapPadding={mapPadding} markers={[{ ...current, id: 'rider-me', kind: 'rider', title: 'Your location' }, ...markers]} />;
});
