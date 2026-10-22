import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Text } from '@/components/common';
import { radius, spacing, useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';
import { requestPhoneChange } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';
import { useTripStore } from '@/store/tripStore';
import { profileIdentityNotice } from '@/utils/profileIdentity';

export function PhoneChangeSection({ onClose }: { onClose?: () => void }) {
  const { colors } = useTheme();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ token: string; phone: string; userId: string; resendAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reviewed = useAuthStore(state => state.driverApplication?.status === 'approved');
  const trip = useTripStore(state => state.trip);
  const locked = profileIdentityNotice(reviewed, trip?.status);
  const identityLocked = () => profileIdentityNotice(useAuthStore.getState().driverApplication?.status === 'approved', useTripStore.getState().trip?.status);

  const request = async () => {
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId || inFlight.current || identityLocked() || !phone.trim()) return;
    if (challenge && Date.now() < challenge.resendAt) {
      setError(`Wait ${Math.ceil((challenge.resendAt - Date.now()) / 1000)} seconds before requesting another code.`);
      return;
    }
    inFlight.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await requestPhoneChange(phone);
      if (useAuthStore.getState().session?.user.id !== userId || identityLocked()) return;
      setChallenge({ token: result.challenge, phone: result.phone, userId, resendAt: Date.now() + result.retryAfterSeconds * 1000 });
      setCode('');
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const confirm = async () => {
    if (inFlight.current || identityLocked() || !challenge || !/^\d{6}$/.test(code) || useAuthStore.getState().session?.user.id !== challenge.userId) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      await useAuthStore.getState().changePhone(challenge.token, code);
      setChallenge(null); setPhone(''); setCode('');
      setNotice('Phone updated. Use your new number the next time you sign in.');
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (locked) return null;
  return <View style={{ marginTop: spacing.md, padding: spacing.md, gap: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted }}>
    <Text variant="button" accessibilityRole="header">Change phone number</Text>
    <Input label="New Nigerian phone number" value={phone} editable={!busy && !challenge} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
    {challenge ? <>
      <Text variant="caption" color="textMuted">Enter the code sent to {challenge.phone}. It expires after five minutes.</Text>
      <Input label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} editable={!busy} />
      <Button label="Verify and change phone" accessibilityLabel="Verify and change phone" size="sm" loading={busy} disabled={!/^\d{6}$/.test(code)} onPress={() => { void confirm(); }} />
      <Button label="Resend code" size="sm" variant="outline" disabled={busy} onPress={() => { void request(); }} />
    </> : <Button label="Send verification code" accessibilityLabel="Send verification code" size="sm" variant="outline" loading={busy} disabled={!phone.trim()} onPress={() => { void request(); }} />}
    <Button label={notice ? 'Done' : 'Cancel phone change'} size="sm" variant="ghost" disabled={busy} onPress={() => {
      if (inFlight.current) return;
      setChallenge(null); setPhone(''); setCode(''); setError(null); setNotice(null); onClose?.();
    }} />
    {error ? <Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text> : null}
    {notice ? <Text variant="caption" color="success" accessibilityRole="alert">{notice}</Text> : null}
  </View>;
}
