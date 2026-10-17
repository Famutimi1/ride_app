import { useEffect, useMemo, useRef, useState } from 'react';
import { getTripRoute } from '@/services/mapsService';
import type { Trip } from '@/services/tripService';
import type { MapCoordinate } from '@/store/mapStore';
import { anchorPolyline, decodePolyline } from '@/utils/polyline';

const ROUTE_REFRESH_MS = 45_000;
const EMPTY_ROUTE: MapCoordinate[] = [];

export function useTripMapRoute(trip: Trip | null, livePosition: MapCoordinate | null) {
  const [liveRoute, setLiveRoute] = useState<{ key: string; points: MapCoordinate[] } | null>(null);
  const positionRef = useRef(livePosition);
  useEffect(() => { positionRef.current = livePosition; }, [livePosition]);

  const routeKey = trip ? `${trip.id}:${trip.status}` : '';
  const destination = trip?.status === 'in_progress'
    ? { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng }
    : trip?.status === 'returning' || trip?.status === 'driver_assigned' || trip?.status === 'driver_arrived'
      ? { latitude: trip.pickup_lat, longitude: trip.pickup_lng }
      : null;
  const targetLat = destination?.latitude;
  const targetLng = destination?.longitude;
  const hasPosition = Boolean(livePosition);

  useEffect(() => {
    if (!routeKey || targetLat === undefined || targetLng === undefined || !hasPosition) return;
    let active = true;
    const refresh = async () => {
      const origin = positionRef.current;
      if (!origin) return;
      try {
        const result = await getTripRoute(origin, { latitude: targetLat, longitude: targetLng });
        if (active) setLiveRoute({ key: routeKey, points: result.coordinates });
      } catch { /* Keep the planned route visible when live directions cannot load. */ }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), ROUTE_REFRESH_MS);
    return () => { active = false; clearInterval(interval); };
  }, [routeKey, targetLat, targetLng, hasPosition]);

  const routePolyline = trip?.route_polyline;
  const planned = useMemo(() => trip && routePolyline
    ? anchorPolyline(decodePolyline(routePolyline),
      { latitude: trip.pickup_lat, longitude: trip.pickup_lng },
      { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng })
    : [], [trip, routePolyline]);
  const active = liveRoute?.key === routeKey && hasPosition ? liveRoute.points : null;
  if (trip?.status === 'returning') return { primary: active ?? EMPTY_ROUTE, secondary: EMPTY_ROUTE };
  if (!destination || !hasPosition) return { primary: planned, secondary: EMPTY_ROUTE };
  if (trip?.status === 'driver_assigned' || trip?.status === 'driver_arrived') {
    return { primary: active ?? EMPTY_ROUTE, secondary: planned };
  }
  return { primary: active ?? EMPTY_ROUTE, secondary: active ? EMPTY_ROUTE : planned };
}
