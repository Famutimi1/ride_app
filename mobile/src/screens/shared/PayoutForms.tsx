import { useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { radius, spacing, useTheme } from '@/constants/theme';
import { useDriverBalance, useFinanceAction, useFinanceResource, type FinanceResource } from '@/hooks/useFinanceResource';
import { addPayoutAccount, formatNaira, getBanks, getPayoutAccounts, requestWithdrawal, resolveBankAccount, sendPayoutOtp, sendWithdrawalOtp, type PayoutAccount } from '@/services/paymentService';
import { useWalletStore } from '@/store/walletStore';
import { withdrawalAmountKobo, withdrawalStatus } from '@/utils/driverFinance';
import { FinanceButton as Button, FinanceInput as Input, FinanceEmpty, BankAccountCard, FinanceCard, FinanceFeedback, FinanceHeading, FinanceLink, FinancePage, MoneySummary, financeStyles as styles } from './DriverFinanceUI';

type Banks = Awaited<ReturnType<typeof getBanks>>;

export function AddBankScreen() {
  const router = useRouter();
  const banks = useFinanceResource(getBanks);
  const action = useFinanceAction();
  const [bankCode, setBankCode] = useState('');
  const [number, setNumber] = useState('');
  const [resolved, setResolved] = useState<{ name: string; bankCode: string; number: string } | null>(null);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [picker, setPicker] = useState(false);
  const verified = resolved?.bankCode === bankCode && resolved?.number === number ? resolved.name : null;
  const bank = banks.data?.find(item => item.code === bankCode);
  const clearVerification = () => { setResolved(null); setSent(false); setCode(''); action.setError(null); };
  const verify = () => {
    if (!bank || !/^\d{10}$/.test(number) || banks.loading || banks.error) return;
    void action.run('verify', () => resolveBankAccount(number, bankCode), result => {
      if (!result.accountName?.trim()) { action.setError('The bank did not return an account name. Please try again.'); return; }
      setResolved({ name: result.accountName, bankCode, number }); setSent(false); setCode('');
    });
  };
  const send = () => {
    if (!verified || !bank) return;
    void action.run('send', sendPayoutOtp, () => { setSent(true); setCode(''); });
  };
  const save = () => {
    if (!verified || !bank || !sent || !/^\d{6}$/.test(code) || banks.loading || banks.error) return;
    void action.run('save', () => addPayoutAccount({ accountNumber: number, bankCode, otpCode: code }), () => {
      router.replace({ pathname: '/account/[section]', params: { section: 'payouts' } });
    });
  };
  return <AddBankView banks={banks} bankName={bank?.name ?? ''} number={number} code={code} verifiedName={verified} sent={sent} busy={action.busy} error={action.error}
    picker={picker} onPicker={() => { if (!action.inFlight.current) setPicker(true); }} onPickerClose={() => setPicker(false)}
    onBank={value => { if (action.inFlight.current) return; setBankCode(value); clearVerification(); setPicker(false); }}
    onNumber={value => { if (action.inFlight.current) return; setNumber(value.replace(/\D/g, '').slice(0, 10)); clearVerification(); }}
    onCode={value => { if (!action.inFlight.current) setCode(value.replace(/\D/g, '').slice(0, 6)); }} onVerify={verify} onSend={send} onSave={save} />;
}
interface AddBankViewProps {
  banks: FinanceResource<Banks>; bankName: string; number: string; code: string; verifiedName: string | null; sent: boolean; busy: string | null; error: string | null;
  picker: boolean; onPicker: () => void; onPickerClose: () => void; onBank: (value: string) => void; onNumber: (value: string) => void; onCode: (value: string) => void; onVerify: () => void; onSend: () => void; onSave: () => void;
}
export function AddBankView(props: AddBankViewProps) {
  const { colors } = useTheme();
  const busy = Boolean(props.busy);
  const bankButton = useRef<View>(null);
  return <FinancePage title="Add bank account">
    <FinanceCard mint><View style={[styles.inline, { gap: spacing.md }]}><View style={[styles.icon, { width: 36, height: 36, backgroundColor: colors.successSoft }]}><RideIcon name="bank" size={20} color="primary" /></View><View style={styles.copy}><Text variant="button">Your payout account</Text><Text variant="caption" color="textMuted">Add a bank account for withdrawals.</Text></View></View></FinanceCard>
    <FinanceFeedback label="banks" loading={props.banks.loading} error={props.banks.error} onRetry={() => void props.banks.refresh()} />
    {!props.banks.loading && !props.banks.error && props.banks.data?.length === 0 ? <Text variant="caption" color="textMuted">No banks available. Please try again later.</Text> : null}
    <View style={styles.stack}>
      <View style={styles.smallStack}><Text variant="caption" color="textMuted">Bank</Text><Pressable ref={bankButton} accessibilityRole="button" accessibilityLabel="Choose bank" accessibilityState={{ expanded: props.picker, disabled: busy || props.banks.loading || !props.banks.data?.length }} disabled={busy || props.banks.loading || !props.banks.data?.length} onPress={props.onPicker} style={[styles.bank, { minHeight: 48, borderColor: colors.border, backgroundColor: colors.surface }]}><RideIcon name="bank" size={18} /><Text variant="body" style={styles.copy}>{props.bankName || 'Choose your bank'}</Text><RideIcon name="down" size={16} /></Pressable></View>
      <View style={styles.smallStack}><Input label="Account number" accessibilityLabel="Ten digit account number" value={props.number} onChangeText={props.onNumber} keyboardType="number-pad" maxLength={10} editable={!busy} autoComplete="off" placeholder="10-digit account number" /><Text variant="caption" color="textMuted">10-digit Nigerian account number</Text></View>
      <Button label="Verify account name" accessibilityLabel="Verify account name" size="sm" fullWidth variant="outline" loading={props.busy === 'verify'} disabled={busy || props.banks.loading || Boolean(props.banks.error) || !props.bankName || !/^\d{10}$/.test(props.number)} onPress={props.onVerify} />
      {props.verifiedName ? <FinanceCard mint><View style={styles.inline}><View style={[styles.icon, { backgroundColor: colors.success }]}><RideIcon name="check" size={18} color="textInverse" /></View><View style={styles.copy}><Text variant="caption" color="textMuted">Account name confirmed</Text><Text variant="button" selectable>{props.verifiedName}</Text></View></View></FinanceCard> : null}
    </View>
    <View style={[styles.sectionDivider, { borderTopColor: colors.border }]}>
      <View style={styles.smallStack}><Text variant="button" accessibilityRole="header">Verify it’s you</Text><Text variant="caption" color="textMuted">{props.sent ? 'Code sent to your registered phone.' : props.verifiedName ? 'Send a code to your registered phone.' : 'Verify your account name to enable phone verification.'}</Text></View>
      <Button label={props.sent ? 'Resend verification code' : 'Send verification code'} accessibilityLabel="Send bank verification code" leftIcon={<RideIcon name="device" size={18} color="primary" />} size="sm" variant="outline" fullWidth disabled={busy || !props.verifiedName} loading={props.busy === 'send'} onPress={props.onSend} />
      <Input label="Verification code" value={props.code} onChangeText={props.onCode} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" placeholder="Enter 6-digit code" editable={props.sent && !busy} />
      <Button label="Save bank account" accessibilityLabel="Save bank account" size="sm" fullWidth loading={props.busy === 'save'} disabled={busy || !props.verifiedName || !props.sent || !/^\d{6}$/.test(props.code) || props.banks.loading || Boolean(props.banks.error)} onPress={props.onSave} />
    </View>
    {props.error ? <Text variant="caption" color="danger" accessibilityRole="alert">{props.error}</Text> : null}
    <View style={styles.inline}><RideIcon name="lock" size={16} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>Your code is required to save this account.</Text></View>
    <BankPicker visible={props.picker} banks={props.banks.data ?? []} onSelect={props.onBank} onClose={props.onPickerClose} onDismiss={() => { if (Platform.OS === 'web') bankButton.current?.focus(); }} />
  </FinancePage>;

}
export function BankPicker({ visible, banks, onSelect, onClose, onDismiss }: { visible: boolean; banks: Banks; onSelect: (value: string) => void; onClose: () => void; onDismiss?: () => void }) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const close = useRef<View>(null);
  const filtered = banks.filter(bank => bank.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <Modal visible={visible} transparent animationType="slide" onDismiss={onDismiss} onRequestClose={onClose} onShow={() => { setSearch(''); if (Platform.OS === 'web') close.current?.focus(); }}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
      <SafeAreaView edges={['bottom']} style={{ width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.md }}>
        <View style={styles.inline}><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>Choose your bank</Text><Pressable ref={close} accessibilityRole="button" accessibilityLabel="Close bank picker" onPress={onClose} style={styles.back}><RideIcon name="close" size={18} /></Pressable></View>
        <Input label="Search banks" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} placeholder="Search by bank name" />
        <FlatList data={filtered} keyExtractor={bank => bank.code} keyboardShouldPersistTaps="handled" renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => onSelect(item.code)} style={[styles.link, { borderBottomColor: colors.border }]}><RideIcon name="bank" size={18} /><Text variant="body" style={styles.copy}>{item.name}</Text></Pressable>} ListEmptyComponent={<Text variant="caption" color="textMuted">No matching banks.</Text>} />
      </SafeAreaView>
    </View>
  </Modal>;
}

