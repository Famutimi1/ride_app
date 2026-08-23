/**
 * AuthScreenLayout — the shared chrome for the phone / OTP / profile screens.
 *
 * These three screens all want the same frame: safe-area padding, a keyboard that
 * pushes content up instead of covering the input, an optional back button, a
 * title + subtitle at the top, the body in the middle, and a call-to-action pinned
 * near the bottom. Rather than repeat that in every screen, it lives here once.
 *
 * (The Welcome screen is a different, hero-style layout, so it doesn't use this.)
 */
import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/common';
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

/** A round, tappable back chevron. Uses a glyph (no icon library yet — see design-system.md). */
function BackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceMuted,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {/* Nudge up a hair so the chevron optically centres in the circle. */}
      <Text variant="h3" style={{ marginTop: -2 }}>
        ‹
      </Text>
    </Pressable>
  );
}
