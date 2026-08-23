/**
 * WelcomeScreen — the app's front door for logged-out users (route: "/welcome").
 *
 * Deliberately simple: a hero mark up top and a single call-to-action at the bottom
 * that kicks off phone sign-in. This is the one auth screen with no back button and
 * no form, so it doesn't use AuthScreenLayout.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

export function WelcomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.xl,
        }}
      >
        {/* Hero: centred logo + wordmark + tagline. flex:1 keeps the CTA at the bottom. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg }}>
          {/* Placeholder wordmark/logo — swap for the real brand asset later. */}
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="h1" color="textInverse">
              R
            </Text>
          </View>

          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="h1">RideApp</Text>
            <Text
              variant="body"
              color="textMuted"
              style={{ textAlign: 'center' }}
            >
              Getting around Lagos, made simple.
            </Text>
          </View>
        </View>

        {/* Bottom call-to-action. */}
        <View style={{ gap: theme.spacing.md }}>
          <Button
            label="Continue with phone"
            fullWidth
            onPress={() => router.push('/phone')}
          />
          <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
            By continuing you agree to our Terms & Privacy Policy.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
