import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { getSocket, SOCKET_EVENTS } from './socket';
import { useMapStore, type MapCoordinate } from '@/store/mapStore';
import { useCallStore } from '@/store/callStore';

export const DRIVER_LOCATION_TASK = 'driver-background-location';
const DRIVER_CONTEXT_KEY = 'driver-location-context';
let trackingGeneration = 0;
let backgroundOperation: Promise<void> = Promise.resolve();
function serializeBackground(operation: () => Promise<void>) {
  const result = backgroundOperation.then(operation);
  backgroundOperation = result.catch(() => undefined);
  return result;
}
const foregroundStops = new Set<() => void>();
export type AppPermissionState = 'granted' | 'denied' | 'blocked' | 'restricted';

type LocationFailureReason = 'services_disabled' | 'position_unavailable' | 'permission_denied' | 'timeout' | 'insecure_context' | 'browser_unsupported';

function locationFailureMessage(reason: LocationFailureReason): string {
  if (reason === 'services_disabled') return 'Location services are off. Turn on device location and try again.';
  if (Platform.OS === 'web') {
    switch (reason) {
      case 'permission_denied':
        return 'Location access is blocked. Allow location for this site in your browser and device settings, then try again.';
      case 'timeout':
        return 'Your browser took too long to find your location. Try again or enter your pickup address.';
      case 'insecure_context':
        return 'Browser location requires HTTPS or localhost. Open a secure version of this page or enter your pickup address.';
      case 'browser_unsupported':
        return 'This browser does not provide location access. Use a browser with location support or enter your pickup address.';
      default:
        return 'Your browser\'s location service could not find your position. Check device location services, try another browser, or enter your pickup address.';
    }
  }
  if (Platform.OS === 'android' && !Device.isDevice) {
    return 'Could not get the emulator location. Send a location from its Location controls, then try again.';
  }
  return 'Your device could not find your location. Move to an open area and try again.';
}

export class LocationUnavailableError extends Error {
  constructor(public readonly reason: LocationFailureReason) {
    super(locationFailureMessage(reason));
    this.name = 'LocationUnavailableError';
  }
}

interface DriverLocationContext {
  driverId: string;
  tripId?: string;
}

async function getSavedDriverContext(): Promise<DriverLocationContext | null> {
  const savedContext = await AsyncStorage.getItem(DRIVER_CONTEXT_KEY);
  if (!savedContext) return null;
  try {
    const context = JSON.parse(savedContext) as Partial<DriverLocationContext>;
    return typeof context.driverId === 'string' ? { driverId: context.driverId, tripId: context.tripId } : null;
  } catch {
    return null;
  }
}

function permissionState(permission: Location.LocationPermissionResponse): AppPermissionState {
  if (permission.status === Location.PermissionStatus.GRANTED) return 'granted';
  if (!permission.canAskAgain) return 'blocked';
  return permission.status === Location.PermissionStatus.UNDETERMINED ? 'restricted' : 'denied';
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(DRIVER_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const latest = data.locations[data.locations.length - 1];
  const generation = trackingGeneration;
  const context = await getSavedDriverContext();
  if (!context || generation !== trackingGeneration) return;
  getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
    ...context,
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    heading: latest.coords.heading ?? undefined,
    timestamp: latest.timestamp,
    sampleTimestamp: latest.timestamp, accuracy: latest.coords.accuracy, speed: latest.coords.speed,
  });
});

export async function requestForegroundLocation() {
  return permissionState(await Location.requestForegroundPermissionsAsync());
}

export async function getForegroundLocationPermission() {
  return permissionState(await Location.getForegroundPermissionsAsync());
}

export async function getDriverBackgroundLocationPermission() {
  if (Platform.OS === 'web') return 'granted' as const;
  return permissionState(await Location.getBackgroundPermissionsAsync());
}

export async function areLocationServicesEnabled() {
  if (Platform.OS === 'web') return true;
  return Location.hasServicesEnabledAsync();
}

export async function requestEnableLocationServices() {
  if (Platform.OS !== 'android') return areLocationServicesEnabled();
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    // The user can dismiss Android's high-accuracy location prompt.
  }
  return areLocationServicesEnabled();
}

