import { AppMessage } from '@/components/common/AppMessage';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, DriverOnlineControl, type AppMapMarker } from '@/components/map';
import { HomeLocationFallback } from '@/components/map/HomeLocationFallback';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { DriverServicePreferences } from '@/components/common/DriverServiceSettings';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { useWalletStore } from '@/store/walletStore';
import { formatNaira, getEarningsSummary, type EarningsSummary } from '@/services/paymentService';

export function DriverDashboardScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.session?.user);
  const setRole = useAuthStore(state => state.setRole);
  const driverApplication = useAuthStore(state => state.driverApplication);
  const services = useAuthStore(state => state.driverServices);
  const current = useMapStore(state => state.currentLocation);
  const wallet = useWalletStore();
  const refreshWallet = useWalletStore(state => state.refresh);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const request = useRef({ generation: 0 });
  const switchingInFlight = useRef(false);
  const approved = driverApplication?.status === 'approved';
  const refresh = useCallback(() => {
    const generation = ++request.current.generation;
    setEarningsLoading(true);
    void refreshWallet();
    void getEarningsSummary('today').then(value => {
      if (generation === request.current.generation) { setEarnings(value); setEarningsError(null); }
    }, () => {
      if (generation === request.current.generation) setEarningsError('Could not refresh today’s earnings.');
    }).finally(() => { if (generation === request.current.generation) setEarningsLoading(false); });
  }, [refreshWallet]);
  useFocusEffect(useCallback(() => {
    if (!user?.id || !approved) return;
    refresh();
    const control = request.current;
    const listener = AppState.addEventListener('change', state => { if (state === 'active') { setEarningsLoading(true); refresh(); } });
    return () => { control.generation++; listener.remove(); };
  }, [approved, refresh, user?.id]));

  if (!user) return null;
  if (!approved) return <Redirect href={driverApplication?.status === 'pending' || driverApplication?.status === 'rejected' ? '/driver-status' : '/driver-onboarding'} />;
  const markers: AppMapMarker[] = current ? [{ ...current, id: 'driver-me', kind: 'driver', title: 'Your location' }] : [];
  const region = current ? { ...current, latitudeDelta: 0.025, longitudeDelta: 0.025 } : null;
  const deliveryOnly = services?.vehicleCategory === 'motorcycle' || (services?.services.courier.status === 'approved' && services.services.ride.status !== 'approved');
  const switchMode = async () => {
    if (switchingInFlight.current) return;
    switchingInFlight.current = true;
    setSwitching(true);
    setSwitchError(null);
    try { if (await setRole('rider')) router.replace('/home'); }
    catch { setSwitchError('Could not switch modes. Please try again.'); }
    finally { switchingInFlight.current = false; setSwitching(false); }
  };
  return <DriverOnlineControl driverId={user.id} render={(onlineControl) => <DriverDashboardView
    title={deliveryOnly ? 'Delivery home' : 'Driver home'} locationAvailable={Boolean(region)} onlineControl={onlineControl}
    map={region ? <AppMap region={region} markers={markers} mapPadding={{ top: 70, right: 24, bottom: 130, left: 24 }} /> : <HomeLocationFallback compact contained />}
    earnings={earnings} earningsLoading={earningsLoading} earningsError={earningsError} owedKobo={wallet.owedKobo} debtBlocked={!wallet.canGoOnline} walletError={wallet.error} walletLoading={wallet.loading}
    services={<DriverServicePreferences compact />} switching={switching} switchError={switchError} onRetry={() => { setEarningsLoading(true); refresh(); }}
    onMenu={() => router.push('/menu')} onWallet={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-wallet' } })}
    onEarnings={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-earnings' } })}
    onTrips={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-trips' } })}
    onSwitch={() => void switchMode()} />} />;
}

interface DriverDashboardViewProps {
  title: string; locationAvailable: boolean; map: ReactNode; onlineControl: ReactNode; services: ReactNode;
  earnings: EarningsSummary | null; earningsLoading: boolean; earningsError: string | null;
  owedKobo: number; debtBlocked: boolean; walletError: string | null; walletLoading: boolean;
  switching: boolean; switchError: string | null;
  onMenu: () => void; onWallet: () => void; onEarnings: () => void; onTrips: () => void; onRetry: () => void; onSwitch: () => void;
}

export function DriverDashboardView({ title, locationAvailable, map, onlineControl, services, earnings, earningsLoading, earningsError, owedKobo, debtBlocked, walletError, walletLoading, switching, switchError, onMenu, onWallet, onEarnings, onTrips, onRetry, onSwitch }: DriverDashboardViewProps) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mapHeight = Math.min(560, Math.max(locationAvailable ? 260 : 340, height * 0.54));
  return <View style={[styles.screen, { backgroundColor: colors.surfaceMuted }]}>
    <View style={{ height: mapHeight }}>
      {locationAvailable ? <View style={StyleSheet.absoluteFill}>{map}</View> : <ScrollView style={[styles.fallback, { top: insets.top + 60 }]} contentContainerStyle={styles.fallbackContent}>{map}</ScrollView>}
      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none"><View style={styles.topRow} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onMenu} style={[styles.roundButton, { backgroundColor: colors.surface, borderColor: colors.border }]}><RideIcon name="menu" size={20} /></Pressable>
        <View style={[styles.titlePill, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text variant="button" accessibilityRole="header">{title}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open driver wallet" onPress={onWallet} style={[styles.roundButton, { backgroundColor: colors.surface, borderColor: colors.border }]}><RideIcon name="wallet" size={20} /></Pressable>
      </View></SafeAreaView>
      <ScrollView style={[styles.availability, { maxHeight: Math.max(100, mapHeight - insets.top - 96) }]} showsVerticalScrollIndicator={false}>{onlineControl}</ScrollView>
    </View>
    <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
      <View style={styles.handleArea}><View style={[styles.handle, { backgroundColor: colors.borderStrong }]} /></View>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View pointerEvents="none" style={[styles.summaryAccent, { backgroundColor: colors.primary }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="View earnings" accessibilityState={{ busy: earningsLoading }} onPress={onEarnings} style={[styles.summaryItem, styles.earningsItem]}>
            <RideIcon name="coins" size={18} color="primary" />
            <View style={styles.summaryCopy}><Text variant="caption" color="textMuted" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.9}>Today’s earnings</Text>
              {earnings ? <Text variant="bodyMedium" color="success" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{formatNaira(earnings.netKobo)}</Text> : earningsLoading ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.primary} /><Text variant="caption" color="textMuted">Loading…</Text></View> : <Text variant="bodyMedium">—</Text>}
            </View>
            <RideIcon name="chevron" size={13} color="textMuted" />
          </Pressable>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="View trip history" accessibilityState={{ busy: earningsLoading }} onPress={onTrips} style={[styles.summaryItem, styles.tripsItem]}>
            <RideIcon name="distance" size={18} color="primary" />
            <View style={styles.summaryCopy}><Text variant="caption" color="textMuted" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.9}>Trips today</Text><Text variant="bodyMedium">{earnings ? earnings.trips : '—'}</Text></View>
            <RideIcon name="chevron" size={13} color="textMuted" />
          </Pressable>
        </View>
        {earningsError ? <View style={styles.error}><AppMessage message={earningsError + (earnings ? ' Showing last loaded earnings.' : '')} /><Button label="Retry earnings" accessibilityLabel="Retry earnings" size="sm" variant="ghost" loading={earningsLoading} onPress={onRetry} /></View> : null}
        {debtBlocked ? <Pressable accessibilityRole="button" accessibilityLabel="Review commission limit in driver wallet" onPress={onWallet} style={[styles.debt, { backgroundColor: colors.dangerSoft }]}><RideIcon name="info" size={18} color="danger" /><View style={styles.copy}><Text variant="button" color="danger">Review wallet to go online</Text><Text variant="caption" color="textMuted">{formatNaira(owedKobo)} commission outstanding</Text></View><RideIcon name="chevron" size={16} color="danger" /></Pressable> : null}
        {walletError ? <View style={styles.error}><AppMessage message="Could not refresh wallet status. Any balance shown is the last loaded value." /><Button label="Retry wallet status" accessibilityLabel="Retry wallet status" variant="ghost" size="sm" loading={walletLoading} onPress={onRetry} /></View> : null}
        {services}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={[styles.footer, { borderTopColor: colors.border }]}><Button label="Switch to rider mode" accessibilityLabel="Switch to rider mode" variant="ghost" size="sm" fullWidth loading={switching} leftIcon={<RideIcon name="swap" size={16} color="primary" />} onPress={onSwitch} />{switchError ? <AppMessage message={switchError} style={styles.smallGap} /> : null}</SafeAreaView>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: spacing.lg, right: spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm },
  roundButton: { width: 44, height: 44, borderRadius: radius.full, borderWidth: borderWidths.divider, alignItems: 'center', justifyContent: 'center' },
  titlePill: { borderRadius: radius.full, paddingHorizontal: spacing.lg, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: borderWidths.divider },
  availability: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing['2xl'] },
  fallback: { position: 'absolute', left: 0, right: 0, bottom: 130 },
  fallbackContent: { flexGrow: 1 },
  sheet: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: radius.full },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  summaryBar: { flexDirection: 'row', minHeight: 68, borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: spacing.xs },
  summaryAccent: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 3 },
  summaryItem: { minWidth: 0, minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 10 },
  earningsItem: { flex: 1.5, paddingLeft: 14 }, tripsItem: { flex: 1 },
  summaryDivider: { width: 1, marginVertical: spacing.md },
  summaryCopy: { flex: 1, minWidth: 0, gap: 2 },
  loading: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  smallGap: { marginTop: spacing.xs },
  error: { marginTop: spacing.sm },
  debt: { padding: spacing.md, marginTop: spacing.md, borderRadius: radius.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: borderWidths.divider },
});
