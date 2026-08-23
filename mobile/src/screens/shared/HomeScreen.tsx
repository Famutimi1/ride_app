/**
 * HomeScreen — the placeholder landing for signed-in users (route: "/home").
 *
 * This is intentionally a STUB. The real rider and driver experiences are later
 * steps in the build order; for now this proves the auth flow works end-to-end:
 * it reads the signed-in user from the store, lets you switch role (this is one app
 * for riders AND drivers), and lets you log out (which sends you back to Welcome).
 */
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, StatusPill, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { type UserRole } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'rider', label: 'Rider' },
  { value: 'driver', label: 'Driver' },
  { value: 'both', label: 'Both' },
];

const ROLE_PILL: Record<UserRole, { tone: 'primary' | 'success'; label: string }> = {
  rider: { tone: 'primary', label: 'Rider' },
  driver: { tone: 'success', label: 'Driver' },
  both: { tone: 'primary', label: 'Rider & Driver' },
};

export function HomeScreen() {
  const theme = useTheme();
  const user = useAuthStore((s) => s.session?.user);
  const setRole = useAuthStore((s) => s.setRole);
  const logout = useAuthStore((s) => s.logout);

  // The router only shows this screen when signed in, but guard anyway for types.
  if (!user) return null;

  const pill = ROLE_PILL[user.role];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ flex: 1, padding: theme.spacing.xl, gap: theme.spacing.xl }}>
        {/* Header: who's signed in. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Avatar name={user.name} size="lg" />
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="h3">Hi, {user.name.split(' ')[0]}</Text>
            <StatusPill tone={pill.tone} label={pill.label} dot />
          </View>
        </View>

        {/* Placeholder message. */}
        <Card elevation="sm" padding="lg" style={{ gap: theme.spacing.sm }}>
          <Text variant="bodyMedium">You're signed in 🎉</Text>
          <Text variant="body" color="textMuted">
            This is a placeholder home. The rider and driver experiences are the next
            things we build — this screen just confirms auth works end to end.
          </Text>
          <Text variant="caption" color="textMuted">
            Signed in as {user.phone}
          </Text>
        </Card>

        {/* Role switcher — segmented control. */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted" style={{ marginLeft: 2 }}>
            ACTIVE ROLE
          </Text>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radius.md,
              padding: 4,
              gap: 4,
            }}
          >
            {ROLE_OPTIONS.map((option) => {
              const selected = user.role === option.value;
              return (
                <View
                  key={option.value}
                  style={[
                    {
                      flex: 1,
                      borderRadius: theme.radius.sm,
                      backgroundColor: selected ? theme.colors.surface : 'transparent',
                    },
                    selected ? theme.elevation.sm : null,
                  ]}
                >
                  <Text
                    onPress={() => setRole(option.value)}
                    variant="button"
                    color={selected ? 'text' : 'textMuted'}
                    style={{ textAlign: 'center', paddingVertical: theme.spacing.sm }}
                  >
                    {option.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ flex: 1 }} />

        <Button label="Log out" variant="secondary" fullWidth onPress={logout} />
      </View>
    </SafeAreaView>
  );
}