export async function getCurrentCoordinate(): Promise<MapCoordinate> {
  if (Platform.OS === 'web') return getBrowserCoordinate();
  if (!await areLocationServicesEnabled()) throw new LocationUnavailableError('services_disabled');

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Location.getCurrentPositionAsync({
        // Android emulators may only have a GPS provider, with no network fix.
        accuracy: Platform.OS === 'android' ? Location.Accuracy.High : Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: false,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LocationUnavailableError('position_unavailable')), 15_000);
      }),
    ]);
    return { latitude: result.coords.latitude, longitude: result.coords.longitude };
  } catch (error) {
    if (__DEV__) console.warn('Current location request failed:', error);
    // Do not use a cached fix after services or permission have been revoked.
    if (!await areLocationServicesEnabled()) throw new LocationUnavailableError('services_disabled');
    if (await getForegroundLocationPermission() === 'granted') {
      const recent = await getRecentCoordinate().catch(() => null);
      if (recent) return recent;
    }
    throw new LocationUnavailableError('position_unavailable');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function getBrowserCoordinate(): Promise<MapCoordinate> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new LocationUnavailableError('insecure_context');
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new LocationUnavailableError('browser_unsupported');
  }
  // Expo's web implementation forwards these standard browser options. Let the
  // browser manage the timeout: its permission prompt must not consume the
  // native 15-second GPS deadline, and a desktop location fix can take longer.
  const options: Location.LocationOptions & PositionOptions = {
    accuracy: Location.Accuracy.Balanced,
    enableHighAccuracy: false,
    maximumAge: 30_000,
    timeout: 60_000,
  };
  try {
    const result = await Location.getCurrentPositionAsync(options);
    return { latitude: result.coords.latitude, longitude: result.coords.longitude };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (__DEV__) console.warn('Browser location request failed:', error);
    if (code === 1) throw new LocationUnavailableError('permission_denied');
    if (code === 3) throw new LocationUnavailableError('timeout');
    throw new LocationUnavailableError('position_unavailable');
  }
}

export async function getRecentCoordinate() {
  const result = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 200 });
  return result ? { latitude: result.coords.latitude, longitude: result.coords.longitude } : null;
}

export async function focusOnCurrentLocation(): Promise<AppPermissionState> {
  const permission = await requestForegroundLocation();
  if (permission !== 'granted') {
    useMapStore.getState().setCurrentLocation(null);
    return permission;
  }
  if (!await areLocationServicesEnabled() && !await requestEnableLocationServices()) {
    throw new LocationUnavailableError('services_disabled');
  }
  const coordinate = await getCurrentCoordinate();
  const store = useMapStore.getState();
  const location = { ...coordinate, address: 'Current location' };
  store.setCurrentLocation(location);
  store.setPickupLocation(location);
  store.setCameraRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.014 });
  return 'granted';
}

export async function requestDriverBackgroundLocation() {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) return 'denied' as const;
  return permissionState(await Location.requestBackgroundPermissionsAsync());
}

function emitDriverLocation(payload: Record<string, unknown>, onError?: (message: string | null) => void) {
  getSocket().timeout(5_000).emit(SOCKET_EVENTS.DRIVER_LOCATION, payload, (error: Error | null, result?: { ok: boolean; error?: string }) => {
    if (error || !result?.ok) onError?.(result?.error ?? 'Location connection interrupted. Reconnecting…');
    else onError?.(null);
  });
}

function confirmInitialDriverLocation(payload: Record<string, unknown>) {
  return new Promise<void>((resolve, reject) => {
    getSocket().timeout(8_000).emit(
      SOCKET_EVENTS.DRIVER_LOCATION,
      payload,
      (error: Error | null, result?: { ok: boolean; error?: string }) => {
        if (error) {
          reject(new Error('The server could not be reached. Check your connection and try again.'));
          return;
        }
        if (!result?.ok) {
          reject(new Error(result?.error ?? 'The server did not accept your location.'));
          return;
        }
        resolve();
      },
    );
  });
}