export function WithdrawScreen() {
  const router = useRouter();
  const wallet = useDriverBalance();
  const accounts = useFinanceResource(getPayoutAccounts);
  const action = useFinanceAction();
  const [selected, setSelected] = useState('');
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof requestWithdrawal>> | null>(null);
  const account = accounts.data?.accounts.find(item => item.id === selected) ?? accounts.data?.accounts[0];
  const kobo = withdrawalAmountKobo(amount);
  const valid = Boolean(account && kobo !== null && kobo <= wallet.withdrawableKobo && !wallet.loading && !wallet.error && !accounts.loading && !accounts.error);
  const send = () => {
    if (!valid || result) return;
    void action.run('send', sendWithdrawalOtp, () => { setSent(true); setCode(''); });
  };
  const submit = () => {
    const current = useWalletStore.getState();
    if (!valid || !account || kobo === null || kobo > current.withdrawableKobo || current.loading || current.error || !sent || !/^\d{6}$/.test(code) || result) return;
    void action.run('submit', () => requestWithdrawal(account.id, kobo, code), value => {
      setResult(value); setCode(''); setSent(false); void current.refresh();
    });
  };
  return <WithdrawView wallet={wallet} accounts={accounts} selected={account?.id ?? ''} amount={amount} code={code} sent={sent} valid={valid} busy={action.busy} error={action.error} result={result}
    onAccount={id => { if (!action.inFlight.current) { setSelected(id); setSent(false); setCode(''); action.setError(null); } }}
    onAmount={value => { if (!action.inFlight.current) { setAmount(value); setSent(false); setCode(''); action.setError(null); } }}
    onCode={value => { if (!action.inFlight.current) setCode(value.replace(/\D/g, '').slice(0, 6)); }} onSend={send} onSubmit={submit}
    onAdd={() => router.push({ pathname: '/account/[section]', params: { section: 'add-bank' } })} onPayouts={() => router.replace({ pathname: '/account/[section]', params: { section: 'payouts' } })} />;
}
interface WithdrawViewProps {
  wallet: ReturnType<typeof useDriverBalance>; accounts: FinanceResource<{ accounts: PayoutAccount[] }>; selected: string; amount: string; code: string; sent: boolean; valid: boolean;
  busy: string | null; error: string | null; result: Awaited<ReturnType<typeof requestWithdrawal>> | null;
  onAccount: (value: string) => void; onAmount: (value: string) => void; onCode: (value: string) => void; onSend: () => void; onSubmit: () => void; onAdd: () => void; onPayouts: () => void;
}
export function WithdrawView(props: WithdrawViewProps) {
  const { colors } = useTheme();
  const busy = Boolean(props.busy);
  const kobo = withdrawalAmountKobo(props.amount);
  return <FinancePage title="Withdraw earnings">
    <MoneySummary horizontal label="Available to withdraw" amount={props.wallet.withdrawableKobo} loading={props.wallet.loading} error={props.wallet.error} onRetry={() => void props.wallet.refresh()} />
    {props.result ? <FinanceCard mint><Text variant="button">Withdrawal {withdrawalStatus(props.result.status).label.toLowerCase()}</Text><Text variant="caption" color="textMuted">Check Payouts for the latest status.</Text><Text variant="caption" selectable>Reference: {props.result.reference}</Text><Button label="View payouts" size="sm" onPress={props.onPayouts} /></FinanceCard> : <>
      <View style={styles.smallStack}><FinanceHeading>Bank account</FinanceHeading><FinanceFeedback label="bank accounts" loading={props.accounts.loading} error={props.accounts.error} onRetry={() => void props.accounts.refresh()} />
        {props.accounts.data?.accounts.map(account => <BankAccountCard key={account.id} account={account} selected={props.selected === account.id} disabled={busy || props.accounts.loading || Boolean(props.accounts.error)} onPress={() => props.onAccount(account.id)} />)}
        {props.accounts.data && !props.accounts.loading && !props.accounts.error && !props.accounts.data.accounts.length ? <FinanceEmpty icon="bank" title="No bank account added" detail="Add one before requesting a withdrawal." /> : null}
        <Button label="Add bank account" size="sm" variant="ghost" disabled={busy} onPress={props.onAdd} />
      </View>
      <Input label="Amount (₦)" accessibilityLabel="Withdrawal amount in naira" value={props.amount} onChangeText={props.onAmount} placeholder="Amount in naira" keyboardType="decimal-pad" editable={!busy} />
      {props.amount && kobo === null ? <Text variant="caption" color="danger">Enter a positive amount with no more than two decimal places.</Text> : null}
      {kobo !== null && kobo > props.wallet.withdrawableKobo && !props.wallet.loading && !props.wallet.error ? <Text variant="caption" color="danger">Amount exceeds your available balance.</Text> : null}
      <Text variant="button" accessibilityRole="header">Verify withdrawal</Text><Text variant="caption" color="textMuted">{props.sent ? 'Code sent to your registered phone.' : 'Send a code to your registered phone.'}</Text>
      <Button label={props.sent ? 'Resend verification code' : 'Send verification code'} leftIcon={<RideIcon name="device" size={18} color="primary" />} accessibilityLabel="Send withdrawal verification code" size="sm" variant="outline" disabled={busy || !props.valid} loading={props.busy === 'send'} onPress={props.onSend} />
      <Input label="Verification code" value={props.code} onChangeText={props.onCode} placeholder="Enter 6-digit code" keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} editable={props.sent && !busy} />
      <View style={[styles.summaryStrip, { backgroundColor: colors.surfaceMuted }]}><View style={styles.inline}><Text variant="caption" color="textMuted" style={styles.copy}>Withdrawal amount</Text><Text variant="button">{kobo !== null ? formatNaira(kobo) : '—'}</Text></View></View>
      <Button label="Request withdrawal" accessibilityLabel="Request withdrawal" fullWidth size="sm" loading={props.busy === 'submit'} disabled={busy || !props.valid || !props.sent || !/^\d{6}$/.test(props.code)} onPress={props.onSubmit} />
      {props.error ? <><Text variant="caption" color="danger" accessibilityRole="alert">{props.error}</Text><Text variant="caption" color="textMuted">If a request could not be confirmed, check Payouts before trying again.</Text></> : null}
      <FinanceLink icon="safety" subtle label="Track requests in Payouts" onPress={props.onPayouts} />
    </>}
  </FinancePage>;
}
