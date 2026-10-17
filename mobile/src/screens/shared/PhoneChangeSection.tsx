import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Input, Text } from '@/components/common';
import { apiErrorMessage } from '@/lib/apiClient';
import { requestPhoneChange } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';
import {useTripStore} from '@/store/tripStore';

export function PhoneChangeSection() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ token: string; phone: string; userId: string; resendAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewed=useAuthStore(state=>state.driverApplication?.status==='approved');
  const trip=useTripStore(state=>state.trip);
  const locked=reviewed||Boolean(trip&&['driver_assigned','driver_arrived','in_progress','returning'].includes(trip.status));
  const request = async () => {
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;
    setBusy(true); setError(null);
    try {
      const result = await requestPhoneChange(phone);
      if (useAuthStore.getState().session?.user.id !== userId) return;
      setChallenge({ token: result.challenge, phone: result.phone, userId, resendAt: Date.now() + result.retryAfterSeconds * 1000 });
      setCode('');
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!challenge || useAuthStore.getState().session?.user.id !== challenge.userId) return;
    setBusy(true); setError(null);
    try {
      await useAuthStore.getState().changePhone(challenge.token, code);
      setChallenge(null); setPhone(''); setCode('');
      Alert.alert('Phone updated', 'Use your new phone number the next time you sign in.');
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  if(locked)return <View className="mt-lg gap-md"><Text variant="bodyMedium">Phone identity</Text><Text variant="caption" color="textMuted">Changing reviewed driver identity requires staff review. Identity changes are unavailable during an active trip.</Text></View>;
  return <View className="mt-lg gap-md">
    <Text variant="bodyMedium">Change phone number</Text>
    <Input label="New Nigerian phone number" value={phone} editable={!busy && !challenge} onChangeText={setPhone} keyboardType="phone-pad" />
    {challenge ? <>
      <Text variant="caption" color="textMuted">Enter the code sent to {challenge.phone}. It expires after five minutes.</Text>
      <Input label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} editable={!busy} />
      <Button label="Verify and change phone" loading={busy} disabled={!/^\d{6}$/.test(code)} onPress={() => { void confirm(); }} />
      <Button label="Resend code" variant="outline" disabled={busy} onPress={() => {
        if (Date.now() < challenge.resendAt) { setError(`Wait ${Math.ceil((challenge.resendAt - Date.now()) / 1000)} seconds before requesting another code.`); return; }
        void request();
      }} />
      <Button label="Cancel phone change" variant="outline" disabled={busy} onPress={() => { setChallenge(null); setCode(''); setError(null); }} />
    </> : <Button label="Send verification code" variant="outline" loading={busy} disabled={!phone.trim()} onPress={() => { void request(); }} />}
    {error ? <Text color="danger">{error}</Text> : null}
  </View>;
}