export async function startDriverLocationUpdates(driverId: string, tripId?: string, onError?: (message: string | null) => void) {
  const generation = trackingGeneration;
  const assertCurrent = () => { if (generation !== trackingGeneration) throw new Error('Driver tracking session ended.'); };
  const initialPosition = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  let previousVideoPosition = initialPosition;
  assertCurrent();
  updateLocalDriverPosition(initialPosition.coords.latitude, initialPosition.coords.longitude);
  let latestLocation: Record<string, unknown> = {
    driverId,
    tripId,
    latitude: initialPosition.coords.latitude,
    longitude: initialPosition.coords.longitude,
    heading: initialPosition.coords.heading ?? undefined,
    timestamp: initialPosition.timestamp,
    sampleTimestamp: initialPosition.timestamp, accuracy: initialPosition.coords.accuracy, speed: initialPosition.coords.speed,
  };
  await confirmInitialDriverLocation(latestLocation);
  assertCurrent();

  const watcher = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 4_000, distanceInterval: 0 },
    (position) => {
      if (generation !== trackingGeneration) return;
      if (useCallStore.getState().call?.media === 'video') {
        const seconds = (position.timestamp - previousVideoPosition.timestamp) / 1000;
        const latitudeRadians = Math.PI / 180;
        const north = (position.coords.latitude - previousVideoPosition.coords.latitude) * 111_195;
        const east = (position.coords.longitude - previousVideoPosition.coords.longitude) * 111_195 * Math.cos(position.coords.latitude * latitudeRadians);
        const derivedSpeed = seconds > 0 ? Math.hypot(north, east) / seconds : north === 0 && east === 0 ? 0 : Infinity;
        if (position.coords.accuracy == null || !Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 || position.coords.accuracy > 20
          || Date.now() - position.timestamp > 10_000 || (position.coords.speed ?? 0) > 0.5 || derivedSpeed > 0.5)
          void useCallStore.getState().controller?.audioOnly();
      }
      previousVideoPosition = position;
      updateLocalDriverPosition(position.coords.latitude, position.coords.longitude);
      latestLocation = {
        driverId, tripId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        heading: position.coords.heading ?? undefined,
        timestamp: position.timestamp,
        sampleTimestamp: position.timestamp, accuracy: position.coords.accuracy, speed: position.coords.speed,
      };
      emitDriverLocation(latestLocation, onError);
    },
  );
  if (generation !== trackingGeneration) { watcher.remove(); throw new Error('Driver tracking session ended.'); }
  // Redis presence expires after 30 seconds. A stationary device may not trigger
  // another watch callback, so refresh its last known coordinate independently.
  const heartbeat = setInterval(() => {
    emitDriverLocation({ ...latestLocation, timestamp: Date.now() }, onError);
  }, 10_000);
  const socket = getSocket();
  const onReconnect = () => emitDriverLocation({ ...latestLocation, timestamp: Date.now() }, onError);
  socket.on('connect', onReconnect);
  const stop = () => {
    clearInterval(heartbeat);
    socket.off('connect', onReconnect);
    watcher.remove();
    foregroundStops.delete(stop);
  };
  foregroundStops.add(stop);
  return stop;
}

function updateLocalDriverPosition(latitude: number, longitude: number) {
  // The map store is local UI state; Redis remains the source of shared live locations.
  const state = useMapStore.getState();
  state.setCurrentLocation({ latitude, longitude, address: state.currentLocation?.address ?? 'Current location' });
}

export async function startDriverBackgroundUpdates(driverId: string, tripId?: string) {
  if (Platform.OS === 'web') return;
  const generation = trackingGeneration;
  return serializeBackground(async () => {
    if (generation !== trackingGeneration) return;
    await AsyncStorage.setItem(DRIVER_CONTEXT_KEY, JSON.stringify({ driverId, tripId }));
    const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    if (generation !== trackingGeneration) { await stopBackground(); return; }
    if (started) return;
    try {
      await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 4_000,
        distanceInterval: 10,
        foregroundService: {
          notificationTitle: 'Rakky Ride driver is online',
          notificationBody: 'Sharing your location to receive and complete trips.',
        },
      });
    } catch (error) {
      await AsyncStorage.removeItem(DRIVER_CONTEXT_KEY);
      throw error;
    }
    if (generation !== trackingGeneration) await stopBackground();
  });
}

async function stopBackground() {
  // Remove identity first: callbacks cannot publish if the native stop fails.
  await AsyncStorage.removeItem(DRIVER_CONTEXT_KEY);
  if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
}
export async function stopDriverBackgroundUpdates() {
  if (Platform.OS === 'web') return;
  return serializeBackground(stopBackground);
}

export async function stopAllDriverLocationUpdates() {
  trackingGeneration += 1;
  for (const stop of foregroundStops) stop();
  await stopDriverBackgroundUpdates();
}

export async function isDriverBackgroundUpdatesActive(driverId?: string) {
  if (Platform.OS === 'web' || !await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) return false;
  if (!driverId) return true;
  return (await getSavedDriverContext())?.driverId === driverId;
}

export function markDriverOffline(): Promise<void> {
  return new Promise((resolve, reject) => {
    getSocket().timeout(8000).emit(SOCKET_EVENTS.DRIVER_OFFLINE, (error: Error | null, result?: { ok: boolean; error?: string }) => {
      if (error) return reject(new Error('The server could not be reached. Your online session is kept.'));
      if (!result?.ok) return reject(new Error(result?.error === 'active_trip_must_remain_online' ? 'Finish your active trip before going offline.' : result?.error ?? 'Could not go offline.'));
      resolve();
    });
  });
}

export async function openLocationSettings(): Promise<boolean> {
  // Browsers do not expose a way for a page to open its site-permission settings.
  if (Platform.OS === 'web') return false;
  await Linking.openSettings();
  return true;
}

export async function openDeviceLocationSettings(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
    return true;
  }
  return openLocationSettings();
}
