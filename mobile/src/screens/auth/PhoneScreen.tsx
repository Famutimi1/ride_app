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
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Input, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';

import { AuthScreenLayout } from './AuthScreenLayout';

/** Strip anything non-numeric, drop a leading 0, and cap at 10 digits. */
function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function PhoneScreen() {
  const theme = useTheme();
  const router = useRouter();
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
    <AuthScreenLayout
      title="Phone number"
      footer={<LoginLink onPress={() => router.push('/phone')} />}
    >
      {/* Top field — the standalone "Phone number" input from the mockup. */}
      <Input
        placeholder="Phone number"
        value={local}
        onChangeText={onChange}
        keyboardType="phone-pad"
        maxLength={10}
        error={error}
      />

      {/* Country code + number row. */}
      <View style={{ gap: 6 }}>
        <Text variant="caption" color="textMuted" style={{ marginLeft: 2 }}>
          Country code
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <CountrySelector />
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Enter phone number"
              value={local}
              onChangeText={onChange}
              keyboardType="phone-pad"
              maxLength={10}
            />
          </View>
        </View>
      </View>

      <Text variant="caption" color="textMuted" style={{ marginLeft: 2 }}>
        We&apos;ll send you an OTP
      </Text>

      <Button
        label="Find Taxi"
        fullWidth
        onPress={onSend}
        loading={loading}
        disabled={!isValid}
      />

      <OrDivider />

      <Button
        label="Sign up with Google"
        variant="outline"
        fullWidth
        onPress={onGoogle}
        leftIcon={
          // Placeholder mark — swap for the real multicolour Google "G" asset later.
          <Text variant="button" color="text" style={{ fontWeight: '700' }}>
            G
          </Text>
        }
      />
    </AuthScreenLayout>
  );
}

/** The "🇳🇬 +234 ▾" pill. Styled like an Input; the picker itself isn't wired yet. */
function CountrySelector() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Select country code"
      // TODO: open a country picker. Fixed to Nigeria (+234) for the Lagos market now.
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        height: 52,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceMuted,
      }}
    >
      <Text variant="body">🇳🇬</Text>
      <Text variant="body">+234</Text>
      <Text variant="caption" color="textMuted">
        ▾
      </Text>
    </Pressable>
  );
}

/** A horizontal rule with a centred "or" — the divider above the Google button. */
function OrDivider() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      <Text variant="caption" color="textMuted">
        or
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
    </View>
  );
}

/** "Already have an account? Log in" — the bottom-pinned link. */
function LoginLink({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.xs }}>
      <Text variant="caption" color="textMuted">
        Already have an account?
      </Text>
      <Text variant="caption" color="primary" onPress={onPress}>
        Log in
      </Text>
    </View>
  );
}
