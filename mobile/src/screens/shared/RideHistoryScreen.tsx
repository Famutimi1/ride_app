import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, useTheme, type AppColors } from '@/constants/theme';
import { formatNaira } from '@/services/paymentService';
import { getTripHistory, type Trip, type TripStatus } from '@/services/tripService';
import { groupHistoryTrips, historyChargeState, historyDate, type HistoryFilter } from '@/utils/tripHistory';
import { HomeIcon } from './HomeIcon';
import { useAuthStore } from '@/store/authStore';
import { driverTripPresentation } from '@/utils/driverTripPresentation';
import { tripBelongsToRole } from '@/utils/roleAccess';

const FILTERS: { id: HistoryFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'completed', label: 'Completed' }, { id: 'not-completed', label: 'Not completed' }];
type HistoryPage = Awaited<ReturnType<typeof getTripHistory>>;
interface HistoryResult extends HistoryPage { key: string; error: string | null; loadingMore: boolean; moreError: string | null }

export function RideHistoryScreen({ driver = false }: { driver?: boolean } = {}) {
  const router = useRouter();
  const userId = useAuthStore(state => state.session?.user.id);
  const role = useAuthStore(state => state.session?.user.role);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const source = filter === 'completed' ? 'completed' : 'all';
  const requestKey = `${userId}:${role}:${driver}:${source}:${revision}`;
  const moreInFlight = useRef<symbol | null>(null);
  const generation = useRef(0);
  const page = result?.key === requestKey ? result : null;
  const modeError = role !== (driver ? 'driver' : 'rider') ? `Switch to ${driver ? 'driver' : 'rider'} mode from the menu to view these trips.` : null;

  useEffect(() => {
    let active = true;
    generation.current += 1;
    moreInFlight.current = null;
    if (modeError) return;
    void getTripHistory(undefined, source === 'completed' ? { status: 'completed' } : undefined).then(data => {
      if (active && useAuthStore.getState().session?.user.id === userId && useAuthStore.getState().session?.user.role === role) setResult({ ...data, trips: data.trips.filter(trip => tripBelongsToRole(trip, userId, driver ? 'driver' : 'rider')), key: requestKey, error: null, loadingMore: false, moreError: null });
    }).catch(() => {
      if (active) setResult({ key: requestKey, trips: [], nextCursor: null, error: `Could not load your ${driver ? 'driver trips' : 'ride history'}.`, loadingMore: false, moreError: null });
    });
    return () => { active = false; generation.current += 1; moreInFlight.current = null; };
  }, [requestKey, source, driver, role, userId, modeError]);

  const loadMore = async () => {
    const cursor = page?.nextCursor;
    if (!cursor || page.loadingMore || moreInFlight.current) return;
    const task = Symbol('older trips');
    const ownerGeneration = generation.current;
    moreInFlight.current = task;
    setResult(current => current?.key === requestKey ? { ...current, loadingMore: true, moreError: null } : current);
    try {
      const data = await getTripHistory(cursor, source === 'completed' ? { status: 'completed' } : undefined);
      if (generation.current !== ownerGeneration || useAuthStore.getState().session?.user.id !== userId || useAuthStore.getState().session?.user.role !== role || moreInFlight.current !== task) return;
      setResult(current => {
        if (!current || current.key !== requestKey || current.nextCursor !== cursor) return current;
        const incoming = data.trips.filter(trip => tripBelongsToRole(trip, userId, driver ? 'driver' : 'rider'));
        const trips = [...new Map([...current.trips, ...incoming].map(trip => [trip.id, trip])).values()];
        return { ...current, trips, nextCursor: data.nextCursor === cursor ? null : data.nextCursor, loadingMore: false };
      });
    } catch {
      if (generation.current === ownerGeneration) setResult(current => current?.key === requestKey ? { ...current, loadingMore: false, moreError: 'Could not load older trips. Please try again.' } : current);
    } finally { if (moreInFlight.current === task) moreInFlight.current = null; }
  };

  return <RideHistoryView driver={driver} onEarnings={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-earnings' } })} filter={filter} onFilter={setFilter} trips={page?.trips ?? []} loading={!page && !modeError} error={modeError ?? page?.error ?? null} retryLabel={modeError ? 'Back to menu' : 'Retry'} hasMore={Boolean(page?.nextCursor)} loadingMore={page?.loadingMore ?? false} moreError={page?.moreError ?? null} onMore={() => void loadMore()} onRetry={() => modeError ? router.replace('/menu') : setRevision(value => value + 1)} onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')} onSchedule={() => router.push('/schedule')} onOpenTrip={id => router.push({ pathname: '/trip-receipt', params: { tripId: id } })} />;
}

interface RideHistoryViewProps {
  driver?: boolean; onEarnings?: () => void; retryLabel?: string;
  filter: HistoryFilter; onFilter: (filter: HistoryFilter) => void;
  trips: Trip[]; loading: boolean; error: string | null;
  hasMore: boolean; loadingMore: boolean; moreError: string | null;
  onMore: () => void; onRetry: () => void; onBack: () => void; onSchedule: () => void; onOpenTrip: (id: string) => void;
}

