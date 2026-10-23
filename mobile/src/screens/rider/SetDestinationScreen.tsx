import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { AddressSheet, AppMap, type AppMapHandle, type AppMapMarker } from '@/components/map';
import { AddressIcon } from '@/components/map/AddressIcon';
import type { AddressField } from '@/components/map/AddressSheet';
import { getCurrentCoordinate, LocationUnavailableError, openDeviceLocationSettings, openLocationSettings, requestForegroundLocation, type AppPermissionState } from '@/services/locationService';
import { reverseGeocode } from '@/services/mapsService';
import { useMapStore, type MapLocation, type MapRegion } from '@/store/mapStore';
import { useNearbyDrivers } from '@/hooks/useNearbyDrivers';
import { useTheme } from '@/constants/theme';

const LOCATION_ERROR_DURATION_MS = 6_000;
// Mobile uses zoom 17; web retains zoom 15. Route previews still fit both endpoints.
const DESTINATION_FOCUS_SPAN = Platform.OS === 'web'
  ? { latitudeDelta: 0.018, longitudeDelta: 0.014 }
  : { latitudeDelta: 0.0045, longitudeDelta: 0.0035 };

export function SetDestinationScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [screenHeight, setScreenHeight] = useState(windowHeight);
  const { scheduledAt, service } = useLocalSearchParams<{ scheduledAt?: string; service?: string }>();
  const mapRef = useRef<AppMapHandle>(null);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickupSelectionVersion = useRef(0);
  const mapSelectionRevision = useRef(0);
  const [activeMapField, setActiveMapField] = useState<AddressField>('dropoff');
  const [mapSelection, setMapSelection] = useState<{ field: AddressField; location: MapLocation; revision: number } | null>(null);
  const [mapSelectionPending, setMapSelectionPending] = useState(false);
  const [previewingTrip, setPreviewingTrip] = useState(false);
  const [autoFitRoute, setAutoFitRoute] = useState(true);
  const [showMapHint, setShowMapHint] = useState(true);
  const [permission, setPermission] = useState<AppPermissionState | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationServicesDisabled, setLocationServicesDisabled] = useState(false);
  const region = useMapStore((state) => state.cameraRegion);
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const current = useMapStore((state) => state.currentLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const drivers = useMapStore((state) => state.driverLocations);
  const supplyService=useMapStore(state=>state.driverLocationsService);
  const setRegion = useMapStore((state) => state.setCameraRegion);
  const setCurrent = useMapStore((state) => state.setCurrentLocation);
  const setPickup = useMapStore((state) => state.setPickupLocation);
  const setRoute = useMapStore((state) => state.setRouteCoordinates);
  const setLocating = useMapStore((state) => state.setLocating);
  useNearbyDrivers(current ?? pickup ?? undefined, !dropoff, service==='courier'?'courier':'ride');
  useFocusEffect(useCallback(() => {
    setPreviewingTrip(false);
    setAutoFitRoute(true);
    const { pickupLocation, currentLocation, routeCoordinates } = useMapStore.getState();
    const center = pickupLocation ?? currentLocation;
    if (center && routeCoordinates.length < 2) {
      setRegion({ ...center, ...DESTINATION_FOCUS_SPAN });
    }
  }, [setRegion]));

  const goBack = () => router.canGoBack() ? router.back() : router.replace(service === 'courier' ? '/courier' : '/home');

  const clearLocationError = () => {
    if (locationErrorTimer.current) clearTimeout(locationErrorTimer.current);
    locationErrorTimer.current = null;
    setLocationError(null);
    setLocationServicesDisabled(false);
  };

  const showLocationError = (message: string, servicesDisabled = false) => {
    clearLocationError();
    setLocationError(message);
    setLocationServicesDisabled(servicesDisabled);
    locationErrorTimer.current = setTimeout(() => {
      setLocationError(null);
      setLocationServicesDisabled(false);
      locationErrorTimer.current = null;
    }, LOCATION_ERROR_DURATION_MS);
  };

  useEffect(() => {
    hintTimer.current = setTimeout(() => setShowMapHint(false), 2500);
    return () => {
      pickupSelectionVersion.current += 1;
      if (reverseTimer.current) clearTimeout(reverseTimer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (locationErrorTimer.current) clearTimeout(locationErrorTimer.current);
    };
  }, []);

  const enableLocation = async () => {
    const version = ++pickupSelectionVersion.current;
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    setLocating(true);
    clearLocationError();
    try {
      const status = await requestForegroundLocation();
      if (version !== pickupSelectionVersion.current) return;
      setPermission(status);
      if (status !== 'granted') return;
      const coordinate = await getCurrentCoordinate();
      const address = await reverseGeocode(coordinate).catch(() => null);
      if (version !== pickupSelectionVersion.current) return;
      const location = address ?? { ...coordinate, address: 'Current location' };
      setCurrent(location);
      setPickup(location);
      const nextRegion = { ...coordinate, ...DESTINATION_FOCUS_SPAN };
      setAutoFitRoute(false);
      setRegion(nextRegion); mapRef.current?.animateToRegion(nextRegion);
    } catch (error) {
      if (version !== pickupSelectionVersion.current) return;
      showLocationError(error instanceof LocationUnavailableError
        ? error.message
        : 'We could not access your location. Enter a pickup address manually or try again.',
      error instanceof LocationUnavailableError && error.reason === 'services_disabled');
    } finally { setLocating(false); }
  };

  const revealMapHint = () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setShowMapHint(true);
    hintTimer.current = setTimeout(() => setShowMapHint(false), 2200);
  };

  const adjustMapLocation = (nextRegion: MapRegion) => {
    setAutoFitRoute(true);
    revealMapHint();
    const version = ++pickupSelectionVersion.current;
    const field = activeMapField;
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    setMapSelectionPending(true);
    const point = { latitude: nextRegion.latitude, longitude: nextRegion.longitude };
    setRoute([]);
    reverseTimer.current = setTimeout(async () => {
      const location = await reverseGeocode(point).catch(() => null);
      if (version !== pickupSelectionVersion.current) return;
      const selected = { ...point, address: location?.address ?? 'Pin on map', countryCode: location?.countryCode };
      setMapSelection({ field, location: selected, revision: ++mapSelectionRevision.current });
    }, 500);
  };

  const changeActiveMapField = (field: AddressField) => {
    setAutoFitRoute(true);
    revealMapHint();
    pickupSelectionVersion.current += 1;
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    setMapSelectionPending(false);
    setActiveMapField(field);
  };

  const pickupChosen = () => {
    setAutoFitRoute(true);
    pickupSelectionVersion.current += 1;
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    setMapSelectionPending(false);
    clearLocationError();
  };

  const recenterOnCurrentLocation = () => {
    setAutoFitRoute(false);
    pickupSelectionVersion.current += 1;
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    setMapSelectionPending(false);
    if (!current) { void enableLocation(); return; }
    clearLocationError();
    mapRef.current?.animateToRegion({ ...current, ...DESTINATION_FOCUS_SPAN });
  };

  const markers: AppMapMarker[] = [
    ...(!previewingTrip && current ? [{ ...current, id: 'rider-me', kind: 'rider' as const, title: 'Your location' }] : []),
    ...(pickup && (previewingTrip || activeMapField !== 'pickup' || Math.abs(pickup.latitude - region.latitude) > 0.00001 || Math.abs(pickup.longitude - region.longitude) > 0.00001)
      ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
    ...(!previewingTrip && !dropoff && supplyService===(service==='courier'?'courier':'ride') ? drivers.map((driver) => ({ ...driver, id: driver.driverId, kind: 'nearby-driver' as const })) : []),
  ];

  return <View className="flex-1 bg-background" onLayout={event => setScreenHeight(event.nativeEvent.layout.height)}>
    <View className="h-[40%]">
      <AppMap ref={mapRef} region={region} markers={markers} polyline={route} fitRouteOnChange={autoFitRoute} showsUserLocation={false}
        onRegionChangeComplete={setRegion} onUserRegionChangeComplete={adjustMapLocation} mapPadding={{ top: 48, right: 28, bottom: 48, left: 28 }} />
    </View>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0 flex-row items-center justify-between pt-sm">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to previous page" onPress={goBack} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><AddressIcon name="back" size={20} /></Pressable>
    </SafeAreaView>
    {!previewingTrip ? <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '20%', marginLeft: -20, marginTop: -57, width: 40, height: 57, alignItems: 'center' }}>
      <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: colors.mapMarkerOutline, backgroundColor: colors.mapPicker, alignItems: 'center', justifyContent: 'center', elevation: 6 }}>
        <AddressIcon name="edit" size={17} color="mapMarkerOutline" />
      </View>
      <View style={{ width: 3, height: 13, backgroundColor: colors.mapPicker }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mapPicker }} />
    </View> : null}
    {!previewingTrip && showMapHint ? <View pointerEvents="none" className="absolute right-lg top-[7%] items-end">
      <View className="rounded-full bg-surface px-sm py-xs shadow-sm"><Text variant="caption" color="textMuted">Drag map to adjust {activeMapField === 'pickup' ? 'pickup' : 'destination'}</Text></View>
    </View> : null}
    <Pressable cssInterop={false} onPress={recenterOnCurrentLocation}
      accessibilityRole="button" accessibilityLabel="Center map on my location"
      accessibilityState={{ selected: !autoFitRoute }}
      style={{ position: 'absolute', top: screenHeight * 0.4 - 72, right: 16, width: 48, height: 48,
        borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: autoFitRoute ? colors.surface : colors.primarySoft,
        borderWidth: 1, borderColor: autoFitRoute ? colors.border : colors.primary,
        elevation: 5, zIndex: 10, shadowColor: colors.text, shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } }}>
      <AddressIcon name="locate" size={18} color={autoFitRoute ? 'text' : 'primary'} />
    </Pressable>
    {(permission === 'denied' || permission === 'restricted') ? <View className="absolute left-lg right-lg top-[18%] rounded-lg bg-surface p-md shadow-md"><Text variant="caption">Location is off. Search your pickup manually or enable it for faster pickup.</Text><Pressable onPress={() => void enableLocation()}><Text variant="caption" color="primary" className="mt-xs">Enable location</Text></Pressable></View> : null}
    {permission === 'blocked' ? <View className="absolute left-lg right-lg top-[18%] rounded-lg bg-surface p-md shadow-md"><Text variant="caption">Location access is blocked. You can still search manually.</Text><Pressable onPress={openLocationSettings}><Text variant="caption" color="primary" className="mt-xs">Open settings</Text></Pressable></View> : null}
    {locationError ? <View className="absolute left-lg right-lg top-[18%] rounded-lg bg-surface p-md shadow-md"><Text variant="caption">{locationError} You can also tap From and search for your pickup address.</Text><View className="mt-sm flex-row gap-md"><Pressable accessibilityRole="button" onPress={() => void enableLocation()}><Text variant="caption" color="primary">Try again</Text></Pressable>{locationServicesDisabled ? <Pressable accessibilityRole="button" onPress={() => void openDeviceLocationSettings().catch(() => showLocationError('Open device settings and turn on location, or enter your pickup address manually.'))}><Text variant="caption" color="primary">Location settings</Text></Pressable> : null}</View></View> : null}
    <AddressSheet onFindRide={() => { setPreviewingTrip(true); if (service === 'courier') router.push('/courier-review'); else router.push({ pathname: '/ride-selection', params: scheduledAt ? { scheduledAt } : {} }); }} onPickupChosen={pickupChosen} onActiveFieldChange={changeActiveMapField} mapSelection={mapSelection} mapSelectionPending={mapSelectionPending} onMapSelectionApplied={(revision) => { if (revision === mapSelectionRevision.current) setMapSelectionPending(false); }} submitLabel={service === 'courier' ? 'Review delivery' : scheduledAt ? 'Choose a ride' : 'Find Now'} title={service === 'courier' ? 'Plan your delivery' : undefined} pickupLabel={service === 'courier' ? 'Collect from' : undefined} dropoffLabel={service === 'courier' ? 'Deliver to' : undefined} />
  </View>;
}
