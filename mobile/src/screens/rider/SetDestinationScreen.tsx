import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { AddressSheet, AppMap, type AppMapHandle, type AppMapMarker } from '@/components/map';
import { getCurrentCoordinate, openLocationSettings, requestForegroundLocation, type AppPermissionState } from '@/services/locationService';
import { reverseGeocode } from '@/services/mapsService';
import { useMapStore, type MapRegion } from '@/store/mapStore';
import { useNearbyDrivers } from '@/hooks/useNearbyDrivers';

export function SetDestinationScreen() {
  const router = useRouter();
  const mapRef = useRef<AppMapHandle>(null);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [permission, setPermission] = useState<AppPermissionState | null>(null);
  const region = useMapStore((state) => state.cameraRegion);
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const current = useMapStore((state) => state.currentLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const drivers = useMapStore((state) => state.driverLocations);
  const setRegion = useMapStore((state) => state.setCameraRegion);
  const setCurrent = useMapStore((state) => state.setCurrentLocation);
  const setPickup = useMapStore((state) => state.setPickupLocation);
  const setLocating = useMapStore((state) => state.setLocating);
  useNearbyDrivers(current ?? pickup ?? undefined);

  const goBack = () => router.canGoBack() ? router.back() : router.replace('/home');

  useEffect(() => () => { if (reverseTimer.current) clearTimeout(reverseTimer.current); }, []);
  useEffect(() => {
    if (route.length > 1) mapRef.current?.fitToCoordinates(route);
  }, [route]);

  const enableLocation = async () => {
    setLocating(true);
    const status = await requestForegroundLocation(); setPermission(status);
    if (status !== 'granted') { setLocating(false); return; }
    try {
      const coordinate = await getCurrentCoordinate();
      const address = await reverseGeocode(coordinate);
      const location = address ?? { ...coordinate, address: 'Current location' };
      setCurrent(location); setPickup(location);
      const nextRegion = { ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.014 };
      setRegion(nextRegion); mapRef.current?.animateToRegion(nextRegion);
    } finally { setLocating(false); }
  };

  const adjustPickup = (nextRegion: MapRegion) => {
    setRegion(nextRegion);
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    reverseTimer.current = setTimeout(async () => {
      try {
        const location = await reverseGeocode(nextRegion);
        if (location) setPickup(location);
      } catch { /* Manual pin remains usable when reverse geocoding is unavailable. */ }
    }, 500);
  };

  const markers: AppMapMarker[] = [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
    ...drivers.map((driver) => ({ ...driver, id: driver.driverId, kind: 'nearby-driver' as const })),
  ];

  return <View className="flex-1 bg-background">
    <AppMap ref={mapRef} region={region} markers={markers} polyline={route} showsUserLocation={permission === 'granted'}
      onRegionChangeComplete={adjustPickup} mapPadding={{ top: 100, right: 28, bottom: 430, left: 28 }} />
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0 flex-row items-center justify-between pt-sm">
      <Pressable onPress={goBack} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">←</Text></Pressable>
    </SafeAreaView>
    <View pointerEvents="none" className="absolute left-1/2 top-[31%] -ml-4 h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-surface shadow-md"><Text color="primary">●</Text></View>
    <Pressable onPress={() => current ? mapRef.current?.animateToRegion({ ...current, latitudeDelta: 0.018, longitudeDelta: 0.014 }) : void enableLocation()}
      className="absolute right-lg top-[35%] h-12 w-12 items-center justify-center rounded-full bg-success shadow-md"><Text color="textInverse">◎</Text></Pressable>
    {(permission === 'denied' || permission === 'restricted') ? <View className="absolute left-lg right-lg top-[18%] rounded-lg bg-surface p-md shadow-md"><Text variant="caption">Location is off. Search your pickup manually or enable it for faster pickup.</Text><Pressable onPress={() => void enableLocation()}><Text variant="caption" color="primary" className="mt-xs">Enable location</Text></Pressable></View> : null}
    {permission === 'blocked' ? <View className="absolute left-lg right-lg top-[18%] rounded-lg bg-surface p-md shadow-md"><Text variant="caption">Location access is blocked. You can still search manually.</Text><Pressable onPress={openLocationSettings}><Text variant="caption" color="primary" className="mt-xs">Open settings</Text></Pressable></View> : null}
    <AddressSheet onClose={goBack} onFindRide={() => router.push('/ride-selection')} />
  </View>;
}
