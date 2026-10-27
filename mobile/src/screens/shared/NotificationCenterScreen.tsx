import { AppMessage } from '@/components/common/AppMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import { notificationDestination, type AppNotification } from '@/services/notificationService';
import { groupNotifications, notificationAppearance, notificationTime, type NotificationFilter } from '@/utils/notificationPresentation';

export function NotificationCenterScreen() {
  const userId = useAuthStore(state => state.session?.user.id);
  const role = useAuthStore(state => state.session?.user.role ?? 'rider');
  return <NotificationInbox key={`${userId}:${role}`} role={role} />;
}

function NotificationInbox({ role }: { role: 'rider' | 'driver' }) {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const items = useNotificationStore(state => state.items);
  const loading = useNotificationStore(state => state.loading);
  const nextCursor = useNotificationStore(state => state.nextCursor);
  const unreadCount = useNotificationStore(state => state.unreadCount);
  const refresh = useNotificationStore(state => state.refresh);
  const loadMore = useNotificationStore(state => state.loadMore);
  const markOpened = useNotificationStore(state => state.markOpened);
  const markAll = useNotificationStore(state => state.markAllRead);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [ready, setReady] = useState(false);
  const [fetchKind, setFetchKind] = useState<'refresh' | 'more' | null>('refresh');
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fetching = useRef(false);
  const readingInFlight = useRef(false);

  const refreshInbox = useCallback(async () => {
    if (fetching.current || readingInFlight.current) return;
    fetching.current = true;
    setFetchKind('refresh');
    setError(null);
    setMoreError(null);
    try { await refresh(); }
    catch { if (mounted.current) setError('Could not refresh notifications. Please try again.'); }
    finally { fetching.current = false; if (mounted.current) { setFetchKind(null); setReady(true); } }
  }, [refresh]);

  useEffect(() => {
    let active = true;
    fetching.current = true;
    void refresh().catch(() => {
      if (active) setError('Could not refresh notifications. Please try again.');
    }).finally(() => {
      if (active) { fetching.current = false; setFetchKind(null); setReady(true); }
    });
    return () => { active = false; fetching.current = false; };
  }, [refresh]);

  const more = async () => {
    if (!nextCursor || loading || fetching.current || readingInFlight.current) return;
    fetching.current = true;
    setFetchKind('more');
    setMoreError(null);
    try { await loadMore(); }
    catch { if (mounted.current) setMoreError('Could not load older notifications. Please try again.'); }
    finally { fetching.current = false; if (mounted.current) setFetchKind(null); }
  };

  const readAll = async () => {
    if (readingInFlight.current || fetching.current || loading) return;
    readingInFlight.current = true;
    setReading(true);
    setActionError(null);
    try { await markAll(); }
    catch { if (mounted.current) setActionError('Could not mark notifications as read. Please try again.'); }
    finally { readingInFlight.current = false; if (mounted.current) setReading(false); }
  };

  const open = async (item: AppNotification) => {
    if (readingInFlight.current || fetching.current || loading) return;
    readingInFlight.current = true;
    setReading(true);
    setActionError(null);
    try {
      await markOpened(item.id);
      if (mounted.current) router.push(notificationDestination(item));
    } catch { if (mounted.current) setActionError('Could not open this notification. Please try again.'); }
    finally { readingInFlight.current = false; if (mounted.current) setReading(false); }
  };

  return <NotificationCenterView role={role} items={items} filter={filter} onFilter={setFilter} initialLoading={!ready && items.length === 0}
    refreshing={loading && fetchKind !== 'more'} loadingMore={fetchKind === 'more'} error={error} moreError={moreError} actionError={actionError}
    hasMore={Boolean(nextCursor)} hasUnread={unreadCount > 0 || items.some(item => !item.readAt)} reading={reading} actionsDisabled={loading || reading || !ready}
    onRefresh={() => void refreshInbox()} onMore={() => void more()} onReadAll={() => void readAll()} onOpen={item => void open(item)}
    onBack={() => router.canGoBack() ? router.back() : router.replace(role === 'driver' ? '/driver-dashboard' : '/home')} />;
}

interface NotificationCenterViewProps {
  role?: 'rider' | 'driver'; items: AppNotification[]; filter: NotificationFilter; onFilter: (filter: NotificationFilter) => void;
  initialLoading: boolean; refreshing: boolean; loadingMore: boolean;
  error: string | null; moreError: string | null; actionError: string | null;
  hasMore: boolean; hasUnread: boolean; reading: boolean; actionsDisabled: boolean;
  onRefresh: () => void; onMore: () => void; onReadAll: () => void; onOpen: (item: AppNotification) => void; onBack: () => void;
}

