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
import { cssInterop } from 'nativewind';
import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, BrandLogo, Text } from '@/components/common';

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

interface AuthScreenLayoutProps {
  title: string;
  subtitle?: string;
  /** Show a back button when provided; omit it on the first screen of a flow. */
  onBack?: () => void;
  children: ReactNode;
  /** Bottom-pinned area, typically the primary Button. */
  footer?: ReactNode;
  /** Disable scrolling for compact screens whose content should stay fixed. */
  scrollEnabled?: boolean;
  /** Let the footer follow the form instead of pinning it to the bottom. */
  footerPinned?: boolean;
}

export function AuthScreenLayout({
  title,
  subtitle,
  onBack,
  children,
  footer,
  scrollEnabled = true,
  footerPinned = true,
}: AuthScreenLayoutProps) {
  // SafeAreaView accounts for the notch / home indicator while the NativeWind
  // padding utilities preserve separate control over top vs bottom spacing here.
  return (
    <StyledSafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        // iOS needs 'padding' to lift content above the keyboard; on Android the OS
        // resizes the window for us, so no behavior is the safe default.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          scrollEnabled={scrollEnabled}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName={`grow px-xl pb-xl pt-sm ${footerPinned ? 'gap-xl' : 'gap-lg'}`}
        >
          {onBack && <BackButton onPress={onBack} />}

          <View className="flex-row items-center gap-md">
            <BrandLogo size={56} />
            <Text variant="bodyMedium">Rakky Ride</Text>
          </View>

          <View className="gap-sm">
            <Text variant="h2">{title}</Text>
            {subtitle ? (
              <Text variant="body" color="textMuted">
                {subtitle}
              </Text>
            ) : null}
          </View>

          {/* flex:1 shoves the footer to the bottom when there's spare height. */}
          <View className={`${footerPinned ? 'flex-1' : ''} gap-lg`}>{children}</View>

          {footer ? <View className="gap-md">{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </StyledSafeAreaView>
  );
}
