import { AppMessage } from '@/components/common/AppMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import type { SettingsRole } from '@/constants/settings';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { areLocationServicesEnabled, getDriverBackgroundLocationPermission, getForegroundLocationPermission, type AppPermissionState } from '@/services/locationService';
import { permissionLabel, settingsLocationNotice } from '@/utils/settings';

interface Snapshot { foreground: AppPermissionState; background: AppPermissionState | null; servicesEnabled: boolean }

export function LocationPermissionsPanel({ role }: { role: SettingsRole }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(Platform.OS !== 'web');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const request = useRef(0);
  const openingInFlight = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') return;
    const key = ++request.current;
    try {
      const [foreground, background, servicesEnabled] = await Promise.all([
        getForegroundLocationPermission(), role === 'driver' ? getDriverBackgroundLocationPermission() : Promise.resolve(null), areLocationServicesEnabled(),
      ]);
      if (mounted.current && key === request.current) { setSnapshot({ foreground, background, servicesEnabled }); setError(null); }
    } catch {
      if (mounted.current && key === request.current) {
        setSnapshot(null);
        setError('Could not read location permissions. Check device settings or try again.');
      }
    }
    finally { if (mounted.current && key === request.current) setLoading(false); }
  }, [role]);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current) return refresh(); return undefined; });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && Platform.OS !== 'web') { setLoading(true); void refresh(); } });
    return () => { mounted.current = false; request.current += 1; subscription.remove(); };
  }, [refresh]);
  const openSettings = async () => {
    if (openingInFlight.current || Platform.OS === 'web' || !mounted.current) return;
    openingInFlight.current = true; setOpening(true);
    try { await Linking.openSettings(); }
    catch { if (mounted.current) setError('Open device settings, select Rakky Ride, then Permissions or Location.'); }
    finally { openingInFlight.current = false; if (mounted.current) setOpening(false); }
  };
  return <LocationPermissionsView role={role} snapshot={snapshot} loading={loading} error={error} opening={opening} web={Platform.OS === 'web'} onRefresh={() => { if (Platform.OS !== 'web') { setLoading(true); void refresh(); } }} onSettings={() => void openSettings()} />;
}

export function LocationPermissionsView({ role, snapshot, loading, error, opening, web, onRefresh, onSettings }: {
  role: SettingsRole; snapshot: Snapshot | null; loading: boolean; error: string | null; opening: boolean; web: boolean; onRefresh: () => void; onSettings: () => void;
}) {
  const { colors } = useTheme();
  if (web) return <View style={[styles.notice, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="location" size={20} color="primary" /><Text variant="button">Browser location</Text><Text variant="caption" color="textMuted">{settingsLocationNotice(role)}</Text></View>;
  return <View style={styles.content}>
    <Text variant="caption" color="textMuted">{role === 'driver' ? 'Location supports nearby requests, pickups and trip tracking. Manage access in your device settings.' : 'Location helps find your pickup. You can also enter an address manually.'}</Text>
    {loading ? <View style={styles.status}><ActivityIndicator color={colors.primary} size="small" /><Text variant="caption" color="textMuted">Checking permissions…</Text></View> : null}
    {snapshot ? <View style={[styles.group, { borderColor: colors.border }]}>
      <PermissionStatus label="Device location services" value={snapshot.servicesEnabled ? 'On' : 'Off'} allowed={snapshot.servicesEnabled} />
      <PermissionStatus label="Location while using the app" value={permissionLabel(snapshot.foreground)} allowed={snapshot.foreground === 'granted'} />
      {role === 'driver' ? <PermissionStatus label="Background location" value={permissionLabel(snapshot.background)} allowed={snapshot.background === 'granted'} /> : null}
    </View> : null}
    {error ? <AppMessage message={error} /> : null}
    {role === 'driver' ? <Text variant="caption" color="textMuted">Use Go online on Driver home to control your availability.</Text> : null}
    <Button label="Open device settings" size="sm" fullWidth loading={opening} onPress={onSettings} />
    <Button label="Refresh permissions" variant="outline" size="sm" fullWidth loading={loading} disabled={opening} onPress={onRefresh} />
  </View>;
}

function PermissionStatus({ label, value, allowed }: { label: string; value: string; allowed: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.permission, { borderBottomColor: colors.border }]}><Text variant="caption" style={styles.copy}>{label}</Text><Text variant="caption" color={allowed ? 'success' : 'textMuted'} style={styles.value}>{value}</Text></View>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.md }, notice: { padding: spacing.md, borderRadius: radius.xl, gap: spacing.md }, status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  group: { borderWidth: borderWidths.divider, borderRadius: radius.xl, overflow: 'hidden' }, permission: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: borderWidths.divider },
  copy: { flexGrow: 1, flexShrink: 1 }, value: { flexShrink: 1 },
});
