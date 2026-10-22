import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { radius, spacing, useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';
import { cancelTrip, getScheduledTrips, type Trip } from '@/services/tripService';
import { formatScheduledTime, scheduleDays, scheduleSlots, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '@/utils/scheduleTime';

const dateLabel = (time: number) => formatScheduledTime(time, { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = (time: number) => formatScheduledTime(time, { hour: 'numeric', minute: '2-digit', hour12: true });

function tripStatusLabel(trip: Trip): string {
  if (trip.status === 'scheduled') return 'Scheduled · Driver search has not started';
  if (trip.status === 'searching') return 'Looking for a driver';
  if (trip.status === 'no_drivers_found') return 'No driver found';
  if (trip.status === 'cancelled') {
    if (trip.cancel_reason === 'wallet_balance_insufficient') return 'Cancelled · Wallet balance was too low';
    if (trip.cancel_reason === 'wallet_unavailable') return 'Cancelled · Wallet unavailable';
    if (trip.cancel_reason === 'another_trip_active') return 'Cancelled · Another trip was active';
    if (trip.cancel_reason === 'pickup_time_passed') return 'Cancelled · Pickup time passed while service was unavailable';
    return 'Cancelled';
  }
  return 'Driver assigned';
}

/** Keep arrow availability in sync with touch, wheel, and button scrolling. */
function useScheduleScroll(horizontal: boolean, ref: RefObject<ScrollView | null>) {
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });
  const [edges, setEdges] = useState({ before: false, after: false });
  const updateEdges = () => {
    const { offset, viewport, content } = metrics.current;
    setEdges(previous => {
      const before = offset > 1;
      const after = viewport > 0 && offset + viewport < content - 1;
      return previous.before === before && previous.after === after ? previous : { before, after };
    });
  };
  return {
    edges,
    reset: () => { metrics.current.offset = 0; updateEdges(); },
    onLayout: (size: number) => { metrics.current.viewport = size; updateEdges(); },
    onContentSizeChange: (size: number) => { metrics.current.content = size; updateEdges(); },
    onScroll: (offset: number) => { metrics.current.offset = offset; updateEdges(); },
    move: (direction: -1 | 1) => {
      const { offset, viewport, content } = metrics.current;
      const next = Math.max(0, Math.min(content - viewport, offset + direction * viewport));
      ref.current?.scrollTo(horizontal ? { x: next, animated: true } : { y: next, animated: true });
    },
  };
}

function ScrollArrow({ direction, disabled, onPress }: { direction: 'left' | 'right' | 'up' | 'down'; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const label = { left: 'Show earlier dates', right: 'Show later dates', up: 'Show earlier times', down: 'Show later times' }[direction];
  const rotation = { left: '180deg', right: '0deg', up: '-90deg', down: '90deg' }[direction];
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} hitSlop={6} onPress={onPress} style={[styles.scrollArrow, { backgroundColor: disabled ? colors.surfaceMuted : colors.primarySoft, opacity: disabled ? 0.4 : 1 }]}>
    <View style={{ transform: [{ rotate: rotation }] }}><RideIcon name="chevron" size={16} color={disabled ? 'textMuted' : 'primary'} /></View>
  </Pressable>;
}

export function ScheduleRideScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [today] = useState(() => Date.now());
  const days = useMemo(() => scheduleDays(today), [today]);
  const [day, setDay] = useState(days[0]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [upcoming, setUpcoming] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const slots = scheduleSlots(day);
  const dayScrollRef = useRef<ScrollView>(null);
  const timeScrollRef = useRef<ScrollView>(null);
  const dayScroll = useScheduleScroll(true, dayScrollRef);
  const timeScroll = useScheduleScroll(false, timeScrollRef);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setUpcoming(await getScheduledTrips()); setError(null); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void getScheduledTrips()
      .then((trips) => { if (mounted) setUpcoming(trips); })
      .catch((reason: unknown) => { if (mounted) setError(apiErrorMessage(reason)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { const timer = setInterval(() => { void refresh(); }, 30_000); return () => clearInterval(timer); }, [refresh]);

  const continueBooking = () => {
    if (!selectedTime || selectedTime < Date.now() + SCHEDULE_MIN_LEAD_MS || selectedTime > Date.now() + SCHEDULE_MAX_LEAD_MS) {
      setError('Choose a pickup time at least 30 minutes from now and within the next 7 days.');
      return;
    }
    router.push({ pathname: '/set-destination', params: { scheduledAt: new Date(selectedTime).toISOString() } });
  };

  const confirmCancel = async () => {
    if (!cancelId) return;
    setCancelling(true);
    try { await cancelTrip(cancelId, 'Cancelled scheduled ride'); setCancelId(null); await refresh(); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setCancelling(false); }
  };

  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}>
        <AddressIcon name="back" size={19} />
      </Pressable>
      <Text variant="bodyMedium" accessibilityRole="header">Schedule a ride</Text>
    </View>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.intro}>
        <View style={styles.copy}><Text variant="h3">Ride on your time.</Text><Text variant="caption" color="textMuted" style={styles.caption}>Book 30 minutes to 7 days ahead.</Text></View>
        <Image source={require('@/assets/images/home-v2/schedule.png')} contentFit="contain" style={styles.artwork} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}><Text variant="button" accessibilityRole="header">Pickup day</Text><View style={styles.scrollArrows}>
          <ScrollArrow direction="left" disabled={!dayScroll.edges.before} onPress={() => dayScroll.move(-1)} />
          <ScrollArrow direction="right" disabled={!dayScroll.edges.after} onPress={() => dayScroll.move(1)} />
        </View></View>
        <ScrollView ref={dayScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} scrollEventThrottle={16}
          onLayout={event => dayScroll.onLayout(event.nativeEvent.layout.width)}
          onContentSizeChange={width => dayScroll.onContentSizeChange(width)}
          onScroll={event => dayScroll.onScroll(event.nativeEvent.contentOffset.x)}>
          {days.map((value, index) => {
            const selected = day === value;
            const label = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : formatScheduledTime(value, { weekday: 'short' });
            return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${label}, ${dateLabel(value)}`} accessibilityState={{ selected }} onPress={() => { if (value !== day) timeScroll.reset(); setDay(value); setSelectedTime(null); setError(null); }} style={[styles.day, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.surface }]}>
              <Text variant="button" color={selected ? 'textInverse' : 'text'}>{label}</Text>
              <View style={styles.dayDate}><Text variant="caption" color={selected ? 'textInverse' : 'textMuted'}>{formatScheduledTime(value, { day: 'numeric', month: 'short' })}</Text>{selected ? <RideIcon name="check" size={13} color="textInverse" /> : null}</View>
            </Pressable>;
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}><Text variant="button" accessibilityRole="header">Pickup time</Text><View style={styles.inline}><RideIcon name="clock" size={14} color="textMuted" /><Text variant="caption" color="textMuted">WAT · UTC+1</Text></View></View>
        {slots.length ? <>
          <ScrollView key={day} ref={timeScrollRef} nestedScrollEnabled style={styles.timeWindow} showsVerticalScrollIndicator contentContainerStyle={styles.times} accessibilityLabel="Available pickup times" scrollEventThrottle={16}
            onLayout={event => timeScroll.onLayout(event.nativeEvent.layout.height)}
            onContentSizeChange={(_width, height) => timeScroll.onContentSizeChange(height)}
            onScroll={event => timeScroll.onScroll(event.nativeEvent.contentOffset.y)}>
            {slots.map((value) => {
              const selected = selectedTime === value;
              return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Pickup at ${timeLabel(value)}`} accessibilityState={{ selected }} onPress={() => { setSelectedTime(value); setError(null); }} style={[styles.time, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface }]}>
                <Text variant="caption" color={selected ? 'primary' : 'text'}>{timeLabel(value)}</Text>
                {selected ? <RideIcon name="check" size={13} color="primary" /> : null}
              </Pressable>;
            })}
          </ScrollView>
          {slots.length > 9 ? <View style={styles.sectionHeading}><Text variant="caption" color="textMuted" style={styles.copy}>Scroll for more times</Text><View style={styles.scrollArrows}>
            <ScrollArrow direction="up" disabled={!timeScroll.edges.before} onPress={() => timeScroll.move(-1)} />
            <ScrollArrow direction="down" disabled={!timeScroll.edges.after} onPress={() => timeScroll.move(1)} />
          </View></View> : null}
        </> : <Text variant="caption" color="textMuted">No times remain for this day. Choose another day.</Text>}
      </View>

      <View style={[styles.notice, { backgroundColor: colors.primarySoft }]}>
        <RideIcon name="info" size={18} color="primary" />
        <Text variant="caption" color="textMuted" style={styles.copy}>We start searching about 5 min before pickup. A driver is confirmed only after accepting.</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}><Text variant="button" accessibilityRole="header">Upcoming rides</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh upcoming rides" disabled={loading} onPress={() => void refresh()} style={styles.refresh}><RideIcon name="refresh" size={15} color="primary" /><Text variant="caption" color="primary">{loading ? 'Loading…' : 'Refresh'}</Text></Pressable></View>
        {upcoming.length ? upcoming.map(trip => <ScheduledRideCard key={trip.id} trip={trip} confirmingCancel={cancelId === trip.id} cancelling={cancelling}
          onCancel={() => setCancelId(trip.id)} onKeep={() => setCancelId(null)} onConfirmCancel={() => void confirmCancel()} onViewRide={() => router.push('/ongoing-trip')} />) : <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="calendar" size={19} color="textMuted" /></View>
          <View style={styles.copy}><Text variant="button">{loading ? 'Loading upcoming rides…' : 'No upcoming rides yet'}</Text><Text variant="caption" color="textMuted" style={styles.caption}>Your bookings will appear here.</Text></View>
        </View>}
      </View>
      {error ? <Text accessibilityRole="alert" variant="caption" color="danger">{error}</Text> : null}
    </ScrollView>
    <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.inline}><RideIcon name="calendar" size={16} color={selectedTime ? 'text' : 'textMuted'} /><Text variant="caption" color={selectedTime ? 'text' : 'textMuted'} style={styles.copy} accessibilityLiveRegion="polite">{selectedTime ? `${dateLabel(selectedTime)} · ${timeLabel(selectedTime)}` : 'Choose a pickup day and time'}</Text></View>
      <Button label="Choose addresses" size="sm" className="min-h-12" fullWidth disabled={!selectedTime} onPress={continueBooking} rightIcon={<View style={styles.forward}><AddressIcon name="back" size={18} color="textInverse" /></View>} />
    </View>
  </SafeAreaView>;
}

