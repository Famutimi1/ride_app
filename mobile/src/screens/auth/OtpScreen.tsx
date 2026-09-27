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
import { cssInterop } from 'nativewind';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

/** 30 → "00:30". A tiny mm:ss formatter for the resend countdown. */
function formatCountdown(totalSeconds: number): string {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function OtpScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const isTallScreen = height >= 800;

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
      await verifyOtp(value);
      // replace(), not push(), so Back doesn't return to the code screen post-login.
      router.replace('/home');
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
    <StyledSafeAreaView edges={['top', 'bottom']} className="flex-1">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 bg-background">
          <View className="px-[34px] pb-xl pt-[42px]">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={12}
              onPress={() => router.back()}
              className="h-6 w-6 items-start justify-center"
            >
              <Text variant="body" className="!text-[24px] !leading-[24px]">
                ←
              </Text>
            </Pressable>

            {/* Centred title — the mockup pins "OTP" in the middle of the screen
                top, with a small "1 2 3 4 5 6" index row directly beneath it. */}
            <View className="mt-[58px] items-center gap-xs">
              <Text
                variant="h2"
                className={isTallScreen ? '!text-[26px] !leading-[32px]' : '!text-[20px] !leading-[26px]'}
              >
                OTP
              </Text>
              <Text
                variant="caption"
                color="textMuted"
                className={`${isTallScreen ? '!text-[14px]' : '!text-[12px]'} tracking-[4px]`}
              >
                1 2 3 4 5 6
              </Text>
            </View>

            {/* The six boxes + the invisible input laid on top of them. */}
            <Pressable className="mt-[29px]" onPress={() => inputRef.current?.focus()}>
              <View className="flex-row justify-center gap-md">
                {boxes.map((digit, i) => {
                  const isActive = focused && i === code.length;
                  const borderClass = error
                    ? 'border-danger'
                    : isActive
                      ? 'border-primary'
                      : 'border-border';
                  return (
                    <View
                      key={i}
                      className={`h-[44px] w-[32px] items-center justify-center rounded-[5px] bg-surfaceMuted ${
                        isActive ? 'border-2' : 'border'
                      } ${borderClass}`}
                    >
                      <Text variant="h3" className={isTallScreen ? '!text-[22px]' : '!text-[18px]'}>
                        {digit}
                      </Text>
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
                className="absolute h-px w-px opacity-0"
              />
            </Pressable>

            {error ? (
              <Text variant="caption" color="danger" className="text-center">
                {error}
              </Text>
            ) : null}

            {/* Fixed gap (not a flex-1 spacer) — the mockup keeps the button and
                resend link anchored below the boxes, with leftover space at the
                very bottom of the screen rather than the CTA being pinned there. */}
            <View className="mt-[70px] gap-xl">
              <Button
                label="Verify Now"
                fullWidth
                loading={loading}
                disabled={code.length !== CODE_LENGTH}
                onPress={() => submit(code)}
                className="h-[40px] rounded-[8px]"
              />
              <Pressable onPress={onResend} disabled={seconds > 0} hitSlop={8}>
                <Text
                  variant="caption"
                  color={seconds > 0 ? 'textMuted' : 'primary'}
                  className={`${isTallScreen ? '!text-[13px]' : '!text-[11px]'} text-center`}
                >
                  {seconds > 0 ? `Resend code in ${formatCountdown(seconds)}` : 'Resend code'}
                </Text>
              </Pressable>
            </View>

          </View>
        </View>
      </KeyboardAvoidingView>
    </StyledSafeAreaView>
  );
}