export function RideHistoryView({ driver = false, onEarnings, retryLabel = 'Retry', filter, onFilter, trips, loading, error, hasMore, loadingMore, moreError, onMore, onRetry, onBack, onSchedule, onOpenTrip }: RideHistoryViewProps) {
  const { colors } = useTheme();
  const sections = loading || error ? [] : groupHistoryTrips(trips, filter);
  const emptyTitle = hasMore ? 'No matching trips loaded' : filter === 'completed' ? 'No completed trips yet' : filter === 'not-completed' ? 'No trips in this filter' : 'No past trips yet';
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable><Text variant="bodyMedium" accessibilityRole="header">{driver ? 'Driver trips' : 'Ride history'}</Text></View>
    <View style={styles.tools}>
      {driver ? <Pressable accessibilityRole="button" accessibilityLabel="View earnings breakdown" onPress={onEarnings} style={[styles.earningsShortcut, { backgroundColor: colors.primarySoft }]}><View style={[styles.calendar, { backgroundColor: colors.surface }]}><RideIcon name="coins" size={18} color="primary" /></View><Text variant="button" style={styles.scheduledCopy}>Earnings breakdown</Text><RideIcon name="chevron" size={16} color="primary" /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="View scheduled rides" onPress={onSchedule} style={[styles.scheduled, { backgroundColor: colors.primarySoft }]}>
        <View style={[styles.calendar, { backgroundColor: colors.surface }]}><HomeIcon name="calendar" size={18} color="primary" /></View>
        <View style={styles.scheduledCopy}><Text variant="button">Scheduled rides</Text><Text variant="caption" color="textMuted">Upcoming bookings</Text></View>
        <Text variant="caption" color="primary">View</Text><RideIcon name="chevron" size={16} color="primary" />
      </Pressable>}
      <View accessibilityRole="tablist" accessibilityLabel="Trip status filters" style={styles.filters}>
        {FILTERS.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: filter === item.id }} aria-selected={filter === item.id} onPress={() => onFilter(item.id)} style={[styles.filter, { backgroundColor: filter === item.id ? colors.primary : colors.surfaceMuted }]}><Text variant="caption" color={filter === item.id ? 'textInverse' : 'text'} style={styles.centered}>{item.label}</Text></Pressable>)}
      </View>
    </View>
    <SectionList<Trip> sections={sections} keyExtractor={trip => trip.id} extraData={filter} stickySectionHeadersEnabled={false} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
      renderSectionHeader={({ section }) => <Text accessibilityRole="header" variant="button" color="textMuted" style={styles.dateHeading}>{section.title}</Text>}
      renderItem={({ item }) => <HistoryCard driver={driver} trip={item} onPress={() => onOpenTrip(item.id)} />}
      ListEmptyComponent={<View style={[styles.empty, { backgroundColor: error ? colors.dangerSoft : colors.surfaceMuted }]}>
        {loading ? <><ActivityIndicator color={colors.primary} /><Text variant="caption" color="textMuted">Loading trips…</Text></> : error ? <><Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text><Button label={retryLabel} size="sm" onPress={onRetry} /></> : <><HomeIcon name="history" size={22} color="icon" /><Text variant="bodyMedium" style={styles.centered}>{emptyTitle}</Text><Text variant="caption" color="textMuted" style={styles.centered}>{hasMore ? 'Load older trips to keep looking.' : filter === 'all' ? 'Your rides and deliveries will appear here.' : 'Choose another filter to see more trips.'}</Text></>}
      </View>}
      ListFooterComponent={!loading && !error && hasMore ? <View style={styles.more}>{moreError ? <Text variant="caption" color="danger" accessibilityRole="alert">{moreError}</Text> : null}{driver ? <Pressable accessibilityRole="button" accessibilityLabel={moreError ? 'Retry loading older trips' : 'Load older trips'} accessibilityState={{ disabled: loadingMore, busy: loadingMore }} disabled={loadingMore} onPress={onMore} style={[styles.olderButton, { borderColor: colors.primary, opacity: loadingMore ? 0.5 : 1 }]}>{loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text variant="button" color="primary">{moreError ? 'Retry loading' : 'Load older trips'}</Text>}</Pressable> : <Button label={moreError ? 'Retry loading' : 'Load older trips'} variant="outline" size="sm" fullWidth loading={loadingMore} onPress={onMore} />}</View> : null}
    />
  </SafeAreaView>;
}

function statusStyle(trip: Trip): { label: string; color: keyof AppColors; background: keyof AppColors } {
  if (trip.status === 'completed') return { label: trip.service_type === 'courier' ? 'Delivered' : 'Completed', color: 'success', background: 'successSoft' };
  if (trip.status === 'returned') return { label: 'Returned', color: 'warning', background: 'warningSoft' };
  if (trip.status === 'cancelled') return { label: 'Cancelled', color: 'danger', background: 'dangerSoft' };
  if (trip.status === 'no_drivers_found') return { label: 'No drivers found', color: 'warning', background: 'warningSoft' };
  const labels: Partial<Record<TripStatus, string>> = { scheduled: 'Scheduled', searching: 'Finding a driver', driver_assigned: 'Driver assigned', driver_arrived: 'Driver arrived', in_progress: 'In progress', returning: 'Returning' };
  return { label: labels[trip.status] ?? 'Trip details', color: 'textMuted', background: 'surfaceMuted' };
}

