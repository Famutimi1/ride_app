import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, DriverOnlineControl, type AppMapMarker } from '@/components/map';
import { HomeLocationFallback } from '@/components/map/HomeLocationFallback';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { DriverServicePreferences } from '@/components/common/DriverServiceSettings';
import { radius, spacing, useTheme } from '@/constants/theme';
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
    void refreshWallet();
    void getEarningsSummary('today').then(value => {
      if (generation === request.current.generation) { setEarnings(value); setEarningsError(null); }
    }, () => {
      if (generation === request.current.generation) setEarningsError('Could not refresh today’s earnings.');
    }).finally(() => { if (generation === request.current.generation) setEarningsLoading(false); });
  }, [refreshWallet]);
  useEffect(() => {
    if (!user?.id || !approved) return;
    refresh();
    const control = request.current;
    const listener = AppState.addEventListener('change', state => { if (state === 'active') { setEarningsLoading(true); refresh(); } });
    return () => { control.generation++; listener.remove(); };
  }, [approved, refresh, user?.id]);

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
  return <DriverOnlineControl driverId={user.id} render={(onlineControl, online) => <DriverDashboardView
    title={deliveryOnly ? 'Delivery home' : 'Driver home'} locationAvailable={Boolean(region)} online={online} onlineControl={onlineControl}
    map={region ? <AppMap region={region} markers={markers} mapPadding={{ top: 70, right: 24, bottom: 130, left: 24 }} /> : <HomeLocationFallback compact contained />}
    earnings={earnings} earningsLoading={earningsLoading} earningsError={earningsError} owedKobo={wallet.owedKobo} debtBlocked={!wallet.canGoOnline} walletError={wallet.error} walletLoading={wallet.loading}
    services={<DriverServicePreferences compact />} switching={switching} switchError={switchError} onRetry={() => { setEarningsLoading(true); refresh(); }}
    onMenu={() => router.push('/menu')} onWallet={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-wallet' } })}
    onEarnings={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-earnings' } })}
    onSettleDebt={() => router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'earnings' } })}
    onSwitch={() => void switchMode()} />} />;
}

interface DriverDashboardViewProps {
  title: string; locationAvailable: boolean; map: ReactNode; online: boolean; onlineControl: ReactNode; services: ReactNode;
  earnings: EarningsSummary | null; earningsLoading: boolean; earningsError: string | null;
  owedKobo: number; debtBlocked: boolean; walletError: string | null; walletLoading: boolean;
  switching: boolean; switchError: string | null;
  onMenu: () => void; onWallet: () => void; onEarnings: () => void; onSettleDebt: () => void; onRetry: () => void; onSwitch: () => void;
}

export function DriverDashboardView({ title, locationAvailable, map, online, onlineControl, services, earnings, earningsLoading, earningsError, owedKobo, debtBlocked, walletError, walletLoading, switching, switchError, onMenu, onWallet, onEarnings, onSettleDebt, onRetry, onSwitch }: DriverDashboardViewProps) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mapHeight = Math.min(420, Math.max(locationAvailable ? 220 : 340, height * 0.40));
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
        <View style={styles.earningsRow}><View style={styles.earningsCopy}><Text variant="caption" color="textMuted">Today’s earnings</Text>
          {earnings ? <Text variant="h3">{formatNaira(earnings.netKobo)}</Text> : earningsLoading ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.primary} /><Text variant="caption" color="textMuted">Loading…</Text></View> : <Text variant="h3">—</Text>}
        </View><Pressable accessibilityRole="button" accessibilityLabel="View earnings" onPress={onEarnings} style={styles.textAction}><Text variant="caption" color="primary">View earnings</Text><RideIcon name="chevron" size={16} color="primary" /></Pressable></View>
        {earningsError ? <View style={styles.error}><Text variant="caption" color="danger" accessibilityRole="alert">{earningsError}{earnings ? ' Showing last loaded earnings.' : ''}</Text><Button label="Retry earnings" accessibilityLabel="Retry earnings" size="sm" variant="ghost" loading={earningsLoading} onPress={onRetry} /></View> : null}
        <View style={[styles.stats, { backgroundColor: colors.surfaceMuted }]}><Stat label="Jobs" value={earnings ? String(earnings.trips) : '—'} /><Stat label="Online" value="—" unavailable /><Stat label="Rating" value="—" unavailable last /></View>
        {owedKobo > 0 || debtBlocked ? <View style={[styles.debt, { backgroundColor: colors.dangerSoft }]}><View style={styles.noticeRow}><RideIcon name="cash" size={18} color="danger" /><Text variant="button" color="danger" style={styles.copy}>{debtBlocked ? 'Cash commission limit reached' : 'Cash commission due'}</Text></View><Text variant="caption" style={styles.smallGap}>{owedKobo > 0 ? `You owe ${formatNaira(owedKobo)} in cash commission.` : 'Review your wallet before going online.'}</Text>{debtBlocked ? <Text variant="caption" color="textMuted" style={styles.smallGap}>Settle your balance before going online.</Text> : null}<Button label="Pay now" size="sm" variant="outline" className="mt-sm" onPress={onSettleDebt} /></View> : null}
        {walletError ? <View style={styles.error}><Text variant="caption" color="danger" accessibilityRole="alert">Could not refresh wallet status. Any balance shown is the last loaded value.</Text><Button label="Retry wallet status" accessibilityLabel="Retry wallet status" variant="ghost" size="sm" loading={walletLoading} onPress={onRetry} /></View> : null}
        {services}
        <View style={[styles.work, { backgroundColor: colors.primarySoft }]}><View style={[styles.workIcon, { backgroundColor: colors.surface }]}><RideIcon name="vehicle" size={18} color="primary" /></View><View style={styles.copy}><Text variant="button">{online ? 'Your driver session is online' : 'Ready when you are'}</Text><Text variant="caption" color="textMuted" style={styles.smallGap}>{online ? 'New requests follow your service choices.' : 'Go online to start receiving requests.'}</Text></View></View>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={[styles.footer, { borderTopColor: colors.border }]}><Button label="Switch to rider mode" accessibilityLabel="Switch to rider mode" variant="outline" size="sm" fullWidth loading={switching} leftIcon={<RideIcon name="swap" size={16} color="primary" />} onPress={onSwitch} />{switchError ? <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.smallGap}>{switchError}</Text> : null}</SafeAreaView>
    </View>
  </View>;
}

function Stat({ label, value, unavailable = false, last = false }: { label: string; value: string; unavailable?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return <View accessible accessibilityLabel={`${label}: ${unavailable ? 'not available' : value}`} style={[styles.stat, { borderRightColor: colors.border, borderRightWidth: last ? 0 : StyleSheet.hairlineWidth }]}><Text variant="bodyMedium">{value}</Text><Text variant="caption" color="textMuted">{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: spacing.lg, right: spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm },
  roundButton: { width: 44, height: 44, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  titlePill: { borderRadius: radius.full, paddingHorizontal: spacing.lg, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  availability: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing['2xl'] },
  fallback: { position: 'absolute', left: 0, right: 0, bottom: 130 },
  fallbackContent: { flexGrow: 1 },
  sheet: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: radius.full },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  earningsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  earningsCopy: { flex: 1, minWidth: 0 },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  loading: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stats: { flexDirection: 'row', borderRadius: radius.xl, paddingVertical: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs },
  copy: { flex: 1, minWidth: 0 },
  smallGap: { marginTop: spacing.xs },
  error: { marginTop: spacing.sm },
  debt: { padding: spacing.md, marginTop: spacing.md, borderRadius: radius.xl },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  work: { marginTop: spacing.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.xl },
  workIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
