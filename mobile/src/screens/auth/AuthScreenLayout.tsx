/**
 * AuthScreenLayout — the shared chrome for the phone / profile / notifications
 * screens.
 *
 * These screens all want the same frame: safe-area padding, a keyboard that pushes
 * content up instead of covering the input, an optional back button, a title +
 * subtitle at the top, the body in the middle, and a call-to-action pinned near the
 * bottom. Rather than repeat that in every screen, it lives here once.
 *
 * (The Onboarding and OTP screens use their own bespoke layouts.)
 */
import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

interface AuthScreenLayoutProps {
  title: string;
  subtitle?: string;
  /** Show a back button when provided; omit it on the first screen of a flow. */
  onBack?: () => void;
  children: ReactNode;
  /** Bottom-pinned area, typically the primary Button. */
  footer?: ReactNode;
}

export function AuthScreenLayout({
  title,
  subtitle,
  onBack,
  children,
  footer,
}: AuthScreenLayoutProps) {
  const theme = useTheme();
  // Raw insets (notch / home indicator) so we can pad safely without SafeAreaView's
  // fixed edges — we want fine control over top vs bottom spacing here.
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // iOS needs 'padding' to lift content above the keyboard; on Android the OS
        // resizes the window for us, so no behavior is the safe default.
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
          {onBack && <BackButton onPress={onBack} />}

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="h2">{title}</Text>
            {subtitle ? (
              <Text variant="body" color="textMuted">
                {subtitle}
              </Text>
            ) : null}
          </View>

          {/* flex:1 shoves the footer to the bottom when there's spare height. */}
          <View style={{ flex: 1, gap: theme.spacing.lg }}>{children}</View>

          {footer ? <View style={{ gap: theme.spacing.md }}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
