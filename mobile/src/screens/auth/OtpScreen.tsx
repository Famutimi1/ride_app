/**
 * OtpScreen — verifies the 6-digit code (route: "/otp"). Screen 3 in the mockup.
 *
 * UI trick: instead of six fiddly text fields, we render six read-only "boxes" and
 * lay ONE invisible TextInput over them. Tapping the boxes focuses that hidden
 * input; whatever digits it holds get painted into the boxes. This is the least
 * buggy way to do OTP entry in React Native (no ref juggling, backspace just works).
 *
 * On the 6th digit we auto-submit. A correct code either sends new users to the
 * profile step or drops returning users straight home; a wrong one clears and re-asks.
 */
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { BackButton, Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { MOCK_OTP_CODE } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

/** 30 → "00:30". A tiny mm:ss formatter for the resend countdown. */
function formatCountdown(totalSeconds: number): string {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function OtpScreen() {
  const theme = useTheme();
  const router = useRouter();

  const phone = useAuthStore((s) => s.pending?.phone);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const requestOtp = useAuthStore((s) => s.requestOtp);

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);

  // Simple resend countdown: tick down to 0, then allow another send.
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const submit = async (value: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const { needsProfile } = await verifyOtp(value);
      // replace(), not push(), so Back doesn't return to the code screen post-login.
      if (needsProfile) router.replace('/profile');
      else router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed. Try again.');
      setCode(''); // wipe the wrong code so they can retype cleanly
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const onChange = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(next);
    if (error) setError(undefined);
    if (next.length === CODE_LENGTH) submit(next);
  };

  const onResend = async () => {
    if (seconds > 0 || !phone) return;
    setCode('');
    setError(undefined);
    await requestOtp(phone);
    setSeconds(RESEND_SECONDS);
  };

  // If we somehow land here without a phone in flight (e.g. deep link), start over.
  if (!phone) return <Redirect href="/phone" />;

  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flex: 1,
          paddingTop: theme.spacing['3xl'],
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.xl,
          gap: theme.spacing.xl,
        }}
      >
        <BackButton onPress={() => router.back()} />

        {/* Centred title — the mockup pins "OTP" in the middle of the screen top. */}
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="h2">OTP</Text>
          <Text variant="body" color="textMuted" style={{ textAlign: 'center' }}>
            Enter the 6-digit code we sent to {phone}.
          </Text>
        </View>

        {/* The six boxes + the invisible input laid on top of them. */}
        <Pressable onPress={() => inputRef.current?.focus()}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.sm }}>
            {boxes.map((digit, i) => {
              const isActive = focused && i === code.length;
              const borderColor = error
                ? theme.colors.danger
                : isActive
                  ? theme.colors.primary
                  : theme.colors.border;
              return (
                <View
                  key={i}
                  style={{
                    width: 48,
                    height: 56,
                    borderRadius: theme.radius.md,
                    borderWidth: isActive ? 2 : 1,
                    borderColor,
                    backgroundColor: theme.colors.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="h3">{digit}</Text>
                </View>
              );
            })}
          </View>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoFocus
            caretHidden
            // Enable OS autofill of the SMS code (iOS + Android).
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          />
        </Pressable>

        {error ? (
          <Text variant="caption" color="danger" style={{ textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}

        {/* Dev-only hint so the flow is testable without a real SMS. Remove when the
            backend actually sends codes. */}
        <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
          Testing? Use code {MOCK_OTP_CODE}.
        </Text>

        <View style={{ flex: 1 }} />

        <View style={{ gap: theme.spacing.md }}>
          <Button
            label="Verify Now"
            fullWidth
            loading={loading}
            disabled={code.length !== CODE_LENGTH}
            onPress={() => submit(code)}
          />
          <Pressable onPress={onResend} disabled={seconds > 0} hitSlop={8}>
            <Text
              variant="caption"
              color={seconds > 0 ? 'textMuted' : 'primary'}
              style={{ textAlign: 'center' }}
            >
              {seconds > 0 ? `Resend code in ${formatCountdown(seconds)}` : 'Resend code'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
