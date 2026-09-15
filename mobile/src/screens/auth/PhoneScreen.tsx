/**
 * PhoneScreen — collects the user's phone number and requests an OTP (route:
 * "/phone"). This is screen 2 in the design mockup.
 *
 * Nigeria-friendly input: a "+234" country selector sits next to the number field,
 * and the user types their line without the leading 0. We normalise as they type so
 * a valid number is exactly 10 digits, then hand the full "+234…" string to the store.
 *
 * The mockup shows the number in two places (a "Phone number" field up top and an
 * "Enter phone number" field in the country-code row). We keep both bound to the
 * SAME value so they always agree — editing either edits the one real number.
 */
import { useRouter } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

/** Strip anything non-numeric, drop a leading 0, and cap at 10 digits. */
function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function PhoneScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const isTallScreen = height >= 800;
  const requestOtp = useAuthStore((s) => s.requestOtp);

  const [local, setLocal] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const isValid = local.length === 10;
  const fullPhone = `+234${local}`;

  const onChange = (t: string) => {
    setLocal(normalizeLocalNumber(t));
    if (error) setError(undefined);
  };

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

  const onGoogle = () => {
    // TODO: wire real Google OAuth (expo-auth-session) once the backend supports it.
    // For now this is a visual match with a no-op handler.
  };

  return (
    <StyledSafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="min-h-full px-[28px] pb-[56px] pt-[95px]"
        >
          <Text
            variant="h2"
            className={isTallScreen ? '!text-[26px] !leading-[32px]' : '!text-[20px] !leading-[26px]'}
          >
            Phone number
          </Text>

      {/* Field group: top phone field + country-code row + helper text sit close
          together, matching the tighter spacing the mockup gives related fields. */}
      <View className="mt-md gap-lg">
        {/* Top field — the standalone "Phone number" input from the mockup. */}
        <Input
          placeholder="Phone number"
          value={local}
          onChangeText={onChange}
          keyboardType="phone-pad"
          maxLength={10}
          error={error}
          containerClassName="h-[40px] rounded-[10px] px-md"
          className={isTallScreen ? '!text-[14px]' : '!text-[12px]'}
        />

        {/* Country code + number row. */}
        <View className="gap-[6px]">
          <Text
            variant="caption"
            color="text"
            className={`ml-[2px] !font-inter-semibold ${isTallScreen ? '!text-[13px]' : '!text-[11px]'}`}
          >
            Country code
          </Text>
          <View className="flex-row gap-sm">
            <CountrySelector isTallScreen={isTallScreen} />
            <View className="flex-1">
              <Input
                placeholder="Enter phone number"
                value={local}
                onChangeText={onChange}
                keyboardType="phone-pad"
                maxLength={10}
                containerClassName="h-[40px] rounded-[10px] px-md"
                className={isTallScreen ? '!text-[14px]' : '!text-[12px]'}
              />
            </View>
          </View>
        </View>

        <Text
          variant="caption"
          color="textMuted"
          className={`ml-[2px] ${isTallScreen ? '!text-[13px]' : '!text-[11px]'}`}
        >
          We&apos;ll send you an OTP
        </Text>
      </View>

      {/* Action group: CTA + divider + Google button, spaced a little further
          apart from the fields above (matches the mockup's more generous gap
          right before the primary action). */}
      <View className="mt-[19px] gap-lg">
        <Button
          label="Find Taxi"
          fullWidth
          onPress={onSend}
          loading={loading}
          disabled={!isValid}
          className="h-[40px] rounded-[12px]"
        />

        <OrDivider isTallScreen={isTallScreen} />

        <Button
          label="Sign up with Google"
          variant="outline"
          fullWidth
          onPress={onGoogle}
          leftIcon={
            // Placeholder mark — swap for the real multicolour Google "G" asset later.
            <Text variant="button" color="text" className="!font-bold">
              G
            </Text>
          }
          className="h-[42px] rounded-[11px]"
        />
      </View>

          <View className="flex-1" />
          <LoginLink isTallScreen={isTallScreen} onPress={() => router.push('/phone')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </StyledSafeAreaView>
  );
}

/** The "🇳🇬 +234 ▾" pill. Styled like an Input; the picker itself isn't wired yet. */
function CountrySelector({ isTallScreen }: { isTallScreen: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Select country code"
      // TODO: open a country picker. Fixed to Nigeria (+234) for the Lagos market now.
      className="h-[40px] flex-row items-center gap-xs rounded-[10px] border border-border bg-surfaceMuted px-sm"
    >
      <Text variant="body" className={isTallScreen ? '!text-[14px]' : '!text-[12px]'}>🇳🇬</Text>
      <Text variant="body" className={isTallScreen ? '!text-[14px]' : '!text-[12px]'}>+234</Text>
      <Text variant="caption" color="textMuted" className={isTallScreen ? '!text-[13px]' : '!text-[11px]'}>
        ▾
      </Text>
    </Pressable>
  );
}

/** A horizontal rule with a centred "or" — the divider above the Google button. */
function OrDivider({ isTallScreen }: { isTallScreen: boolean }) {
  return (
    <View className="flex-row items-center gap-md">
      <View className="h-px flex-1 bg-border" />
      <Text variant="caption" color="textMuted" className={isTallScreen ? '!text-[13px]' : '!text-[11px]'}>
        or
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

/** "Already have an account? Log in" — the bottom-pinned link. */
function LoginLink({
  isTallScreen,
  onPress,
}: {
  isTallScreen: boolean;
  onPress: () => void;
}) {
  return (
    <View className="flex-row justify-center gap-xs">
      <Text variant="caption" color="textMuted" className={isTallScreen ? '!text-[13px]' : '!text-[11px]'}>
        Already have an account?
      </Text>
      <Text
        variant="caption"
        color="primary"
        className={isTallScreen ? '!text-[13px]' : '!text-[11px]'}
        onPress={onPress}
      >
        Log in
      </Text>
    </View>
  );
}
