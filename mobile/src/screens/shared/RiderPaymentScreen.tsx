import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';
import { formatNaira, getWalletTransactions, type WalletEntry } from '@/services/paymentService';
import { useWalletStore } from '@/store/walletStore';
import { walletActivityDate, walletActivityLabel } from '@/utils/walletActivity';

type ActivityPage = Awaited<ReturnType<typeof getWalletTransactions>>;
interface ActivityResult extends ActivityPage { key: number; error: string | null; loadingMore: boolean; moreError: string | null }

export function RiderPaymentScreen() {
  const router = useRouter();
  const balance = useWalletStore(state => state.walletKobo);
  const balanceLoading = useWalletStore(state => state.loading);
  const balanceError = useWalletStore(state => state.error);
  const refresh = useWalletStore(state => state.refresh);
  const [balanceRevision, setBalanceRevision] = useState(0);
  const [settledBalanceRevision, setSettledBalanceRevision] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ActivityResult | null>(null);
  const moreInFlight = useRef<number | null>(null);
  const page = result?.key === revision ? result : null;

  useEffect(() => {
    let active = true;
    void refresh().then(() => { if (active) setSettledBalanceRevision(balanceRevision); });
    return () => { active = false; };
  }, [balanceRevision, refresh]);

  useEffect(() => {
    let active = true;
    void getWalletTransactions('wallet').then(data => {
      if (active) setResult({ ...data, key: revision, error: null, loadingMore: false, moreError: null });
    }).catch(reason => {
      if (active) setResult({ key: revision, items: [], nextCursor: null, error: apiErrorMessage(reason), loadingMore: false, moreError: null });
    });
    return () => { active = false; };
  }, [revision]);

  const loadMore = async () => {
    const cursor = page?.nextCursor;
    if (!cursor || page.loadingMore || moreInFlight.current === revision) return;
    moreInFlight.current = revision;
    setResult(current => current?.key === revision ? { ...current, loadingMore: true, moreError: null } : current);
    try {
      const data = await getWalletTransactions('wallet', cursor);
      setResult(current => {
        if (!current || current.key !== revision || current.nextCursor !== cursor) return current;
        const items = [...new Map([...current.items, ...data.items].map(entry => [entry.id, entry])).values()];
        return { ...current, items, nextCursor: data.nextCursor === cursor ? null : data.nextCursor, loadingMore: false };
      });
    } catch (reason) {
      setResult(current => current?.key === revision ? { ...current, loadingMore: false, moreError: apiErrorMessage(reason) } : current);
    } finally { if (moreInFlight.current === revision) moreInFlight.current = null; }
  };

  return <RiderPaymentView balanceKobo={balance} balanceLoading={settledBalanceRevision !== balanceRevision || balanceLoading} balanceError={balanceError}
    entries={page?.items ?? []} loading={!page} error={page?.error ?? null} hasMore={Boolean(page?.nextCursor)} loadingMore={page?.loadingMore ?? false} moreError={page?.moreError ?? null}
    onBalanceRetry={() => setBalanceRevision(value => value + 1)} onRetry={() => setRevision(value => value + 1)} onMore={() => void loadMore()}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')}
    onTopUp={() => router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'wallet' } })}
    onHelp={() => router.push({ pathname: '/account/[section]', params: { section: 'support' } })} />;
}

interface RiderPaymentViewProps {
  balanceKobo: number; balanceLoading: boolean; balanceError: string | null;
  entries: WalletEntry[]; loading: boolean; error: string | null;
  hasMore: boolean; loadingMore: boolean; moreError: string | null;
  onBalanceRetry: () => void; onRetry: () => void; onMore: () => void;
  onBack: () => void; onTopUp: () => void; onHelp: () => void;
}

