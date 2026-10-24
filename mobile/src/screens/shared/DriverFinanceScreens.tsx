import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { radius, spacing, useTheme } from '@/constants/theme';
import { useDriverBalance, useFinanceResource, type FinanceResource } from '@/hooks/useFinanceResource';
import { apiErrorMessage } from '@/lib/apiClient';
import { formatNaira, getEarningsSummary, getPayoutAccounts, getWalletTransactions, getWithdrawals, type EarningsSummary, type PayoutAccount, type WalletEntry, type Withdrawal } from '@/services/paymentService';
import { useAuthStore } from '@/store/authStore';
import { FinanceButton as Button, FinanceEmpty, BankAccountCard, DriverActivityRow, FinanceCard, FinanceFeedback, FinanceHeading, FinanceLink, FinancePage, MoneySummary, WithdrawalRow, financeStyles as styles } from './DriverFinanceUI';

const firstActivity = () => getWalletTransactions('earnings');
type ActivityPage = Awaited<ReturnType<typeof firstActivity>>;
type Balance = ReturnType<typeof useDriverBalance>;

export function EarningsActivity({ title = 'Recent activity', detail }: { title?: string; detail?: string }) {
  const resource = useFinanceResource(firstActivity);
  return <View><FinanceHeading detail={detail}>{title}</FinanceHeading><FinanceFeedback label="activity" loading={resource.loading} error={resource.error} onRetry={() => void resource.refresh()} />
    {resource.data ? <ActivityPages key={resource.revision} page={resource.data} /> : null}
  </View>;
}
function ActivityPages({ page }: { page: ActivityPage }) {
  const [entries, setEntries] = useState<WalletEntry[]>(page.items);
  const [cursor, setCursor] = useState(page.nextCursor);
  const [count, setCount] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const expand = async () => {
    if (busy.current) return;
    if (count < entries.length) { setCount(value => value + 4); return; }
    if (!cursor) return;
    const userId = useAuthStore.getState().session?.user.id;
    busy.current = true; setLoading(true); setError(null);
    try {
      const result = await getWalletTransactions('earnings', cursor);
      if (!active.current || useAuthStore.getState().session?.user.id !== userId) return;
      setEntries(current => [...new Map([...current, ...result.items].map(entry => [entry.id, entry])).values()]);
      setCursor(result.nextCursor === cursor ? null : result.nextCursor);
      setCount(value => value + 4);
    } catch (reason) { if (active.current) setError(apiErrorMessage(reason)); }
    finally { busy.current = false; if (active.current) setLoading(false); }
  };
  return <View style={styles.smallStack}>
    {!entries.length ? <Text variant="caption" color="textMuted">No transactions yet.</Text> : entries.slice(0, count).map(entry => <DriverActivityRow key={entry.id} entry={entry} />)}
    {error ? <Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text> : null}
    {count < entries.length || cursor ? <Button label={error ? 'Retry loading' : 'View more'} accessibilityLabel="View more earnings activity" size="sm" variant="outline" fullWidth loading={loading} rightIcon={<RideIcon name="down" size={16} color="primary" />} onPress={() => void expand()} /> : null}
  </View>;
}
export function DriverWalletScreen() {
  const router = useRouter();
  const wallet = useDriverBalance();
  return <DriverWalletView wallet={wallet} activity={<EarningsActivity />} onWithdraw={() => router.push({ pathname: '/account/[section]', params: { section: 'withdraw' } })}
    onEarnings={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-earnings' } })}
    onPayouts={() => router.push({ pathname: '/account/[section]', params: { section: 'payouts' } })}
    onPayDebt={() => router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'earnings' } })}
    onHelp={() => router.push({ pathname: '/account/[section]', params: { section: 'support' } })} />;
}
export function DriverWalletView({ wallet, activity, onWithdraw, onEarnings, onPayouts, onPayDebt, onHelp }: { wallet: Balance; activity: ReactNode; onWithdraw: () => void; onEarnings: () => void; onPayouts: () => void; onPayDebt: () => void; onHelp: () => void }) {
  const { colors } = useTheme();
  return <FinancePage title="Driver wallet">
    <MoneySummary label="Available to withdraw" amount={wallet.withdrawableKobo} loading={wallet.loading} error={wallet.error} onRetry={() => void wallet.refresh()}><Button label="Withdraw" size="sm" fullWidth disabled={wallet.loading || Boolean(wallet.error) || wallet.withdrawableKobo <= 0} leftIcon={<RideIcon name="external" size={18} color="textInverse" />} onPress={onWithdraw} /></MoneySummary>
    {!wallet.loading && !wallet.error && wallet.owedKobo > 0 ? <View style={[styles.card, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}><Text variant="button" color="danger">Cash commission owed: {formatNaira(wallet.owedKobo)}</Text><Text variant="caption" color="textMuted">{wallet.canGoOnline ? 'Pay now or earn it off through wallet rides.' : 'You cannot go online until the balance is below the limit.'}</Text><Button label="Pay now" size="sm" onPress={onPayDebt} /></View> : null}
    <View style={[styles.navGroup, { borderColor: colors.border, backgroundColor: colors.surface }]}><FinanceLink icon="earnings" label="Earnings breakdown" grouped onPress={onEarnings} /><FinanceLink icon="bank" label="Bank accounts & payouts" grouped last onPress={onPayouts} /></View>
    {activity}<View style={[styles.navGroup, { borderColor: colors.border, backgroundColor: colors.surface }]}><FinanceLink icon="support" label="Wallet help" grouped last tintedIcon onPress={onHelp} /></View>
  </FinancePage>;
}
export function DriverEarningsScreen() {
  const [range, setRange] = useState<'today' | 'week' | 'month'>('week');
  const loader = useCallback(() => getEarningsSummary(range), [range]);
  const summary = useFinanceResource(loader);
  return <DriverEarningsView range={range} onRange={setRange} summary={summary} activity={<EarningsActivity title="Wallet activity" detail="All dates" />} />;
}
export function DriverEarningsView({ range, onRange, summary, activity }: { range: 'today' | 'week' | 'month'; onRange: (value: 'today' | 'week' | 'month') => void; summary: FinanceResource<EarningsSummary>; activity: ReactNode }) {
  const { colors } = useTheme();
  // Old range results are hidden while the selected summary is being fetched.
  const data = !summary.loading && !summary.error ? summary.data : null;
  return <FinancePage title="Earnings breakdown">
    <View accessibilityRole="radiogroup" accessibilityLabel="Earnings period" style={[styles.inline, { padding: spacing.xs, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg }]}>
      {(['today', 'week', 'month'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value[0].toUpperCase() + value.slice(1)} accessibilityState={{ checked: range === value }} aria-checked={range === value} onPress={() => onRange(value)} style={{ flex: 1, minHeight: 44, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', backgroundColor: range === value ? colors.primary : colors.surfaceMuted }}><Text variant="button" color={range === value ? 'textInverse' : 'textMuted'}>{value[0].toUpperCase() + value.slice(1)}</Text></Pressable>)}
    </View>
    <MoneySummary horizontal label="Net earnings" icon="coins" amount={data?.netKobo ?? 0} loading={summary.loading} error={summary.error} onRetry={() => void summary.refresh()} detail={data ? `${data.trips} completed trips` : undefined} />
    {data ? <><FinanceCard><Text variant="button" accessibilityRole="header">Earnings summary</Text><MoneyLine label="Gross fares" amount={data.grossKobo} /><MoneyLine label="Commission" amount={-data.commissionKobo} deduction /><MoneyLine label="Net earnings" amount={data.netKobo} /></FinanceCard>
      <FinanceCard><Text variant="button" accessibilityRole="header">By payment method</Text><MoneyLine label="Cash collected" amount={data.cashCollectedKobo} /><MoneyLine label="Cash earnings after commission" amount={data.cashEarningsKobo} /><MoneyLine label="Wallet earnings after commission" amount={data.walletEarningsKobo} /><MoneyLine label="Cash-trip commission for this period" amount={data.cashCommissionKobo} deduction /><Text variant="caption" color="textMuted">Cash commission for this period may already be settled. See Driver wallet for the current amount owed.</Text></FinanceCard>
      <View style={[styles.inline, { flexWrap: 'wrap' }]}><View style={[styles.stat, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="cash" size={18} /><Text variant="caption" style={styles.copy}>{data.cashTrips} cash trips</Text></View><View style={[styles.stat, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="wallet" size={18} /><Text variant="caption" style={styles.copy}>{data.walletTrips} wallet trips</Text></View></View></> : null}
    <Text variant="caption" color="textMuted">Earnings include your share of cash and wallet trips after commission. Cash collected stays with you. Wallet earnings can offset commission owed; the wallet balance shows what is available to withdraw.</Text>{activity}
  </FinancePage>;
}
function MoneyLine({ label, amount, deduction }: { label: string; amount: number; deduction?: boolean }) {
  const { colors } = useTheme();
  const negative = amount < 0;
  return <View style={[styles.inline, { justifyContent: 'space-between', flexWrap: 'wrap', paddingVertical: spacing.sm, ...(label === 'Net earnings' ? { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md } : {}) }]}><Text variant="caption" color="textMuted" style={styles.copy}>{label}</Text><Text variant="button" color={negative || deduction ? 'danger' : label === 'Net earnings' ? 'success' : 'text'}>{negative ? '−' : ''}{formatNaira(Math.abs(amount))}</Text></View>;
}
export function PayoutsScreen() {
  const router = useRouter();
  const accounts = useFinanceResource(getPayoutAccounts);
  const withdrawals = useFinanceResource(getWithdrawals);
  return <PayoutsView accounts={accounts} withdrawals={withdrawals} onAdd={() => router.push({ pathname: '/account/[section]', params: { section: 'add-bank' } })}
    onWithdraw={() => router.push({ pathname: '/account/[section]', params: { section: 'withdraw' } })} onHelp={() => router.push({ pathname: '/account/[section]', params: { section: 'support' } })} />;
}
export function PayoutsView({ accounts, withdrawals, onAdd, onWithdraw, onHelp }: { accounts: FinanceResource<{ accounts: PayoutAccount[] }>; withdrawals: FinanceResource<{ withdrawals: Withdrawal[] }>; onAdd: () => void; onWithdraw: () => void; onHelp: () => void }) {
  const rows = withdrawals.data?.withdrawals ?? [];
  const { colors } = useTheme();
  return <FinancePage title="Bank accounts & payouts">
    <View style={styles.smallStack}><View style={styles.inline}><Text variant="button" accessibilityRole="header" style={styles.copy}>Bank accounts</Text><Button label="Add bank" size="sm" variant="ghost" leftIcon={<RideIcon name="plus" size={16} color="primary" />} onPress={onAdd} /></View>
      <FinanceFeedback label="bank accounts" loading={accounts.loading} error={accounts.error} onRetry={() => void accounts.refresh()} />
      {accounts.data?.accounts.map(account => <BankAccountCard key={account.id} account={account} />)}
      {accounts.data && !accounts.loading && !accounts.error && !accounts.data.accounts.length ? <FinanceEmpty icon="bank" title="No bank account added" detail="Add one for your withdrawals." /> : null}
      <Button label="Request withdrawal" leftIcon={<RideIcon name="external" size={18} color="textInverse" />} size="sm" fullWidth disabled={accounts.loading || Boolean(accounts.error) || !accounts.data?.accounts.length} onPress={onWithdraw} />
    </View>
    <View><View style={styles.heading}><Text variant="button" accessibilityRole="header" style={styles.copy}>Withdrawal history</Text><Button label="Refresh" accessibilityLabel="Refresh payouts" size="sm" variant="ghost" leftIcon={<RideIcon name="refresh" size={16} color="primary" />} onPress={() => { void accounts.refresh(); void withdrawals.refresh(); }} /></View><FinanceFeedback label="payout history" loading={withdrawals.loading} error={withdrawals.error} onRetry={() => void withdrawals.refresh()} />
      {rows.map(item => <WithdrawalRow key={item.id} item={item} />)}
      {withdrawals.data && !withdrawals.loading && !withdrawals.error && !rows.length ? <FinanceEmpty icon="clock" title="No withdrawals yet" detail="Your payout status will appear here." /> : null}
    </View>
    {rows.some(item => item.status === 'pending' || item.status === 'processing') ? <View style={styles.inline}><RideIcon name="safety" size={16} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>Pending requests are still processing.</Text></View> : null}
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}><FinanceLink icon="support" label="Payout help" onPress={onHelp} /></View>
  </FinancePage>;
}
