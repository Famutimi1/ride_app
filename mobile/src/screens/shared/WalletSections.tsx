import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';
import { useWalletStore } from '@/store/walletStore';
import { addPayoutAccount, createTopup, formatNaira, getBanks, getEarningsSummary, getPayoutAccounts, getTopup, getWalletTransactions, getWithdrawals, requestWithdrawal, resolveBankAccount, sendPayoutOtp, sendWithdrawalOtp, type EarningsSummary, type PayoutAccount, type WalletEntry, type Withdrawal } from '@/services/paymentService';

function useWalletEntries(account:'wallet'|'earnings') {
  const [entries,setEntries]=useState<WalletEntry[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [cursor,setCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const load=async(next?:string)=>{setLoading(true);try{const result=await getWalletTransactions(account,next);setEntries((current)=>next?[...current,...result.items]:result.items);setCursor(result.nextCursor);setError(null);}catch(reason){setError(apiErrorMessage(reason));}finally{setLoading(false);}};
  useEffect(()=>{let active=true;void getWalletTransactions(account).then((result)=>{if(active){setEntries(result.items);setCursor(result.nextCursor);setError(null);}}).catch((reason)=>{if(active)setError(apiErrorMessage(reason));});return()=>{active=false;};},[account]);
  return {entries,error,cursor,loading,load};
}
function Statement({account}:{account:'wallet'|'earnings'}) {
  const {entries,error,cursor,loading,load}=useWalletEntries(account);
  return <View className="mt-lg"><Text variant="bodyMedium">Recent activity</Text>{error?<Text color="danger" className="mt-sm">{error}</Text>:null}
    {entries.length===0&&!loading?<Text color="textMuted" className="mt-md">No transactions yet.</Text>:null}
    {entries.map((entry)=>{const moneyIn=(account==='wallet'?entry.direction==='credit':entry.direction==='credit');return <View key={entry.id} className="flex-row items-center justify-between border-b border-border py-md"><View className="flex-1 pr-sm"><Text variant="bodyMedium">{entry.description??entry.type.replaceAll('_',' ')}</Text><Text variant="caption" color="textMuted">{new Date(entry.createdAt).toLocaleString()} · Balance {formatNaira(entry.balanceAfterKobo)}</Text></View><Text color={moneyIn?'success':'danger'}>{moneyIn?'+':'−'}{formatNaira(entry.amountKobo)}</Text></View>;})}
    {cursor?<Button label={loading?'Loading…':'View more'} variant="outline" className="mt-md" disabled={loading} onPress={()=>void load(cursor)} />:null}
  </View>;
}
export function RiderWalletSection() {
  const router=useRouter();const wallet=useWalletStore();const refresh=useWalletStore((state)=>state.refresh);
  useEffect(()=>{void refresh();},[refresh]);
  return <><View className="rounded-2xl bg-primarySoft p-lg"><Text variant="caption" color="primary">RIDE WALLET</Text><Text variant="h2" className="mt-xs">{formatNaira(wallet.walletKobo)}</Text><Text variant="caption" color="textMuted">Available for wallet rides</Text><Button label="Top up" className="mt-lg" onPress={()=>router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}})} /></View>
    {wallet.error?<Text color="danger" className="mt-md">{wallet.error}</Text>:null}<Statement account="wallet" /></>;
}
export function TopUpSection() {
  const {target:targetParam,reference:returnedReference,trxref}=useLocalSearchParams<{target?:string;reference?:string;trxref?:string}>();
  const target=targetParam==='earnings'?'earnings':'wallet';
  const refresh=useWalletStore((state)=>state.refresh);const theme=useTheme();
  const callbackReference=returnedReference??trxref??null;
  const [amount,setAmount]=useState('');const [reference,setReference]=useState<string|null>(callbackReference);
  const [status,setStatus]=useState<string|null>(callbackReference?'pending':null);const [busy,setBusy]=useState(false);
  const amountKobo=Number(amount)*100;
  useEffect(()=>{
    if(!reference||status==='succeeded'||status==='failed'||status==='mismatch'||status==='still_processing')return;
    let active=true;
    const tick=async()=>{try{const result=await getTopup(reference);if(active){setStatus(result.status);if(result.status==='succeeded')void refresh();}}catch{}}
    void tick();const timer=setInterval(()=>void tick(),3000);
    const timeout=setTimeout(()=>{clearInterval(timer);if(active&&status==='pending')setStatus('still_processing');},60000);
    return()=>{active=false;clearInterval(timer);clearTimeout(timeout);};
  },[reference,status,refresh]);
  const begin=async()=>{
    if(!Number.isSafeInteger(amountKobo)||amountKobo<=0)return Alert.alert('Enter an amount','Use a whole naira amount.');
    setBusy(true);try{const payment=await createTopup(amountKobo,target);setReference(payment.reference);setStatus('pending');
      await WebBrowser.openBrowserAsync(payment.authorizationUrl);
    }catch(error){Alert.alert('Top-up unavailable',apiErrorMessage(error));}finally{setBusy(false);}
  };
  return <><Text variant="h3">{target==='earnings'?'Pay cash commission':'Add money to your wallet'}</Text><Text color="textMuted" className="mt-sm">Pay securely with Paystack. Your balance updates only after we verify the payment.</Text>
    <View className="mt-lg flex-row gap-sm">{[1000,2000,5000].map((value)=><Pressable key={value} onPress={()=>setAmount(String(value))} className="rounded-full bg-primarySoft px-md py-sm"><Text color="primary">{formatNaira(value*100)}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="Top-up amount in naira" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="Amount in naira" placeholderTextColor={theme.colors.textMuted} className="mt-md h-14 rounded-xl border border-borderStrong bg-surface px-md text-text outline-none" />
    <Button label={busy?'Opening Paystack…':'Continue to Paystack'} fullWidth className="mt-lg" disabled={busy} onPress={()=>void begin()} />
    {status?<View className="mt-lg rounded-xl bg-surfaceMuted p-md"><Text variant="bodyMedium">{status==='succeeded'?'Payment confirmed':status==='pending'?'Confirming payment…':status==='still_processing'?'Still processing; your wallet will update when confirmed':status==='mismatch'?'Payment needs review':`Payment ${status}`}</Text><Text variant="caption" color="textMuted" className="mt-sm">Reference: {reference}</Text>{status!=='succeeded'?<Button label="Check again" variant="outline" className="mt-md" onPress={()=>{setStatus('pending');}} />:null}</View>:null}
  </>;
}
export function DriverWalletSection() {
  const router=useRouter();const wallet=useWalletStore();const refresh=useWalletStore((state)=>state.refresh);
  useEffect(()=>{void refresh();},[refresh]);
  return <><View className="rounded-2xl bg-successSoft p-lg"><Text variant="caption" color="success">WITHDRAWABLE EARNINGS</Text><Text variant="h2" className="mt-xs">{formatNaira(wallet.withdrawableKobo)}</Text><Button label="Withdraw" fullWidth className="mt-lg" disabled={wallet.withdrawableKobo<=0} onPress={()=>router.push({pathname:'/account/[section]',params:{section:'withdraw'}})} /></View>
    {wallet.owedKobo>0?<View className="mt-md rounded-xl bg-dangerSoft p-md"><Text variant="bodyMedium" color="danger">You owe {formatNaira(wallet.owedKobo)} in cash commission</Text><Text variant="caption" color="textMuted" className="mt-xs">{wallet.canGoOnline?'Pay now or earn it off through wallet rides.':'You cannot go online until the balance is below the limit.'}</Text><Button label="Pay now" className="mt-md" onPress={()=>router.push({pathname:'/account/[section]',params:{section:'top-up',target:'earnings'}})} /></View>:null}
    <View className="mt-lg"><Button label="Earnings breakdown" variant="outline" fullWidth onPress={()=>router.push({pathname:'/account/[section]',params:{section:'driver-earnings'}})} /><Button label="Bank accounts and payouts" variant="outline" fullWidth className="mt-sm" onPress={()=>router.push({pathname:'/account/[section]',params:{section:'payouts'}})} /></View>
    <Statement account="earnings" /></>;
}
export function DriverEarningsSection() {
  const [range,setRange]=useState<'today'|'week'|'month'>('week');
  const [summary,setSummary]=useState<EarningsSummary|null>(null);
  useEffect(()=>{void getEarningsSummary(range).then(setSummary).catch(()=>setSummary(null));},[range]);
  return <><View className="flex-row gap-sm">{(['today','week','month'] as const).map((item)=><Pressable key={item} onPress={()=>setRange(item)} className={`rounded-full px-md py-sm ${range===item?'bg-primary':'bg-surfaceMuted'}`}><Text color={range===item?'textInverse':'textMuted'}>{item}</Text></Pressable>)}</View>
    <View className="mt-lg rounded-2xl bg-successSoft p-lg"><Text variant="caption" color="success">NET EARNINGS</Text><Text variant="h2" className="mt-sm">{formatNaira(summary?.netKobo??0)}</Text><Text color="textMuted" className="mt-xs">{summary?.trips??0} completed trips</Text></View>
    <View className="mt-lg rounded-xl border border-border bg-surface p-md"><MoneyLine label="Gross fares" amount={summary?.grossKobo??0} /><MoneyLine label="Commission" amount={-(summary?.commissionKobo??0)} /><MoneyLine label="Net" amount={summary?.netKobo??0} /></View>
    <Text color="textMuted" className="mt-md">{summary?.cashTrips??0} cash trips · {summary?.walletTrips??0} wallet trips</Text><Statement account="earnings" /></>;
}
function MoneyLine({label,amount}:{label:string;amount:number}) {return <View className="flex-row justify-between border-b border-border py-sm"><Text color="textMuted">{label}</Text><Text color={amount<0?'danger':'success'}>{formatNaira(amount)}</Text></View>;}

export function PayoutsSection() {
  const router=useRouter();const [accounts,setAccounts]=useState<PayoutAccount[]>([]);const [withdrawals,setWithdrawals]=useState<Withdrawal[]>([]);
  const refresh=()=>{void getPayoutAccounts().then((value)=>setAccounts(value.accounts)).catch(()=>{});void getWithdrawals().then((value)=>setWithdrawals(value.withdrawals)).catch(()=>{});};
  useEffect(refresh,[]);
  return <><Text variant="bodyMedium">Bank accounts</Text>{accounts.map((account)=><View key={account.id} className="mt-sm rounded-xl border border-border p-md"><Text variant="bodyMedium">{account.bank_name} ·••••{account.account_last4}</Text><Text color="textMuted">{account.account_name}</Text></View>)}
    {!accounts.length?<Text color="textMuted" className="mt-sm">No bank account added yet.</Text>:null}
    <Button label="Add bank account" variant="outline" fullWidth className="mt-md" onPress={()=>router.push({pathname:'/account/[section]',params:{section:'add-bank'}})} />
    <Button label="Request withdrawal" fullWidth className="mt-sm" disabled={!accounts.length} onPress={()=>router.push({pathname:'/account/[section]',params:{section:'withdraw'}})} />
    <Text variant="bodyMedium" className="mt-xl">Withdrawal history</Text>{withdrawals.map((item)=><View key={item.id} className="flex-row justify-between border-b border-border py-md"><View><Text variant="bodyMedium">{item.bank_name} ·••••{item.account_last4}</Text><Text color="textMuted">{new Date(item.requested_at).toLocaleString()} · {item.status}</Text></View><Text>{formatNaira(item.amount_kobo)}</Text></View>)}
    {!withdrawals.length?<Text color="textMuted" className="mt-sm">No withdrawals yet.</Text>:null}</>;
}
export function AddBankSection() {
  const theme=useTheme();const router=useRouter();
  const [banks,setBanks]=useState<{name:string;code:string}[]>([]);const [bankCode,setBankCode]=useState('');
  const [number,setNumber]=useState('');const [resolved,setResolved]=useState('');const [otp,setOtp]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{void getBanks().then(setBanks).catch(()=>{});},[]);
  const resolve=async()=>{setBusy(true);try{const result=await resolveBankAccount(number,bankCode);setResolved(result.accountName);}catch(error){Alert.alert('Could not verify account',apiErrorMessage(error));}finally{setBusy(false);}};
  const save=async()=>{setBusy(true);try{await addPayoutAccount({accountNumber:number,bankCode,otpCode:otp});router.replace({pathname:'/account/[section]',params:{section:'payouts'}});}catch(error){Alert.alert('Could not add bank account',apiErrorMessage(error));}finally{setBusy(false);}};
  return <><Text variant="bodyMedium">Choose your bank</Text><ScrollView className="mt-sm max-h-48 rounded-xl border border-border bg-surface" nestedScrollEnabled>{banks.map((bank)=><Pressable key={bank.code} onPress={()=>{setBankCode(bank.code);setResolved('');}} className="border-b border-border p-sm"><Text color={bankCode===bank.code?'primary':'text'}>{bank.name}</Text></Pressable>)}</ScrollView>
    <TextInput accessibilityLabel="Ten digit account number" value={number} onChangeText={(value)=>{setNumber(value.replace(/\D/g,'').slice(0,10));setResolved('');}} keyboardType="number-pad" placeholder="10-digit account number" placeholderTextColor={theme.colors.textMuted} className="mt-md h-14 rounded-xl border border-borderStrong bg-surface px-md text-text outline-none" />
    <Button label="Verify account name" variant="outline" fullWidth className="mt-md" disabled={busy||!bankCode||number.length!==10} onPress={()=>void resolve()} />
    {resolved?<><View className="mt-md rounded-xl bg-successSoft p-md"><Text color="success">Bank confirmed: {resolved}</Text></View><Button label="Send verification code" variant="outline" className="mt-md" onPress={()=>void sendPayoutOtp().then(()=>Alert.alert('Code sent','Enter the code sent to your phone.')).catch((error)=>Alert.alert('Could not send code',apiErrorMessage(error)))} /><TextInput accessibilityLabel="Bank verification code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} placeholder="Six-digit code" placeholderTextColor={theme.colors.textMuted} className="mt-md h-14 rounded-xl border border-borderStrong bg-surface px-md text-text outline-none" /><Button label="Save bank account" fullWidth className="mt-md" disabled={busy||otp.length!==6} onPress={()=>void save()} /></>:null}</>;
}
export function WithdrawSection() {
  const theme=useTheme();const wallet=useWalletStore();const refresh=useWalletStore((state)=>state.refresh);const [accounts,setAccounts]=useState<PayoutAccount[]>([]);
  const [selected,setSelected]=useState('');const [amount,setAmount]=useState('');const [otp,setOtp]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{void getPayoutAccounts().then((value)=>{setAccounts(value.accounts);setSelected(value.accounts[0]?.id??'');});void refresh();},[refresh]);
  const amountKobo=Number(amount)*100;
  const submit=async()=>{setBusy(true);try{const result=await requestWithdrawal(selected,amountKobo,otp);await wallet.refresh();Alert.alert('Withdrawal requested',`Reference ${result.reference}. Track its status in Payouts.`);}catch(error){Alert.alert('Withdrawal unavailable',apiErrorMessage(error));}finally{setBusy(false);}};
  return <><View className="rounded-2xl bg-successSoft p-lg"><Text color="success">Available to withdraw</Text><Text variant="h2">{formatNaira(wallet.withdrawableKobo)}</Text></View>
    <Text variant="bodyMedium" className="mt-lg">Bank account</Text>{accounts.map((account)=><Pressable key={account.id} onPress={()=>setSelected(account.id)} className="flex-row justify-between border-b border-border py-md"><Text>{account.bank_name} ·••••{account.account_last4}</Text><Text color="primary">{selected===account.id?'●':'○'}</Text></Pressable>)}
    <TextInput accessibilityLabel="Withdrawal amount in naira" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="Amount in naira" placeholderTextColor={theme.colors.textMuted} className="mt-md h-14 rounded-xl border border-borderStrong bg-surface px-md text-text outline-none" />
    <Button label="Send verification code" variant="outline" className="mt-md" onPress={()=>void sendWithdrawalOtp().then(()=>Alert.alert('Code sent','Enter the code sent to your phone.')).catch((error)=>Alert.alert('Could not send code',apiErrorMessage(error)))} />
    <TextInput accessibilityLabel="Withdrawal verification code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} placeholder="Six-digit code" placeholderTextColor={theme.colors.textMuted} className="mt-md h-14 rounded-xl border border-borderStrong bg-surface px-md text-text outline-none" />
    <Button label="Request withdrawal" fullWidth className="mt-md" disabled={busy||!selected||otp.length!==6||!Number.isSafeInteger(amountKobo)||amountKobo<=0||amountKobo>wallet.withdrawableKobo} onPress={()=>void submit()} /></>;
}
