/**
 * PhoneScreen — collects the user's phone number and requests an OTP (route: "/phone").
 *
 * Nigeria-friendly input: we show a fixed "+234" prefix and the user types the rest
 * (their number without the leading 0). We normalise as they type so a valid number
 * is exactly 10 digits, then hand the full "+234…" string to the store.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, Input, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

import { AuthScreenLayout } from './AuthScreenLayout';

/** Strip anything non-numeric, drop a leading 0, and cap at 10 digits. */
function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function PhoneScreen() {
  const router = useRouter();
  const requestOtp = useAuthStore((s) => s.requestOtp);

  const [local, setLocal] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const isValid = local.length === 10;
  const fullPhone = `+234${local}`;

  const onSend = async () => {
    if (!isValid || loading) return;
    setError(undefined);
    setLoading(true);
    try {
      await requestOtp(fullPhone);
      router.push('/otp');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreenLayout
      title="What's your number?"
      subtitle="We'll text you a 6-digit code to confirm it's you."
      onBack={() => router.back()}
      footer={
        <Button label="Send code" fullWidth onPress={onSend} loading={loading} disabled={!isValid} />
      }
    >
      <Input
        label="Phone number"
        value={local}
        onChangeText={(t) => {
          setLocal(normalizeLocalNumber(t));
          if (error) setError(undefined);
        }}
        placeholder="801 234 5678"
        keyboardType="phone-pad"
        autoFocus
        maxLength={10}
        error={error}
        leftIcon={<Text variant="body">+234</Text>}
      />
    </AuthScreenLayout>
  );
}
