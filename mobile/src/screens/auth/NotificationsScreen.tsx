/**
 * NotificationsScreen — the final signup step (route: "/notifications"). Screen 5
 * in the mockup: notification preferences + confirming contact details.
 *
 * THIS is where signup actually completes. The name/email gathered on the Profile
 * screen arrive here as route params; pressing "Done" calls completeProfile(), which
 * creates the session and flips the router over to the signed-in app. Keeping the
 * commit on the very last screen is why Profile and Notifications both still live in
 * the logged-out (auth) group — the session only exists once we leave this screen.
 *
 * The toggles are local UI state for now (there's no notifications module yet); they
 * match the mockup and are ready to wire to a preferences endpoint later.
 */
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Input, ListRow, Text, Toggle } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';

import { AuthScreenLayout } from './AuthScreenLayout';

/** Route params can arrive as string | string[]; take the first/only value. */
function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string; email?: string }>();

  const hasPending = useAuthStore((s) => s.pending !== null);
  const pendingPhone = useAuthStore((s) => s.pending?.phone);
  const completeProfile = useAuthStore((s) => s.completeProfile);

  const name = paramString(params.name);

  const [email, setEmail] = useState(paramString(params.email));
  const [phone, setPhone] = useState(pendingPhone ?? '');
  const [pushOn, setPushOn] = useState(true);
  const [tipsOn, setTipsOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const onDone = async () => {
    if (loading) return;
    setLoading(true);
    setError(undefined);
    try {
      // Session is born here: name (from Profile) + optional email → completeProfile,
      // which attaches the profile to the verified phone and signs the user in.
      await completeProfile({ name, email: email.trim() || undefined });
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish setup. Try again.');
      setLoading(false);
    }
  };

  // Guards: we must have a verified phone in flight AND a name from the profile step.
  if (!hasPending) return <Redirect href="/phone" />;
  if (!name) return <Redirect href="/profile" />;

  return (
    <AuthScreenLayout
      title="Notifications"
      subtitle="Choose how we keep in touch."
      footer={
        <Button label="Done" fullWidth onPress={onDone} loading={loading} />
      }
    >
      {/* General */}
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="bodyMedium">General</Text>
        <ListRow
          label="Push notifications"
          right={<Toggle value={pushOn} onValueChange={setPushOn} />}
        />
      </View>

      {/* Email — confirm the contact details we'll reach you on. */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="bodyMedium">Email</Text>
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="john.doe@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          rightIcon={
            <Text variant="bodyMedium" color="textMuted">
              @
            </Text>
          }
        />
        <Input
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number"
          keyboardType="phone-pad"
        />
      </View>

      {/* Promo */}
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="bodyMedium">Promo</Text>
        <ListRow
          label="Tips & offers"
          right={<Toggle value={tipsOn} onValueChange={setTipsOn} />}
        />
      </View>

      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </AuthScreenLayout>
  );
}
