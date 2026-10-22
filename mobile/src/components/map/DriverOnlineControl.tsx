import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { Button, Text } from '@/components/common';
import { radius, spacing, useTheme } from '@/constants/theme';
import { driverServiceEnabled, driverVehicleNeedsReview } from '@/utils/driverServices';
import {
  areLocationServicesEnabled, getDriverBackgroundLocationPermission, getForegroundLocationPermission,
  isDriverBackgroundUpdatesActive, markDriverOffline, openDeviceLocationSettings, openLocationSettings,
  requestDriverBackgroundLocation, requestEnableLocationServices, requestForegroundLocation,
  startDriverBackgroundUpdates, startDriverLocationUpdates, stopDriverBackgroundUpdates,
} from '@/services/locationService';

interface DriverOnlineControlProps { driverId: string; render?: (control: ReactNode, online: boolean) => ReactNode }

export function DriverOnlineControl(props: DriverOnlineControlProps) {
  const allowed = useAuthStore(state => state.session?.user.id === props.driverId && state.session.user.role === 'driver' && state.driverApplication?.status === 'approved');
  if (!allowed) return null;
  return <DriverOnlineController key={props.driverId} {...props} />;
}

function DriverOnlineController({ driverId, render }: DriverOnlineControlProps) {
  const services=useAuthStore(state=>state.driverServices);
  const available=Boolean(services&&(driverServiceEnabled(services,'ride')||driverServiceEnabled(services,'courier')));
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stopForeground = useRef<null | (() => void)>(null);
  const toggling = useRef(false);
  const mounted = useRef(true);
  const isCurrent = useCallback(() => {
    const state = useAuthStore.getState();
    return mounted.current && state.session?.user.id === driverId && state.session.user.role === 'driver' && state.driverApplication?.status === 'approved';
  }, [driverId]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const restoreOnlineSession = async () => {
      try {
        if (!await isDriverBackgroundUpdatesActive(driverId)) return;
        if (!isCurrent()) return;
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
      mounted.current = false;
      stopForeground.current?.();
      stopForeground.current = null;
    };
  }, [driverId, isCurrent]);

  const permissionSettingsMessage = Platform.OS === 'web'
    ? 'Allow location for this site in your browser settings, then tap Go online again.'
    : Platform.OS === 'ios'
      ? 'In Settings, open Rakky Ride > Location, choose Always, and enable Precise Location. Then return and tap Go online.'
      : 'In Rakky Ride app settings, open Permissions > Location and choose Allow all the time. Then return and tap Go online.';

  const directToLocationPermission = async () => {
    if (!isCurrent()) return;
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
    if (!isCurrent()) return;
    try {
      const release = await startDriverLocationUpdates(driverId, undefined, setMessage);
      if (!isCurrent()) { release(); return; }
      stopForeground.current = release;
      await startDriverBackgroundUpdates(driverId);
      if (!isCurrent()) return;
      setOnline(true);
      setMessage(null);
    } catch (error) {
      if (!isCurrent()) return;
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
    if (!isCurrent()) return;
    const current = useAuthStore.getState().driverServices;
    if(!current || (!driverServiceEnabled(current,'ride') && !driverServiceEnabled(current,'courier'))){setMessage(current && driverVehicleNeedsReview(current) ? 'Contact support to review your vehicle type before going online.' : 'Enable an approved service on your dashboard before going online.');return;}
    const servicesEnabled = await areLocationServicesEnabled();
    if (!isCurrent()) return;
    if (!servicesEnabled) {
      const enabled = Platform.OS === 'android' && await requestEnableLocationServices();
      if (!isCurrent()) return;
      if (enabled) {
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

    if (!isCurrent()) return;
    setMessage('Rakky Ride needs your location while you are online to receive the ride or delivery requests you selected.');
    const foreground = await requestForegroundLocation();
    if (!isCurrent()) return;
    if (foreground !== 'granted') {
      await directToLocationPermission();
      return;
    }

    if (Platform.OS !== 'web') {
      const background = await getDriverBackgroundLocationPermission();
      if (!isCurrent()) return;
      if (background !== 'granted') {
        const requested = await requestDriverBackgroundLocation();
        if (!isCurrent()) return;
        if (requested !== 'granted') {
          await directToLocationPermission();
          return;
        }
      }
    }

    await startSharingLocation();
  };

  const toggle = async () => {
    if (toggling.current || !isCurrent()) return;
    toggling.current = true;
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
      toggling.current = false;
      setBusy(false);
    }
  };

  const control = <DriverOnlineControlView online={online} available={available} busy={busy} message={message} onToggle={() => void toggle()} />;
  if (render) return render(control, online);
  return <View className="absolute left-lg right-lg top-[24%]">{control}</View>;
}

export function DriverOnlineControlView({ online, available, busy, message, onToggle }: { online: boolean; available: boolean; busy: boolean; message: string | null; onToggle: () => void }) {
  const { colors } = useTheme();
  const title = online ? available ? "You're online" : 'Requests paused' : "You're offline";
  const detail = online ? available ? 'Live location sharing is on.' : 'Enable a service for new requests.' : 'Go online for nearby requests.';
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.row}>
      <View style={styles.copy}><View style={styles.status}><View style={[styles.dot, { backgroundColor: online ? colors.success : colors.textMuted }]} /><Text variant="button" style={styles.title}>{title}</Text></View><Text variant="caption" color="textMuted" style={styles.detail}>{detail}</Text></View>
      <Button label={online ? 'Go offline' : 'Go online'} accessibilityLabel={online ? 'Go offline' : 'Go online'} variant={online ? 'destructive' : 'primary'} size="sm" loading={busy} onPress={onToggle} />
    </View>
    {message ? <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  title: { flexShrink: 1 },
  detail: { marginTop: spacing.xs },
  message: { marginTop: spacing.sm },
});
