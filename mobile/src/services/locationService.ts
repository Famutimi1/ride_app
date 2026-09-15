import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { getSocket, SOCKET_EVENTS } from './socket';

export const DRIVER_LOCATION_TASK = 'driver-background-location';
const DRIVER_CONTEXT_KEY = 'driver-location-context';
export type AppPermissionState = 'granted' | 'denied' | 'blocked' | 'restricted';

function permissionState(permission: Location.LocationPermissionResponse): AppPermissionState {
  if (permission.status === Location.PermissionStatus.GRANTED) return 'granted';
  if (!permission.canAskAgain) return 'blocked';
  return permission.status === Location.PermissionStatus.UNDETERMINED ? 'restricted' : 'denied';
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(DRIVER_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const latest = data.locations[data.locations.length - 1];
  const savedContext = await AsyncStorage.getItem(DRIVER_CONTEXT_KEY);
  const context = savedContext ? JSON.parse(savedContext) as { driverId: string; tripId?: string } : { driverId: 'current-driver' };
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

export async function getCurrentCoordinate() {
  const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: result.coords.latitude, longitude: result.coords.longitude };
}

export async function requestDriverBackgroundLocation() {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) return 'denied' as const;
  return permissionState(await Location.requestBackgroundPermissionsAsync());
}

export async function startDriverLocationUpdates(driverId: string, tripId?: string) {
  const watcher = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 4_000, distanceInterval: 10 },
    (position) => getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
      driverId, tripId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      heading: position.coords.heading ?? undefined,
      timestamp: position.timestamp,
    }),
  );
  return () => watcher.remove();
}

export async function startDriverBackgroundUpdates(driverId: string, tripId?: string) {
  await AsyncStorage.setItem(DRIVER_CONTEXT_KEY, JSON.stringify({ driverId, tripId }));
  if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 4_000,
    distanceInterval: 10,
    foregroundService: {
      notificationTitle: 'Ride driver is online',
      notificationBody: 'Sharing your location to receive and complete trips.',
    },
  });
}

export async function stopDriverBackgroundUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
  await AsyncStorage.removeItem(DRIVER_CONTEXT_KEY);
}

export const openLocationSettings = () => Linking.openSettings();