export function RiderPaymentView({ balanceKobo, balanceLoading, balanceError, entries, loading, error, hasMore, loadingMore, moreError, onBalanceRetry, onRetry, onMore, onBack, onTopUp, onHelp }: RiderPaymentViewProps) {
  const { colors } = useTheme();
  const [visibleCount, setVisibleCount] = useState(4);
  const hiddenEntries = entries.length > visibleCount;
  const expandActivity = () => {
    if (loadingMore) return;
    setVisibleCount(count => count + 4);
    if (!hiddenEntries && hasMore) onMore();
  };
  const renderEntry: ListRenderItem<WalletEntry> = ({ item }) => <ActivityRow entry={item} />;
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text accessibilityRole="header" variant="bodyMedium">Payment</Text>
    </View>
    <FlatList data={loading || error ? [] : entries.slice(0, visibleCount)} keyExtractor={entry => entry.id} renderItem={renderEntry} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}
      ListHeaderComponent={<>
        <View style={[styles.wallet, { backgroundColor: colors.primarySoft }]}>
          <View style={styles.walletHeading}><View style={[styles.walletIcon, { backgroundColor: colors.surface }]}><RideIcon name="wallet" size={18} /></View><Text variant="button">Ride wallet</Text></View>
          <Text variant="caption" color="textMuted" style={styles.balanceLabel}>Available balance</Text>
          <View style={styles.balance} accessibilityLiveRegion="polite">
            {balanceLoading ? <View style={styles.inline}><ActivityIndicator color={colors.primary} size="small" /><Text variant="caption" color="textMuted">Loading balance…</Text></View>
              : balanceError ? <Text variant="bodyMedium">Balance unavailable</Text> : <Text variant="h3" selectable>{formatNaira(balanceKobo)}</Text>}
          </View>
          {!balanceLoading && balanceError ? <View style={styles.balanceError}><Text variant="caption" color="danger" accessibilityRole="alert">Could not load your wallet balance.</Text><Button label="Retry balance" variant="outline" size="sm" onPress={onBalanceRetry} /></View> : null}
          <Button label="Top up" size="sm" fullWidth leftIcon={<RideIcon name="plus" size={18} color="textInverse" />} onPress={onTopUp} />
        </View>
        <View style={styles.paystack}><RideIcon name="external" size={16} color="icon" /><Text variant="caption" color="textMuted">Top up with Paystack</Text></View>
        <Text variant="bodyMedium" accessibilityRole="header" style={styles.activityHeading}>Recent activity</Text>
      </>}
      ListEmptyComponent={<View style={[styles.empty, { backgroundColor: error ? colors.dangerSoft : colors.surfaceMuted }]}>
        {loading ? <><ActivityIndicator color={colors.primary} /><Text variant="caption" color="textMuted">Loading activity…</Text></>
          : error ? <><Text variant="caption" color="danger" accessibilityRole="alert">Could not load your wallet activity.</Text><Button label="Retry activity" size="sm" onPress={onRetry} /></>
            : <><RideIcon name="wallet" size={20} color="icon" /><Text variant="bodyMedium">No transactions yet</Text><Text variant="caption" color="textMuted" style={styles.centered}>Your wallet activity will appear here.</Text></>}
      </View>}
      ListFooterComponent={<View style={styles.footer}>
        {!loading && !error && (hiddenEntries || hasMore) ? <View style={styles.more}>{moreError ? <Text variant="caption" color="danger" accessibilityRole="alert">Could not load older activity. Please try again.</Text> : null}<Button label={moreError ? 'Retry loading' : 'View more'} accessibilityHint="Show more wallet transactions" size="sm" variant="outline" fullWidth loading={loadingMore} rightIcon={<RideIcon name="down" size={16} color="primary" />} onPress={expandActivity} /></View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Payment help" onPress={onHelp} style={[styles.help, { borderTopColor: colors.border }]}><View style={[styles.activityIcon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="support" size={18} /></View><Text variant="button" style={styles.helpCopy}>Payment help</Text><RideIcon name="chevron" size={16} color="icon" /></Pressable>
      </View>}
    />
  </SafeAreaView>;
}

function ActivityRow({ entry }: { entry: WalletEntry }) {
  const { colors } = useTheme();
  const credit = entry.direction === 'credit';
  const color = credit ? 'success' : 'danger';
  const icon = entry.type === 'trip_hold' ? 'lock' : entry.type === 'trip_hold_release' ? 'unlock' : entry.type === 'trip_settlement_wallet' ? 'vehicle' : credit ? 'incoming' : 'outgoing';
  const label = walletActivityLabel(entry);
  const description = entry.description?.trim();
  return <View style={[styles.entry, { borderBottomColor: colors.border }]}>
    <View style={[styles.activityIcon, { backgroundColor: credit ? colors.successSoft : colors.dangerSoft }]}><RideIcon name={icon} size={18} color={color} /></View>
    <View style={styles.entryCopy}>
      <View style={styles.entryHeading}><Text variant="button" style={styles.entryTitle}>{label}</Text><Text variant="button" color={color} style={styles.amount}>{credit ? '+' : '−'}{formatNaira(entry.amountKobo)}</Text></View>
      {description && description !== label ? <Text variant="caption" color="textMuted">{description}</Text> : null}
      <Text variant="caption" color="textMuted">{walletActivityDate(entry.createdAt)}</Text>
      <Text variant="caption" color="textMuted">Balance {formatNaira(entry.balanceAfterKobo)}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.divider },
  back: { width: 48, height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  wallet: { borderRadius: radius.xl, padding: spacing.lg }, walletHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  walletIcon: { width: 36, height: 36, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  balanceLabel: { marginTop: spacing.sm }, balance: { minHeight: 30, justifyContent: 'center', marginBottom: spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, balanceError: { gap: spacing.sm, marginBottom: spacing.md },
  paystack: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl },
  activityHeading: { marginBottom: spacing.xs },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: borderWidths.divider },
  activityIcon: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  entryCopy: { flex: 1, minWidth: 0, gap: 2 }, entryHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  entryTitle: { flex: 1, minWidth: 0 }, amount: { flexShrink: 1, maxWidth: '55%', textAlign: 'right' },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderRadius: radius.xl, marginTop: spacing.md }, centered: { textAlign: 'center' },
  footer: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: spacing.lg }, more: { gap: spacing.sm, marginBottom: spacing.xl },
  help: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: borderWidths.divider }, helpCopy: { flex: 1 },
});
