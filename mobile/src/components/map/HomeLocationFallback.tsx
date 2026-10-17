import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { focusOnCurrentLocation, LocationUnavailableError, openDeviceLocationSettings, openLocationSettings } from '@/services/locationService';
import { reverseGeocode } from '@/services/mapsService';
import { useMapStore } from '@/store/mapStore';

export function HomeLocationFallback({ compact = false }: { compact?: boolean }) {
  const locating = useMapStore((state) => state.locating);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [servicesDisabled, setServicesDisabled] = useState(false);

  const locate = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setServicesDisabled(false);
    try {
      const permission = await focusOnCurrentLocation();
      if (permission !== 'granted') {
        setMessage(Platform.OS === 'web'
          ? 'Allow location for this site in your browser, then try again.'
          : 'Allow location for Rakky Ride in your phone settings, then try again.');
        if (Platform.OS !== 'web' && permission === 'blocked') await openLocationSettings();
        return;
      }
      const coordinate = useMapStore.getState().currentLocation;
      if (!coordinate) return;
      const resolved = await reverseGeocode(coordinate).catch(() => null);
      if (resolved) {
        const current = useMapStore.getState().currentLocation;
        if (current?.latitude === coordinate.latitude && current.longitude === coordinate.longitude) {
          useMapStore.getState().setCurrentLocation(resolved);
          useMapStore.getState().setPickupLocation(resolved);
        }
      }
      setMessage(null);
    } catch (error) {
      setServicesDisabled(error instanceof LocationUnavailableError && error.reason === 'services_disabled');
      setMessage(error instanceof LocationUnavailableError
        ? error.message
        : 'We could not access your location. Check the app location permission and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <View className={`flex-1 items-center bg-surfaceMuted px-xl ${compact ? 'pt-16' : 'pt-36'}`}>
    {!compact ? <View className="h-14 w-14 items-center justify-center rounded-full bg-primarySoft"><Text variant="h2" color="primary">◎</Text></View> : null}
    <Text variant="bodyMedium" className="mt-md text-center">{locating || busy ? 'Finding your location…' : 'Your location is unavailable'}</Text>
    {message || !compact ? <Text variant="caption" color="textMuted" className="mt-xs text-center">
      {message ?? 'Allow location to center the map on your position.'}
    </Text> : null}
    {!locating ? <View className={compact ? 'mt-sm' : 'mt-md'}><Button label="Use my location" loading={busy} onPress={() => void locate()} /></View> : null}
    {servicesDisabled && Platform.OS !== 'web' ? <View className="mt-sm"><Button label="Open location settings" onPress={() => void openDeviceLocationSettings().catch(() => setMessage('Open your device settings and turn on location.'))} /></View> : null}
  </View>;
}
