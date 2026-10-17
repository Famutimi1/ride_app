import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { Text } from '@/components/common';
import {
  areLocationServicesEnabled, getDriverBackgroundLocationPermission, getForegroundLocationPermission,
  isDriverBackgroundUpdatesActive, markDriverOffline, openDeviceLocationSettings, openLocationSettings,
  requestDriverBackgroundLocation, requestEnableLocationServices, requestForegroundLocation,
  startDriverBackgroundUpdates, startDriverLocationUpdates, stopDriverBackgroundUpdates,
} from '@/services/locationService';

export function DriverOnlineControl({ driverId }: { driverId: string }) {
  const services=useAuthStore(state=>state.driverServices);
  const available=Boolean(services&&(services.services.ride.enabled||services.services.courier.enabled));
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stopForeground = useRef<null | (() => void)>(null);

  useEffect(() => {
    let disposed = false;
    const restoreOnlineSession = async () => {
      try {
        if (!await isDriverBackgroundUpdatesActive(driverId)) return;
        const stop = await startDriverLocationUpdates(driverId, undefined, setMessage);
        if (disposed) stop();
        else {
          stopForeground.current = stop;
          setOnline(true);
          setMessage(null);
        }
      } catch {
        if (!disposed) {
          setOnline(false);
          setMessage('Your previous online session expired. Tap Go online to reconnect.');
        }
      }
    };
    void restoreOnlineSession();
    return () => {
      disposed = true;
      stopForeground.current?.();
      stopForeground.current = null;
    };
  }, [driverId]);

  const permissionSettingsMessage = Platform.OS === 'web'
    ? 'Allow location for this site in your browser settings, then tap Go online again.'
    : Platform.OS === 'ios'
      ? 'In Settings, open Rakky Ride > Location, choose Always, and enable Precise Location. Then return and tap Go online.'
      : 'In Rakky Ride app settings, open Permissions > Location and choose Allow all the time. Then return and tap Go online.';

  const directToLocationPermission = async () => {
    if (Platform.OS === 'web') {
      setMessage(permissionSettingsMessage);
      return;
    }
    setMessage(permissionSettingsMessage);
    try {
      await openLocationSettings();
    } catch {
      setMessage(`Could not open Settings automatically. ${permissionSettingsMessage}`);
    }
  };

  const startSharingLocation = async () => {
    try {
      stopForeground.current = await startDriverLocationUpdates(driverId, undefined, setMessage);
      await startDriverBackgroundUpdates(driverId);
      setOnline(true);
      setMessage(null);
    } catch (error) {
      stopForeground.current?.();
      stopForeground.current = null;
      await stopDriverBackgroundUpdates().catch(() => undefined);
      const rawReason = error instanceof Error ? error.message : 'Location sharing could not start.';
      const reason = rawReason === 'driver_not_approved'
        ? 'Your driver application must be approved before you can go online.'
        : rawReason === 'cash_debt_limit_reached'
          ? 'Settle your cash commission balance before going online.'
          : rawReason;
      const foreground = await getForegroundLocationPermission();
      if (foreground !== 'granted') {
        await directToLocationPermission();
        return;
      }
      if (Platform.OS !== 'web' && await getDriverBackgroundLocationPermission() !== 'granted') {
        await directToLocationPermission();
        return;
      }
      setMessage(`Could not go online. ${reason}`);
    }
  };

  const beginGoingOnline = async () => {
    if(!available){setMessage('Enable an approved service on your dashboard before going online.');return;}
    if (!await areLocationServicesEnabled()) {
      if (Platform.OS === 'android' && await requestEnableLocationServices()) {
        // Continue with the permission request after Android enables location.
      } else {
        setMessage('Turn on your phone location service, then tap Go online again.');
        try {
          await openDeviceLocationSettings();
        } catch {
          setMessage('Could not open Location settings automatically. Turn on your phone location service, then tap Go online again.');
        }
        return;
      }
    }

    setMessage('Rakky Ride needs your location while you are online to receive the ride or delivery requests you selected.');
    const foreground = await requestForegroundLocation();
    if (foreground !== 'granted') {
      await directToLocationPermission();
      return;
    }

    if (Platform.OS !== 'web') {
      const background = await getDriverBackgroundLocationPermission();
      if (background !== 'granted') {
        const requested = await requestDriverBackgroundLocation();
        if (requested !== 'granted') {
          await directToLocationPermission();
          return;
        }
      }
    }

    await startSharingLocation();
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (online) {
        await markDriverOffline();
        stopForeground.current?.();
        stopForeground.current = null;
        await stopDriverBackgroundUpdates();
        setOnline(false);
        setMessage(null);
        return;
      }
      await beginGoingOnline();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Please try again.';
      setMessage(`Could not update driver mode. ${reason}`);
    } finally {
      setBusy(false);
    }
  };

  return <View className="absolute left-lg right-lg top-[24%] rounded-xl bg-surface p-md shadow-md">
    <View className="flex-row items-center justify-between"><View><Text variant="bodyMedium">Driver mode</Text><Text variant="caption" color={online ? 'success' : 'textMuted'}>{online ? available?'Online · sharing live location':'No new requests enabled' : 'Offline'}</Text></View>
      <Pressable disabled={busy} onPress={() => void toggle()} className={`rounded-full px-lg py-sm ${online ? 'bg-danger' : 'bg-success'} ${busy ? 'opacity-60' : ''}`}><Text variant="button" color="textInverse">{busy ? 'Please wait…' : online ? 'Go offline' : 'Go online'}</Text></Pressable>
    </View>
    {message ? <Text variant="caption" color="textMuted" className="mt-sm">{message}</Text> : null}
  </View>;
}