interface ScheduledRideCardProps {
  trip: Trip;
  confirmingCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onKeep: () => void;
  onConfirmCancel: () => void;
  onViewRide: () => void;
}

function ScheduledRideCard({ trip, confirmingCancel, cancelling, onCancel, onKeep, onConfirmCancel, onViewRide }: ScheduledRideCardProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const failed = trip.status === 'cancelled' || trip.status === 'no_drivers_found';
  const waiting = trip.status === 'scheduled' || trip.status === 'searching';
  const statusColor = failed ? 'danger' : waiting ? 'primary' : 'success';
  const badge = trip.status === 'scheduled' ? 'Scheduled' : trip.status === 'searching' ? 'Searching' : trip.status === 'cancelled' ? 'Cancelled' : trip.status === 'no_drivers_found' ? 'Unavailable' : trip.status === 'in_progress' ? 'In progress' : 'Driver assigned';
  const scheduledTime = trip.scheduled_at ? new Date(trip.scheduled_at).getTime() : null;
  const live = trip.status === 'searching' || trip.status === 'driver_assigned' || trip.status === 'driver_arrived' || trip.status === 'in_progress';
  return <View style={[styles.trip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <View style={styles.tripHeader}>
      <RideIcon name="calendar" size={16} color="primary" />
      <Text variant="button" style={styles.copy} accessibilityLabel={scheduledTime ? `${dateLabel(scheduledTime)}, ${timeLabel(scheduledTime)}, West Africa Time` : 'Scheduled ride'}>{scheduledTime ? `${formatScheduledTime(scheduledTime, { day: 'numeric', month: 'short' })} · ${timeLabel(scheduledTime)}` : 'Scheduled ride'}</Text>
      <View style={[styles.statusBadge, { backgroundColor: failed ? colors.dangerSoft : waiting ? colors.primarySoft : colors.successSoft }]}><Text variant="caption" color={statusColor}>{badge}</Text></View>
    </View>
    {trip.status !== 'scheduled' || expanded ? <Text variant="caption" color={failed ? 'danger' : 'textMuted'}>{trip.status === 'scheduled' ? 'WAT · Driver search has not started' : tripStatusLabel(trip)}</Text> : null}

    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse full route' : 'Show full route'} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.route}>
      <View style={[styles.copy, styles.routeStops]}>
        <View style={styles.routeStop}><AddressIcon name="pickup" size={14} color="primary" /><Text variant="caption" style={styles.copy} numberOfLines={expanded ? undefined : 1}><Text variant="caption" color="textMuted">From </Text>{trip.pickup_address}</Text></View>
        <View style={styles.routeStop}><AddressIcon name="pin" size={14} /><Text variant="caption" style={styles.copy} numberOfLines={expanded ? undefined : 1}><Text variant="caption" color="textMuted">To </Text>{trip.dropoff_address}</Text></View>
      </View>
      <View style={expanded ? styles.expandUp : undefined}><RideIcon name="down" size={14} color="textMuted" /></View>
    </Pressable>

    <View style={styles.tripFooter}>
      <View style={styles.fare}><Text variant="button">₦{(trip.fare_kobo / 100).toLocaleString()}</Text><View style={styles.paymentMethod}><RideIcon name={trip.payment_method === 'wallet' ? 'wallet' : 'cash'} size={14} color="textMuted" /><Text variant="caption" color="textMuted">{trip.payment_method === 'wallet' ? 'Wallet' : 'Cash'}</Text></View></View>
      {trip.status === 'scheduled' && !confirmingCancel ? <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.cancelRide, { borderColor: colors.border }]}><RideIcon name="close" size={14} color="danger" /><Text variant="caption" color="danger">Cancel ride</Text></Pressable> : null}
      {live ? <Button label="View ride" size="sm" onPress={onViewRide} rightIcon={<RideIcon name="chevron" size={14} color="textInverse" />} /> : null}
    </View>
    {trip.status === 'scheduled' && confirmingCancel ? <View style={[styles.cancel, { backgroundColor: colors.dangerSoft }]}>
      <Text variant="button">Cancel this scheduled ride?</Text>
      <View style={styles.cancelActions}><Button size="sm" variant="secondary" label="Keep ride" disabled={cancelling} onPress={onKeep} /><Button size="sm" variant="destructive" label="Yes, cancel" loading={cancelling} onPress={onConfirmCancel} /></View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, copy: { flex: 1, minWidth: 0 }, caption: { marginTop: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.lg },
  intro: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  artwork: { width: 64, height: 64 }, section: { gap: spacing.sm },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scrollArrows: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scrollArrow: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  days: { gap: spacing.sm }, day: { width: 82, minHeight: 62, borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, gap: spacing.xs },
  dayDate: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  timeWindow: { maxHeight: 148, flexGrow: 0 },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: 1 },
  time: { width: '31%', minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  refresh: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  empty: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md },
  emptyIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  trip: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md },
  tripHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  route: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeStops: { gap: spacing.xs },
  routeStop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  expandUp: { transform: [{ rotate: '180deg' }] },
  tripFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  fare: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }, paymentMethod: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cancelRide: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.sm },
  cancel: { padding: spacing.sm, gap: spacing.sm, borderRadius: radius.md },
  cancelActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm },
  forward: { transform: [{ rotate: '180deg' }] },
});
