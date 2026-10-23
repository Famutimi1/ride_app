/** Rider home: live map, destination search, and an adjustable address sheet. */
import { useCallback, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/common';
import { RideMap, type AppMapHandle } from '@/components/map';
import { borderWidths, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { useUiStore } from '@/store/uiStore';
import { focusOnCurrentLocation, LocationUnavailableError } from '@/services/locationService';
import { getTripRoute } from '@/services/mapsService';
import { getTripHistory } from '@/services/tripService';
import { selectRepeatRides, type RepeatRide } from '@/utils/rideAgain';
import { tripBelongsToRole } from '@/utils/roleAccess';

import { HomeIcon } from './HomeIcon';

const SERVICES = [
  { id: 'ride', image: require('@/assets/images/home-v2/ride.png'), label: 'Ride', detail: 'Everyday trips' },
  { id: 'courier', image: require('@/assets/images/home-v2/courier.png'), label: 'Courier', detail: 'Send a parcel' },
  { id: 'schedule', image: require('@/assets/images/home-v2/schedule.png'), label: 'Schedule', detail: 'Book ahead' },
] as const;

export function HomeScreen() {
  const router = useRouter();
  const mapRef = useRef<AppMapHandle>(null);
  const { colors, scheme } = useTheme();
  const setThemePreference = useUiStore((state) => state.setThemePreference);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = Math.min(416 + insets.bottom, height * 0.58);
  const user = useAuthStore((state) => state.session?.user);
  const userId = user?.id;
  const userRole = user?.role;
  const [locationError, setLocationError] = useState<string | null>(null);
  const [repeatRides, setRepeatRides] = useState<RepeatRide[]>([]);
  const [ridesLoading, setRidesLoading] = useState(true);
  const [ridesError, setRidesError] = useState(false);
  const [refreshRides, setRefreshRides] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!userId || userRole !== 'rider') return;
    let active = true;
    setRidesLoading(true);
    setRidesError(false);
    if (refreshRides > 0) setRepeatRides([]);
    const load = async () => {
      try {
        const trips = [] as Awaited<ReturnType<typeof getTripHistory>>['trips'];
        let cursor: string | undefined;
        for (let page = 0; page < 5; page += 1) {
          const result = await getTripHistory(cursor, { serviceType: 'ride', limit: 50 });
          trips.push(...result.trips.filter(trip => tripBelongsToRole(trip, userId, 'rider')));
          if (selectRepeatRides(trips).length >= 2 || !result.nextCursor) break;
          cursor = result.nextCursor;
        }
        if (active) setRepeatRides(selectRepeatRides(trips));
      } catch {
        if (active) setRidesError(true);
      } finally {
        if (active) setRidesLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [userId, userRole, refreshRides]));

  if (!user) return null;

  const openDestinationPage = () => router.push('/set-destination');
  const repeatRide = (ride: RepeatRide) => {
    const trip = ride.trip;
    const pickup = { latitude: trip.pickup_lat, longitude: trip.pickup_lng, address: trip.pickup_address, placeId: trip.pickup_place_id ?? undefined };
    const dropoff = { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, address: trip.dropoff_address, placeId: trip.dropoff_place_id ?? undefined };
    const map = useMapStore.getState();
    map.setPickupLocation(pickup);
    map.setDropoffLocation(dropoff);
    map.setRouteCoordinates([]);
    map.setCameraRegion({ ...pickup, latitudeDelta: 0.018, longitudeDelta: 0.014 });
    router.push('/set-destination');
    void getTripRoute(pickup, dropoff).then((route) => {
      useMapStore.getState().setRouteForEndpoints(pickup, dropoff, route.coordinates);
    }).catch(() => { /* The selected addresses remain editable if directions are unavailable. */ });
  };

  const openAccountSection = (section: string) => router.push({ pathname: '/account/[section]', params: { section } });

  return (
    <View style={[styles.screen, { backgroundColor: colors.surfaceMuted }]}>
      <View style={[StyleSheet.absoluteFill, { bottom: sheetHeight }]}>
        <RideMap ref={mapRef} mapPadding={{ top: insets.top + 132, right: 20, bottom: 20, left: 20 }} />
      </View>
      <SafeAreaView edges={['top']} style={styles.topControls} pointerEvents="box-none">
        <View style={styles.toolbar} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Open account menu" onPress={() => router.push('/menu')} style={[styles.roundControl, { backgroundColor: colors.surface }]}>
            <HomeIcon name="menu" size={22} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onPress={() => setThemePreference(scheme === 'dark' ? 'light' : 'dark')} style={[styles.roundControl, { backgroundColor: colors.surface }]}>
            <HomeIcon name={scheme === 'dark' ? 'moon' : 'sun'} size={22} />
          </Pressable>
        </View>
        <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open pickup and destination search" onPress={openDestinationPage} style={styles.destinationSearch}>
            <HomeIcon name="search" size={21} />
            <Text variant="bodyMedium" numberOfLines={1}>Where to?</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Schedule a ride for later" onPress={() => router.push('/schedule')} style={[styles.scheduleButton, { backgroundColor: colors.surfaceMuted }]}>
            <HomeIcon name="calendar" size={17} />
            <Text variant="caption">Schedule</Text>
          </Pressable>
        </View>
        {locationError ? <View accessibilityRole="alert" style={[styles.locationError, { backgroundColor: colors.surface }]}>
          <Text variant="caption">{locationError}</Text>
        </View> : null}
      </SafeAreaView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Center map on my current location"
        onPress={() => {
          setLocationError(null);
          const cached = useMapStore.getState().currentLocation;
          if (cached) mapRef.current?.animateToRegion({ ...cached, latitudeDelta: 0.018, longitudeDelta: 0.014 });
          void focusOnCurrentLocation().then((permission) => {
            if (permission !== 'granted') setLocationError('Allow location access to center the map on your position.');
            else {
              const current = useMapStore.getState().currentLocation;
              if (current) mapRef.current?.animateToRegion({ ...current, latitudeDelta: 0.018, longitudeDelta: 0.014 });
            }
          }).catch((error: unknown) => {
            setLocationError(error instanceof LocationUnavailableError ? error.message : 'Could not refresh your location. Please try again.');
          });
        }}
        style={[styles.recenter, styles.roundControl, { bottom: sheetHeight + 16, backgroundColor: colors.surface }]}
      >
        <HomeIcon name="locate" size={24} color="primary" />
      </Pressable>

      <SafeAreaView edges={['bottom']} style={[styles.sheet, { height: sheetHeight, backgroundColor: colors.surface }]}>
        <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <View style={styles.sectionHeader}>
            <Text variant="bodyMedium">Our services</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Explore all services" onPress={() => openAccountSection('services')} style={styles.sectionAction}>
              <Text variant="caption" color="primary">Explore</Text>
              <HomeIcon name="chevron" size={14} color="primary" />
            </Pressable>
          </View>
          <View style={styles.services}>
            {SERVICES.map(service => (
              <Pressable cssInterop={false} key={service.id} accessibilityRole="button" accessibilityLabel={`${service.label}: ${service.detail}`} onPress={() => service.id === 'schedule' ? router.push('/schedule') : service.id === 'courier' ? router.push('/courier') : openDestinationPage()}
                style={({ pressed }) => [styles.serviceTile, { backgroundColor: colors.primarySoft, opacity: pressed ? 0.7 : 1 }]}
              >
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
                  <Image source={service.image} contentFit="contain" style={styles.serviceArt} />
                </View>
                <Text variant="button" style={styles.centered}>{service.label}</Text>
                <Text variant="caption" color="textMuted" style={styles.centered}>{service.detail}</Text>
              </Pressable>
            ))}
          </View>
          {user.role === 'rider' ? <>
            <View style={[styles.sectionHeader, styles.historyHeader]}>
              <Text variant="bodyMedium">Ride again</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="See all trips" onPress={() => openAccountSection('trips')} style={styles.sectionAction}>
                <Text variant="caption" color="primary">See all</Text>
                <HomeIcon name="chevron" size={14} color="primary" />
              </Pressable>
            </View>
            {repeatRides.map((ride, index) => (
              <Pressable cssInterop={false} key={ride.trip.id} accessibilityRole="button" accessibilityLabel={`${ride.completedCount ? 'Ride again' : 'Try route again'} from ${ride.trip.pickup_address} to ${ride.trip.dropoff_address}`} onPress={() => repeatRide(ride)}
                style={({ pressed }) => [styles.historyRow, { borderTopColor: colors.border, borderTopWidth: index ? borderWidths.divider : 0, opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={[styles.historyIcon, { backgroundColor: colors.primarySoft }]}>
                  <HomeIcon name="history" size={19} color="primary" />
                </View>
                <View style={styles.routeCopy}>
                  <Text variant="button" numberOfLines={2}>{ride.trip.dropoff_address.split(',')[0]}</Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>From {ride.trip.pickup_address}</Text>
                </View>
                <View style={styles.repeatAction}>
                  <Text variant="caption" color="primary">{ride.completedCount ? 'Ride again' : 'Try again'}</Text>
                  <HomeIcon name="chevron" size={14} color="primary" />
                </View>
              </Pressable>
            ))}
            {ridesLoading && !repeatRides.length ? <Text variant="caption" color="textMuted" style={styles.emptyHistory}>Loading your recent rides…</Text> : null}
            {!ridesLoading && !repeatRides.length ? (
              <Pressable accessibilityRole="button" accessibilityLabel={ridesError ? 'Retry loading recent rides' : 'Plan your first ride'} onPress={ridesError ? () => setRefreshRides(value => value + 1) : openDestinationPage} style={styles.emptyHistory}>
                <Text variant="caption" color="textMuted">{ridesError ? 'Could not load your rides. Tap to retry.' : 'Your recent routes will appear here. Plan your first ride.'}</Text>
              </Pressable>
            ) : null}
          </> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Open trip safety tools" onPress={() => openAccountSection('safety')} style={[styles.safetyStrip, { backgroundColor: colors.primarySoft }]}>
            <HomeIcon name="safety" size={20} color="primary" />
            <Text variant="caption" style={styles.safetyCopy}>Safety tools for every trip</Text>
            <HomeIcon name="chevron" size={14} color="primary" />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topControls: { position: 'absolute', top: 0, left: 16, right: 16, paddingTop: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roundControl: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  searchBar: { marginTop: 10, minHeight: 56, padding: 4, paddingLeft: 16, borderRadius: 18, flexDirection: 'row', alignItems: 'center', elevation: 4 },
  destinationSearch: { minHeight: 48, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  scheduleButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 14 },
  locationError: { marginTop: 8, padding: 12, borderRadius: 12 },
  recenter: { position: 'absolute', right: 16 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, overflow: 'hidden', elevation: 6 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 2 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 12 },
  sectionHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, paddingLeft: 12 },
  services: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  serviceTile: { flex: 1, minWidth: 0, minHeight: 112, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 8, borderRadius: 16, gap: 2 },
  serviceArt: { width: 64, height: 48 },
  centered: { textAlign: 'center' },
  historyHeader: { marginTop: 4 },
  historyRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  historyIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  routeCopy: { flex: 1, minWidth: 0, gap: 2 },
  repeatAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  emptyHistory: { minHeight: 48, paddingVertical: 12 },
  safetyStrip: { minHeight: 48, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  safetyCopy: { flex: 1 },
});