export function NotificationCenterView({ role = 'rider', items, filter, onFilter, initialLoading, refreshing, loadingMore, error, moreError, actionError, hasMore, hasUnread, reading, actionsDisabled, onRefresh, onMore, onReadAll, onOpen, onBack }: NotificationCenterViewProps) {
  const { colors } = useTheme();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') setNow(new Date()); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  const sections = initialLoading ? [] : groupNotifications(items, filter, now);
  const initialError = Boolean(error && items.length === 0);
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text variant="bodyMedium" accessibilityRole="header" style={styles.title}>{role === 'driver' ? 'Driver notifications' : 'Rider notifications'}</Text>
      {hasUnread ? <Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications as read" accessibilityState={{ disabled: actionsDisabled, busy: reading }} disabled={actionsDisabled} onPress={onReadAll} style={[styles.readAll, { opacity: actionsDisabled ? 0.5 : 1 }]}>{reading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text variant="caption" color="primary">Read all</Text>}</Pressable> : null}
    </View>
    <View accessibilityRole="tablist" accessibilityLabel="Notification filters" style={styles.filters}>{(['all', 'unread'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'all' ? 'All' : 'Unread'} accessibilityState={{ selected: filter === value }} aria-selected={filter === value} onPress={() => onFilter(value)} style={[styles.filter, { backgroundColor: filter === value ? colors.primary : colors.surfaceMuted }]}><Text variant="button" color={filter === value ? 'textInverse' : 'text'}>{value === 'all' ? 'All' : 'Unread'}</Text></Pressable>)}</View>
    <SectionList<AppNotification> sections={sections} keyExtractor={item => item.id} extraData={actionsDisabled} stickySectionHeadersEnabled={false} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing && !initialLoading} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      ListHeaderComponent={actionError || (error && !initialError) ? <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}><AppMessage message={actionError ?? error} />{error ? <Button label="Retry refresh" variant="outline" size="sm" disabled={actionsDisabled} onPress={onRefresh} /> : null}</View> : null}
      renderSectionHeader={({ section }) => <Text variant="caption" color="textMuted" accessibilityRole="header" style={styles.date}>{section.title}</Text>}
      renderItem={({ item }) => <NotificationRow item={item} disabled={actionsDisabled} onPress={() => onOpen(item)} />}
      ListEmptyComponent={<View style={[styles.empty, { backgroundColor: initialError ? colors.dangerSoft : colors.surfaceMuted }]}>
        {initialLoading ? <><ActivityIndicator color={colors.primary} /><Text variant="caption" color="textMuted">Loading notifications…</Text></>
          : initialError ? <><AppMessage message={error} /><Button label="Retry" size="sm" loading={refreshing} onPress={onRefresh} /></>
            : <><RideIcon name="bell" size={22} color="icon" /><Text variant="bodyMedium" style={styles.centered}>{filter === 'unread' ? hasMore ? 'No unread updates loaded' : 'You’re all caught up' : 'No notifications yet'}</Text><Text variant="caption" color="textMuted" style={styles.centered}>{filter === 'unread' ? hasMore ? 'Load older notifications to keep looking.' : 'New notifications will appear here.' : role === 'driver' ? 'Ride offers, earnings and driver updates will appear here.' : 'Your rides, payments and account updates will appear here.'}</Text></>}
      </View>}
      ListFooterComponent={!initialLoading && !initialError && hasMore ? <View style={styles.more}>{moreError ? <AppMessage message={moreError} /> : null}<Button label={moreError ? 'Retry loading' : 'Load more'} variant="outline" size="sm" fullWidth loading={loadingMore} disabled={actionsDisabled} rightIcon={<RideIcon name="down" size={16} color="primary" />} onPress={onMore} /></View> : null}
    />
  </SafeAreaView>;
}

function NotificationRow({ item, disabled, onPress }: { item: AppNotification; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const appearance = notificationAppearance(item);
  const unread = !item.readAt;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body}. ${new Date(item.createdAt).toLocaleString()}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.row, { backgroundColor: unread ? colors.primarySoft : colors.surface, borderColor: unread ? colors.primarySoft : colors.border }]}>
    <View style={[styles.icon, { backgroundColor: colors[appearance.background] }]}><RideIcon name={appearance.icon} size={18} color={appearance.color} /></View>
    <View style={styles.copy}><View style={styles.rowHeading}><Text variant="button" style={styles.rowTitle}>{item.title}</Text>{unread ? <View style={styles.new}><View style={[styles.dot, { backgroundColor: colors.primary }]} /><Text variant="caption" color="primary">New</Text></View> : null}</View>
      <Text variant="caption" color="textMuted">{item.body}</Text><Text variant="caption" color="textMuted" style={styles.time}>{notificationTime(item.createdAt)}</Text>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.divider },
  back: { width: 48, height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, minWidth: 0 },
  readAll: { minHeight: 44, minWidth: 52, justifyContent: 'center', alignItems: 'center' },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  filter: { flex: 1, minHeight: 44, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }, date: { marginTop: spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, borderRadius: radius.xl, borderWidth: borderWidths.divider, padding: spacing.md, marginBottom: spacing.sm, minHeight: 80 },
  icon: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, rowTitle: { flex: 1, minWidth: 0 },
  new: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: 1 }, dot: { width: 5, height: 5, borderRadius: radius.full },
  time: { marginTop: spacing.xs }, empty: { padding: spacing.xl, marginTop: spacing.md, borderRadius: radius.xl, alignItems: 'center', gap: spacing.md }, centered: { textAlign: 'center' },
  error: { padding: spacing.md, borderRadius: radius.xl, gap: spacing.sm, marginBottom: spacing.sm }, more: { paddingVertical: spacing.md, gap: spacing.sm },
});
