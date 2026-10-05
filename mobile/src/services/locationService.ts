import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { getSocket, SOCKET_EVENTS } from './socket';

export const DRIVER_LOCATION_TASK = 'driver-background-location';
const DRIVER_CONTEXT_KEY = 'driver-location-context';
export type AppPermissionState = 'granted' | 'denied' | 'blocked' | 'restricted';

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
  const context = await getSavedDriverContext();
  if (!context) return;
  getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
    ...context,
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    heading: latest.coords.heading ?? undefined,
    timestamp: latest.timestamp,
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

export async function getCurrentCoordinate() {
  const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: result.coords.latitude, longitude: result.coords.longitude };
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
  const initialPosition = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  let latestLocation: Record<string, unknown> = {
    driverId,
    tripId,
    latitude: initialPosition.coords.latitude,
    longitude: initialPosition.coords.longitude,
    heading: initialPosition.coords.heading ?? undefined,
    timestamp: initialPosition.timestamp,
  };
  await confirmInitialDriverLocation(latestLocation);

  const watcher = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 4_000, distanceInterval: 10 },
    (position) => {
      latestLocation = {
        driverId, tripId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      heading: position.coords.heading ?? undefined,
      timestamp: position.timestamp,
      };
      emitDriverLocation(latestLocation, onError);
    },
  );
  // Redis presence expires after 30 seconds. A stationary device may not trigger
  // another watch callback, so refresh its last known coordinate independently.
  const heartbeat = setInterval(() => {
    emitDriverLocation({ ...latestLocation, timestamp: Date.now() }, onError);
  }, 10_000);
  const socket = getSocket();
  const onReconnect = () => emitDriverLocation({ ...latestLocation, timestamp: Date.now() }, onError);
  socket.on('connect', onReconnect);
  return () => {
    clearInterval(heartbeat);
    socket.off('connect', onReconnect);
    watcher.remove();
  };
}

export async function startDriverBackgroundUpdates(driverId: string, tripId?: string) {
  if (Platform.OS === 'web') return;
  await AsyncStorage.setItem(DRIVER_CONTEXT_KEY, JSON.stringify({ driverId, tripId }));
  if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 4_000,
    distanceInterval: 10,
    foregroundService: {
      notificationTitle: 'Rakky Ride driver is online',
      notificationBody: 'Sharing your location to receive and complete trips.',
    },
  });
}

export async function stopDriverBackgroundUpdates() {
  if (Platform.OS === 'web') return;
  if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
  await AsyncStorage.removeItem(DRIVER_CONTEXT_KEY);
}

export async function isDriverBackgroundUpdatesActive(driverId?: string) {
  if (Platform.OS === 'web' || !await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) return false;
  if (!driverId) return true;
  return (await getSavedDriverContext())?.driverId === driverId;
}

export function markDriverOffline() {
  getSocket().emit(SOCKET_EVENTS.DRIVER_OFFLINE, (result: { ok: boolean; error?: string }) => {
    if (!result.ok) console.warn(`[location] ${result.error ?? 'offline update failed'}`);
  });
}

export const openLocationSettings = () => Linking.openSettings();