function HistoryCard({ trip, onPress, driver = false }: { trip: Trip; onPress: () => void; driver?: boolean }) {
  const { colors } = useTheme();
  const status = statusStyle(trip);
  const date = historyDate(trip);
  const time = Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true });
  const receipt = trip.status === 'completed' || trip.status === 'returned';
  const payment = trip.payment_method === 'cash' ? 'Cash' : trip.payment_method === 'wallet' ? 'Wallet' : 'Card';
  const charge = historyChargeState(trip);
  const driverDetails = driverTripPresentation(trip);
  let amount = charge === 'fare' ? formatNaira(trip.fare_kobo) : charge === 'not-charged' ? 'Not charged' : charge === 'held' ? 'Funds held' : 'Payment details';
  if (driver) {
    amount = driverDetails.cancelled ? 'Trip cancelled' : 'Earnings pending';
    if (driverDetails.fulfilled) amount = driverDetails.earnings === null ? 'Unavailable' : formatNaira(driverDetails.earnings);
  }
  const action = receipt ? `${payment} · View receipt` : 'View details';
  return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={`${trip.service_type === 'courier' ? 'Delivery' : 'Ride'}, ${status.label}, ${date.toLocaleString()}, from ${trip.pickup_address} to ${trip.dropoff_address}, ${driver && driverDetails.fulfilled ? 'Your earnings ' : ''}${amount}. ${action}`} onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}>
    <View style={styles.cardHeader}>
      <View style={styles.cardLeading}><View style={[styles.rideIcon, { backgroundColor: colors.primarySoft }]}><RideIcon name={trip.service_type === 'courier' ? 'package' : 'car'} size={trip.service_type === 'courier' ? 18 : 26} color="primary" /></View><View style={styles.timeCopy}><Text variant="button">{time}</Text>{trip.service_type === 'courier' ? <Text variant="caption" color="textMuted">Courier</Text> : null}</View></View>
      <View style={styles.cardTrailing}><View style={[styles.status, { backgroundColor: colors[status.background] }]}><Text variant="caption" color={status.color}>{status.label}</Text></View><RideIcon name="chevron" size={14} color="icon" /></View>
    </View>
    <View style={styles.route}>
      <View style={styles.routeRow}><View style={styles.marker}><AddressIcon name="pickup" size={14} color="icon" /><View style={[styles.connector, { backgroundColor: colors.borderStrong }]} /></View><Text variant="caption" numberOfLines={2} style={styles.address}>{trip.pickup_address}</Text></View>
      <View style={styles.routeRow}><View style={styles.marker}><AddressIcon name="pin" size={14} color="icon" /></View><Text variant="caption" numberOfLines={2} style={styles.address}>{trip.dropoff_address}</Text></View>
    </View>
    <View style={[styles.cardFooter, { borderTopColor: colors.border }]}><View style={styles.footerAction}>{driver && receipt ? <RideIcon name={trip.payment_method} size={14} color="icon" /> : null}<Text variant="caption" color="primary" style={styles.action}>{action}</Text></View>{driver ? <View style={styles.driverAmount}>{driverDetails.fulfilled ? <Text variant="caption" color="textMuted">Your earnings</Text> : null}<Text variant={driverDetails.earnings === null ? 'caption' : 'button'} color={driverDetails.earnings === null ? 'textMuted' : 'success'} style={styles.amount}>{amount}</Text></View> : <Text variant={charge === 'fare' ? 'button' : 'caption'} color={charge === 'held' ? 'warning' : charge === 'fare' ? 'text' : 'textMuted'} style={styles.amount}>{amount}</Text>}</View>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  tools: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 12 },
  earningsShortcut: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  scheduled: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  calendar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, scheduledCopy: { flex: 1, minWidth: 0 },
  filters: { flexDirection: 'row', gap: 8 }, filter: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 8 }, centered: { textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 16 }, dateHeading: { marginTop: 10, marginBottom: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardLeading: { flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexBasis: 100, minWidth: 0 },
  rideIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, timeCopy: { flexShrink: 1 },
  cardTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, maxWidth: '65%' },
  status: { borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 1 },
  route: { marginTop: 12, gap: 8 }, routeRow: { flexDirection: 'row', gap: 8 }, marker: { width: 14, paddingTop: 2, alignSelf: 'stretch' },
  connector: { position: 'absolute', left: 6.5, width: 1, top: 18, bottom: -8 }, address: { flex: 1, minWidth: 0 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTopWidth: borderWidths.divider, marginTop: 12, paddingTop: 8 },
  action: { flexShrink: 1 }, amount: { flexShrink: 1, textAlign: 'right' },
  olderButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  footerAction: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }, driverAmount: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '46%', gap: 2 },
  empty: { borderRadius: 14, padding: 20, alignItems: 'center', gap: 10, marginTop: 12 }, more: { gap: 8, paddingVertical: 12 },
});
