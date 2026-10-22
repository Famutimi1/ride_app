import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, type ButtonProps } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { radius, spacing, useTheme } from '@/constants/theme';
import { formatNaira, type PayoutAccount, type WalletEntry, type Withdrawal } from '@/services/paymentService';
import { driverActivityLabel, withdrawalStatus } from '@/utils/driverFinance';
import { walletActivityDate } from '@/utils/walletActivity';

type Icon = ComponentProps<typeof RideIcon>['name'];
export function FinancePage({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const router = useRouter();
  return <SafeAreaView edges={['top', 'bottom']} style={[financeStyles.screen, { backgroundColor: colors.background }]}>
    <View style={[financeStyles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={() => router.canGoBack() ? router.back() : router.replace('/menu')} style={[financeStyles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text variant="bodyMedium" accessibilityRole="header" style={financeStyles.copy}>{title}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={financeStyles.content}>{children}</ScrollView>
  </SafeAreaView>;
}
export function FinanceHeading({ children, detail }: { children: string; detail?: string }) {
  return <View style={financeStyles.heading}><Text variant="button" accessibilityRole="header" style={financeStyles.copy}>{children}</Text>{detail ? <Text variant="caption" color="textMuted">{detail}</Text> : null}</View>;
}
export function FinanceCard({ children, mint = false }: { children: ReactNode; mint?: boolean }) {
  const { colors } = useTheme();
  return <View style={[financeStyles.card, { backgroundColor: mint ? colors.primarySoft : colors.surface, borderColor: mint ? colors.primarySoft : colors.border }]}>{children}</View>;
}
export function FinanceFeedback({ loading, error, onRetry, label }: { loading?: boolean; error?: string | null; onRetry?: () => void; label: string }) {
  const { colors } = useTheme();
  if (loading) return <View style={financeStyles.feedback}><ActivityIndicator color={colors.primary} size="small" /><Text variant="caption" color="textMuted">Loading {label}…</Text></View>;
  if (error) return <View style={financeStyles.feedback}><Text variant="caption" color="danger" accessibilityRole="alert" style={financeStyles.copy}>{error}</Text>{onRetry ? <FinanceButton label={`Retry ${label}`} size="sm" variant="outline" onPress={onRetry} /> : null}</View>;
  return null;
}
export function MoneySummary({ label, amount, loading, error, onRetry, children, detail, icon = 'wallet', horizontal = false }: { label: string; amount: number; loading: boolean; error: string | null; onRetry: () => void; children?: ReactNode; detail?: string; icon?: Icon; horizontal?: boolean }) {
  const value = loading || error ? <Text variant="h2">—</Text> : <Text variant="h2" color={amount < 0 ? 'danger' : 'text'} selectable>{formatNaira(amount)}</Text>;
  return <FinanceCard mint>
    {horizontal ? <View style={[financeStyles.inline, { gap: spacing.lg, paddingVertical: spacing.sm }]}><RideIcon name={icon} color="primary" size={24} /><View style={[financeStyles.copy, financeStyles.smallStack]}><Text variant="caption" color="textMuted">{label}</Text>{value}{detail ? <Text variant="caption" color="textMuted">{detail}</Text> : null}</View></View>
      : <><View style={financeStyles.inline}><RideIcon name={icon} color="primary" size={20} /><Text variant="caption" color="textMuted">{label}</Text></View>{value}{detail ? <Text variant="caption" color="textMuted">{detail}</Text> : null}</>}
    <FinanceFeedback loading={loading} error={error} onRetry={onRetry} label="balance" />{children}
  </FinanceCard>;
}
export function FinanceLink({ icon, label, onPress, grouped = false, last = false, subtle = false, tintedIcon = false }: { icon: Icon; label: string; onPress: () => void; grouped?: boolean; last?: boolean; subtle?: boolean; tintedIcon?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[financeStyles.link, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, paddingHorizontal: grouped ? spacing.lg : 0 }]}><View style={tintedIcon ? [financeStyles.icon, { backgroundColor: colors.surfaceMuted }] : undefined}><RideIcon name={icon} size={18} color={subtle ? 'textMuted' : 'text'} /></View><Text variant={subtle ? 'caption' : 'bodyMedium'} color={subtle ? 'textMuted' : 'text'} style={financeStyles.copy}>{label}</Text><RideIcon name="chevron" size={16} color="textMuted" /></Pressable>;
}
export function FinanceEmpty({ icon, title, detail }: { icon: Icon; title: string; detail?: string }) {
  const { colors } = useTheme();
  return <View style={[financeStyles.bank, { borderColor: colors.border, backgroundColor: colors.surface }]}><View style={[financeStyles.icon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={18} color="textMuted" /></View><View style={financeStyles.copy}><Text variant="button">{title}</Text>{detail ? <Text variant="caption" color="textMuted">{detail}</Text> : null}</View></View>;
}
/** White, silver-bordered controls from the approved finance mockups only. */
export function FinanceInput({ label, onFocus, onBlur, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return <View style={financeStyles.smallStack}><Text variant="caption" color="textMuted">{label}</Text><TextInput {...props} accessibilityLabel={props.accessibilityLabel ?? label} selectionColor={colors.primary} placeholderTextColor={colors.textMuted}
    onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
    className="font-inter-regular text-body text-text outline-none" style={[financeStyles.input, { borderColor: focused ? colors.primary : colors.border, backgroundColor: colors.surface }, props.style]} /></View>;
}
/** Finance actions use green outlines and labels; the rest of the app keeps its buttons. */
export function FinanceButton({ label, variant = 'primary', loading = false, disabled, fullWidth, leftIcon, rightIcon, size = 'sm', className, ...props }: ButtonProps) {
  const { colors } = useTheme();
  const filled = variant === 'primary' || variant === 'destructive';
  const textColor = filled ? 'textInverse' : variant === 'secondary' ? 'text' : 'primary';
  const backgroundColor = variant === 'primary' ? colors.primary : variant === 'destructive' ? colors.danger : variant === 'secondary' ? colors.surfaceMuted : variant === 'ghost' ? colors.background : colors.surface;
  const blocked = Boolean(disabled || loading);
  return <Pressable {...props} className={className} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? label} accessibilityState={{ disabled: blocked, busy: loading }} disabled={blocked}
    style={[financeStyles.action, { minHeight: size === 'lg' ? 52 : 44, backgroundColor, borderColor: variant === 'outline' ? colors.primary : backgroundColor, borderWidth: variant === 'outline' ? 1 : 0, opacity: blocked ? 0.5 : 1 }, variant === 'ghost' ? { paddingHorizontal: 0, alignSelf: 'flex-start' } : null, fullWidth ? { alignSelf: 'stretch' } : null]}>
    {loading ? <ActivityIndicator size="small" color={colors[textColor]} /> : <View style={financeStyles.inline}>{leftIcon}<Text variant={variant === 'ghost' ? 'caption' : 'button'} color={textColor} style={{ flexShrink: 1, textAlign: 'center' }}>{label}</Text>{rightIcon}</View>}
  </Pressable>;
}
export function BankAccountCard({ account, selected, onPress, disabled }: { account: PayoutAccount; selected?: boolean; onPress?: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const content = <><RideIcon name="bank" size={18} color="textMuted" /><View style={financeStyles.copy}><Text variant="button">{account.bank_name} · ••••{account.account_last4}</Text><Text variant="caption" color="textMuted">{account.account_name}</Text></View>{onPress ? <View style={[financeStyles.radio, { borderColor: selected ? colors.primary : colors.borderStrong }]}>{selected ? <View style={[financeStyles.dot, { backgroundColor: colors.primary }]} /> : null}</View> : null}</>;
  const style = [financeStyles.bank, { borderColor: colors.border, backgroundColor: colors.surface }];
  return onPress ? <Pressable accessibilityRole="radio" accessibilityLabel={`${account.bank_name}, account ending ${account.account_last4}, ${account.account_name}`} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled} onPress={onPress} style={style}>{content}</Pressable> : <View style={style}>{content}</View>;
}
export function DriverActivityRow({ entry }: { entry: WalletEntry }) {
  const { colors } = useTheme();
  const credit = entry.direction === 'credit';
  const tone = credit ? 'success' : 'danger';
  const label = driverActivityLabel(entry);
  const description = entry.description?.trim();
  const icon = entry.type === 'trip_commission_cash' ? 'vehicle' : entry.type === 'trip_settlement_wallet' ? 'wallet' : entry.type.startsWith('withdrawal') ? 'outgoing' : credit ? 'incoming' : 'outgoing';
  return <View style={[financeStyles.entry, { borderBottomColor: colors.border }]}>
    <View style={[financeStyles.icon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={18} color="icon" /></View>
    <View style={financeStyles.copy}><View style={financeStyles.entryHeading}><Text variant="button" style={financeStyles.copy}>{label}</Text><Text variant="button" color={tone} style={financeStyles.amount}>{credit ? '+' : '−'}{formatNaira(entry.amountKobo)}</Text></View>
      {description && description !== label ? <Text variant="caption" color="textMuted">{description}</Text> : null}
      <Text variant="caption" color="textMuted">{walletActivityDate(entry.createdAt)}</Text><Text variant="caption" color="textMuted">Balance {formatNaira(entry.balanceAfterKobo)}</Text>
    </View>
  </View>;
}
export function WithdrawalRow({ item }: { item: Withdrawal }) {
  const { colors } = useTheme();
  const status = withdrawalStatus(item.status);
  const backgroundColor = status.tone === 'success' ? colors.successSoft : status.tone === 'warning' ? colors.warningSoft : status.tone === 'danger' ? colors.dangerSoft : colors.surfaceMuted;
  return <View style={[financeStyles.entry, { borderBottomColor: colors.border }]}>
    <View style={[financeStyles.icon, { backgroundColor }]}><RideIcon name={status.icon} size={18} color={status.tone} /></View>
    <View style={financeStyles.copy}><Text variant="body">{item.bank_name ?? 'Bank unavailable'}{item.account_last4 ? ` · ••••${item.account_last4}` : ''}</Text><Text variant="caption" color="textMuted">{walletActivityDate(item.requested_at)}</Text>{item.fee_kobo > 0 ? <Text variant="caption" color="textMuted">Fee {formatNaira(item.fee_kobo)}</Text> : null}</View>
    <View style={financeStyles.payoutAmount}><Text variant="button" style={{ textAlign: 'right' }}>{formatNaira(item.amount_kobo)}</Text><View style={[financeStyles.badge, { backgroundColor }]}><RideIcon name={status.icon} size={14} color={status.tone} /><Text variant="caption" color={status.tone}>{status.label}</Text></View></View>
  </View>;
}
export const financeStyles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  content: { padding: spacing.xl, paddingBottom: spacing['2xl'], gap: spacing.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  copy: { flex: 1, minWidth: 0 }, inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  feedback: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  link: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
  bank: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  radio: { width: 20, height: 20, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, dot: { width: 12, height: 12, borderRadius: radius.full },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  entryHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.sm }, amount: { maxWidth: '55%', flexShrink: 1, textAlign: 'right' },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  action: { minHeight: 44, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  payoutAmount: { maxWidth: '42%', alignItems: 'flex-end', gap: spacing.xs },
  navGroup: { borderWidth: 1, borderRadius: radius.xl, overflow: 'hidden' },
  netLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
  stat: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  sectionDivider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.lg, gap: spacing.md },
  textAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  summaryStrip: { borderRadius: radius.lg, padding: spacing.md },
  stack: { gap: spacing.md }, smallStack: { gap: spacing.sm },
});
