/**
 * ProfileSetupScreen — collects the new user's name, email and (decorative) photo
 * (route: "/profile"). Screen 4 in the mockup.
 *
 * By the time we're here the phone is verified (we hold a token in `pending`), but
 * signup ISN'T finished yet — this screen just gathers details and hands them to the
 * Notifications screen, which is where "Done" actually creates the session. That's
 * why we push() forward with the name/email as route params instead of writing them
 * to the store now: they're transient until the final step commits them.
 *
 * The "Stats" rows (wallet balance, ride credit, card) are STATIC placeholders that
 * mirror the mockup — no wallet/ledger data is read or written here.
 */
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, BackButton, Button, Input, ListRow, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';

export function ProfileSetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const hasPending = useAuthStore((s) => s.pending !== null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();

  const onDone = () => {
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    // Carry the details to the final step; the session is created there, not here.
    router.push({
      pathname: '/notifications',
      params: { name: name.trim(), email: email.trim() },
    });
  };

  // No verified phone in flight → nothing to complete; send them back to the start.
  if (!hasPending) return <Redirect href="/phone" />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + theme.spacing.sm,
            paddingBottom: insets.bottom + theme.spacing.xl,
            paddingHorizontal: theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
        >
          <BackButton onPress={() => router.back()} />

          {/* Avatar + "Add photo". Photo upload isn't wired yet — the initials
              fallback stands in, and "Add photo" is a no-op placeholder for now. */}
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Avatar name={name || undefined} size="lg" />
            <Text
              variant="caption"
              color="primary"
              onPress={() => {
                // TODO: launch expo-image-picker once photo upload is supported.
              }}
            >
              Add photo
            </Text>
          </View>

          {/* Basic info */}
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="bodyMedium">Basic info</Text>

            <Input
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (error) setError(undefined);
              }}
              placeholder="John Doe"
              autoCapitalize="words"
              error={error}
              rightIcon={
                <Text variant="bodyMedium" color="textMuted">
                  T
                </Text>
              }
            />
            <Text variant="caption" color="primary" style={{ marginLeft: 2 }}>
              Enter your full name
            </Text>

            <Input
              label="Email"
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
          </View>

          {/* Stats — static display mirroring the mockup (no wallet/ledger access). */}
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyMedium">Stats</Text>
            <ListRow icon={<Text>💰</Text>} label="Wallet balance" value="$120.00" />
            <ListRow icon={<Text>🎟️</Text>} label="Ride credit" value="$20.00" />
            <ListRow icon={<Text>💳</Text>} label="Payment method" value="•••• 4242" />
          </View>

          {/* Spacer pushes Done to the bottom when the content is short. */}
          <View style={{ flex: 1 }} />

          <Button label="Done" fullWidth onPress={onDone} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
