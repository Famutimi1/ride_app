/**
 * ProfileSetupScreen — the final signup step for new users (route: "/profile").
 *
 * By the time we're here the phone is verified (we hold a token in `pending`).
 * Collecting a name + role and calling completeProfile() is what actually creates
 * the session, which flips the router over to the signed-in area.
 *
 * Role matters because this is ONE app for riders and drivers (AGENTS.md): the
 * choice here seeds `users.role`, and it can be changed later from the profile.
 */
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Input, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { type UserRole } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';

import { AuthScreenLayout } from './AuthScreenLayout';

const ROLES: { value: UserRole; title: string; description: string }[] = [
  { value: 'rider', title: 'Rider', description: 'Book rides to get around town.' },
  { value: 'driver', title: 'Driver', description: 'Drive and earn on your schedule.' },
  { value: 'both', title: 'Both', description: 'Ride and drive from one account.' },
];

export function ProfileSetupScreen() {
  const theme = useTheme();
  const router = useRouter();

  const hasPending = useAuthStore((s) => s.pending !== null);
  const completeProfile = useAuthStore((s) => s.completeProfile);

  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isValid = name.trim().length > 0 && role !== null;

  const onFinish = async () => {
    if (!isValid || loading || role === null) return;
    setLoading(true);
    setError(undefined);
    try {
      await completeProfile({ name: name.trim(), role });
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile. Try again.');
      setLoading(false);
    }
  };

  // No verified phone in flight → nothing to complete; send them back to the start.
  if (!hasPending) return <Redirect href="/phone" />;

  return (
    <AuthScreenLayout
      title="Create your profile"
      subtitle="Just a couple of details to get you set up."
      footer={
        <Button label="Finish" fullWidth onPress={onFinish} loading={loading} disabled={!isValid} />
      }
    >
      <Input
        label="Full name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (error) setError(undefined);
        }}
        placeholder="e.g. Chidi Okeke"
        autoCapitalize="words"
        autoFocus
      />

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="caption" color="textMuted" style={{ marginLeft: 2 }}>
          How will you use RideApp?
        </Text>
        {ROLES.map((option) => {
          const selected = role === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setRole(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyMedium">{option.title}</Text>
                <Text variant="caption" color="textMuted">
                  {option.description}
                </Text>
              </View>
              {selected ? (
                <Text variant="bodyMedium" color="primary">
                  ✓
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </AuthScreenLayout>
  );
}
