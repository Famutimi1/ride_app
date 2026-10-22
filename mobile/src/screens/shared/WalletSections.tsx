import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';
import { useWalletStore } from '@/store/walletStore';
import { createTopup, formatNaira, getTopup } from '@/services/paymentService';
import { useAuthStore } from '@/store/authStore';

export function TopUpSection() {
  const {reference:returnedReference,trxref}=useLocalSearchParams<{reference?:string;trxref?:string}>();
  const user = useAuthStore(state => state.session?.user);
  const target=user?.role==='driver'?'earnings':'wallet';
  const refresh=useWalletStore((state)=>state.refresh);const theme=useTheme();
  const callbackReference=returnedReference??trxref??null;
  const [amount,setAmount]=useState('');const [reference,setReference]=useState<string|null>(callbackReference);
  const [status,setStatus]=useState<string|null>(callbackReference?'pending':null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const amountKobo=Number(amount)*100;
  useEffect(()=>{
    if(!reference||status==='succeeded'||status==='failed'||status==='mismatch'||status==='still_processing'||status==='other_mode')return;
    let active=true;
    const tick=async()=>{try{const result=await getTopup(reference);if(active){if(result.target!==target){setStatus('other_mode');return;}setStatus(result.status);if(result.status==='succeeded')void refresh();}}catch{}}
    void tick();const timer=setInterval(()=>void tick(),3000);
    const timeout=setTimeout(()=>{clearInterval(timer);if(active&&status==='pending')setStatus('still_processing');},60000);
    return()=>{active=false;clearInterval(timer);clearTimeout(timeout);};
  },[reference,status,refresh,target]);
  const begin=async()=>{
    const current=useAuthStore.getState().session?.user;
    if(!user||current?.id!==user.id||current.role!==user.role||busy)return;
    setError(null);
    if(!Number.isSafeInteger(amountKobo)||amountKobo<=0){setError('Enter a whole naira amount.');return;}
    setBusy(true);try{const payment=await createTopup(amountKobo,target);const current=useAuthStore.getState().session?.user;if(current?.id!==user.id||current.role!==user.role)return;setReference(payment.reference);setStatus('pending');
      await WebBrowser.openBrowserAsync(payment.authorizationUrl);
    }catch(reason){setError(apiErrorMessage(reason));}finally{setBusy(false);}
  };
  return <><Text variant="h3">{target==='earnings'?'Pay cash commission':'Add money to your wallet'}</Text><Text color="textMuted" className="mt-sm">Pay securely with Paystack. Your balance updates only after we verify the payment.</Text>
    <View className="mt-lg flex-row gap-sm">{[1000,2000,5000].map((value)=><Pressable key={value} onPress={()=>setAmount(String(value))} className="rounded-full bg-primarySoft px-md py-sm"><Text color="primary">{formatNaira(value*100)}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="Top-up amount in naira" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="Amount in naira" placeholderTextColor={theme.colors.textMuted} className="mt-md min-h-12 rounded-xl border border-borderStrong bg-surface px-md py-md font-inter-regular text-body text-text outline-none" />
    <Button label={busy?'Opening Paystack…':'Continue to Paystack'} fullWidth className="mt-lg" disabled={busy} onPress={()=>void begin()} />
    {error?<Text color="danger" className="mt-sm">{error}</Text>:null}
    {status?<View className="mt-lg rounded-xl bg-surfaceMuted p-md"><Text variant="bodyMedium">{status==='other_mode'?'Switch modes from the menu to view this payment.':status==='succeeded'?'Payment confirmed':status==='pending'?'Confirming payment…':status==='still_processing'?'Still processing; your balance will update when confirmed':status==='mismatch'?'Payment needs review':`Payment ${status}`}</Text>{status!=='other_mode'?<Text variant="caption" color="textMuted" className="mt-sm">Reference: {reference}</Text>:null}{status!=='succeeded'&&status!=='other_mode'?<Button label="Check again" variant="outline" className="mt-md" onPress={()=>{setStatus('pending');}} />:null}</View>:null}
  </>;
}
