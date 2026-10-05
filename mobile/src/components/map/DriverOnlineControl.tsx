import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@/components/common';
import {
  areLocationServicesEnabled, getDriverBackgroundLocationPermission,
  isDriverBackgroundUpdatesActive, markDriverOffline, openLocationSettings,
  requestDriverBackgroundLocation, requestEnableLocationServices, requestForegroundLocation,
  startDriverBackgroundUpdates, startDriverLocationUpdates, stopDriverBackgroundUpdates,
} from '@/services/locationService';

type RecoveryAction = 'background-permission' | 'enable-services' | 'open-settings' | null;

export function DriverOnlineControl({ driverId }: { driverId: string }) {
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>(null);
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

  const permissionSettingsMessage = Platform.OS === 'ios'
    ? 'In Settings, choose Location, select Always, and turn on Precise Location. Then return and tap Go online.'
    : 'In App settings, open Permissions > Location and select Allow all the time. Then return and tap Go online.';

  const startSharingLocation = async () => {
    try {
      stopForeground.current = await startDriverLocationUpdates(driverId, undefined, setMessage);
      await startDriverBackgroundUpdates(driverId);
      setOnline(true);
      setRecoveryAction(null);
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
      setMessage(`Could not go online. ${reason}`);
      const settingsCanHelp = ![
        'driver_not_approved',
        'cash_debt_limit_reached',
        'The server could not be reached. Check your connection and try again.',
      ].includes(rawReason);
      setRecoveryAction(settingsCanHelp ? 'open-settings' : null);
    }
  };

  const beginGoingOnline = async () => {
    if (!await areLocationServicesEnabled()) {
      setMessage('Your phone location service is turned off. Turn it on to receive nearby trip requests.');
      setRecoveryAction('enable-services');
      return;
    }

    setMessage('Rakky Ride needs your location while you are online so nearby riders can find you.');
    const foreground = await requestForegroundLocation();
    if (foreground !== 'granted') {
      setMessage(`Location permission is disabled. ${permissionSettingsMessage}`);
      setRecoveryAction('open-settings');
      return;
    }

    if (Platform.OS !== 'web') {
      const background = await getDriverBackgroundLocationPermission();
      if (background !== 'granted') {
        setMessage(Platform.OS === 'android'
          ? 'To stay online when Rakky Ride is in the background, tap Continue and choose Allow all the time.'
          : 'To stay online when Rakky Ride is in the background, tap Continue and allow Always location access.');
        setRecoveryAction('background-permission');
        return;
      }
    }

    await startSharingLocation();
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setRecoveryAction(null);
    try {
      if (online) {
        stopForeground.current?.();
        stopForeground.current = null;
        await stopDriverBackgroundUpdates();
        markDriverOffline();
        setOnline(false);
        setMessage(null);
        return;
      }
      await beginGoingOnline();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Please try again.';
      setMessage(`Could not update driver mode. ${reason}`);
      setRecoveryAction('open-settings');
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    if (busy || !recoveryAction) return;
    setBusy(true);
    try {
      if (recoveryAction === 'open-settings') {
        await openLocationSettings();
        setMessage(permissionSettingsMessage);
        return;
      }
      if (recoveryAction === 'enable-services') {
        if (Platform.OS === 'ios') {
          await openLocationSettings();
          setMessage('Turn on Location Services and allow Rakky Ride to use your location. Then return and tap Go online.');
          setRecoveryAction('open-settings');
          return;
        }
        const enabled = await requestEnableLocationServices();
        if (!enabled) {
          setMessage('Location is still turned off. Enable it in your phone settings, then return and tap Go online.');
          return;
        }
        setRecoveryAction(null);
        await beginGoingOnline();
        return;
      }

      const background = await requestDriverBackgroundLocation();
      if (background !== 'granted') {
        setMessage(`Background location was not enabled. ${permissionSettingsMessage}`);
        setRecoveryAction('open-settings');
        return;
      }
      await startSharingLocation();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Please try again.';
      setMessage(`Could not enable location. ${reason}`);
      setRecoveryAction('open-settings');
    } finally {
      setBusy(false);
    }
  };

  const recoveryLabel = recoveryAction === 'background-permission'
    ? 'Continue to permission'
    : recoveryAction === 'enable-services'
      ? Platform.OS === 'android' ? 'Turn on location' : 'Open location settings'
      : 'Open app settings';

  return <View className="absolute left-lg right-lg top-[24%] rounded-xl bg-surface p-md shadow-md">
    <View className="flex-row items-center justify-between"><View><Text variant="bodyMedium">Driver mode</Text><Text variant="caption" color={online ? 'success' : 'textMuted'}>{online ? 'Online · sharing live location' : 'Offline'}</Text></View>
      <Pressable disabled={busy} onPress={() => void toggle()} className={`rounded-full px-lg py-sm ${online ? 'bg-danger' : 'bg-success'} ${busy ? 'opacity-60' : ''}`}><Text variant="button" color="textInverse">{busy ? 'Please wait…' : online ? 'Go offline' : 'Go online'}</Text></Pressable>
    </View>
    {message ? <Text variant="caption" color="textMuted" className="mt-sm">{message}</Text> : null}
    {recoveryAction ? <Pressable disabled={busy} onPress={() => void recover()} className="mt-sm self-start rounded-full border border-border px-md py-xs">
      <Text variant="caption" color="primary">{recoveryLabel}</Text>
    </Pressable> : null}
  </View>;
}
