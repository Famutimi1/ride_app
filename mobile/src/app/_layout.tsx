import '../../global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { cssInterop } from 'nativewind';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { nativeWindTheme, useTheme } from '@/constants/theme';
import { useIsSignedIn, useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { LocationBootstrap } from '@/components/map';
import { TripRecovery } from '@/components/trip/TripRecovery';
import { DriverTrackingBootstrap } from '@/components/trip/DriverTrackingBootstrap';
import { DriverServiceSettingsBootstrap } from '@/components/common/DriverServiceSettings';
import { WalletBootstrap } from '@/components/common/WalletBootstrap';
import { NotificationBootstrap, NotificationHost } from '@/components/notifications';
import { Button, Text } from '@/components/common';
import { subscribeSessionExpired } from '@/lib/apiClient';
import { ChatBootstrap } from '@/components/communication/ChatBootstrap';
import { FeedbackHost } from '@/components/common/FeedbackHost';
import { clearFeedback } from '@/store/feedbackStore';
import { CallBootstrap } from '@/components/communication/CallBootstrap';

const StyledGestureHandlerRootView = cssInterop(GestureHandlerRootView, {
  className: 'style',
});

// Keep the native splash screen up until our fonts are ready. The SDK 57 docs are
// explicit: call this in global scope and DON'T await it — awaiting inside a
// component/hook can race the first render.
SplashScreen.preventAutoHideAsync();
// Optional polish: fade the splash out instead of a hard cut (fade is iOS-only).
SplashScreen.setOptions({ duration: 300, fade: true });

export default function RootLayout() {
  // `@expo-google-fonts/inter` re-exports expo-font's useFonts and gives us each
  // weight as an asset. These four families are exactly what typography.ts names.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Both persisted stores rehydrate from AsyncStorage asynchronously. We wait for
  // both: the session (so a logged-in user never flashes the login screen) AND the
  // theme preference (so a dark-mode user never flashes a white screen on launch).
  const authHasHydrated = useAuthStore((s) => s._hasHydrated);
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const sessionError = useAuthStore((s) => s._sessionError);
  const uiHasHydrated = useUiStore((s) => s._hasHydrated);
  const isSignedIn = useIsSignedIn();
  const sessionContext = useAuthStore(state => `${state.session?.user.id}:${state.session?.user.role}`);
  const theme = useTheme();
  useEffect(() => { clearFeedback(); return clearFeedback; }, [sessionContext]);

  const ready = (fontsLoaded || fontError) && authHasHydrated && uiHasHydrated;

  useEffect(() => { if (!authHasHydrated) void hydrateAuth(); }, [authHasHydrated, hydrateAuth]);
  useEffect(() => subscribeSessionExpired(() => { void useAuthStore.getState().logout(); }), []);
  useEffect(() => {
    if (!sessionError) return;
    const timer = setInterval(() => { void hydrateAuth(); }, 30_000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void hydrateAuth(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [hydrateAuth, sessionError]);

  // Hide the splash once fonts AND the session are in. If a font fails we still
  // proceed (the OS font fills in) rather than trapping the user on the splash.
  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // Render nothing until everything's ready — the native splash stays up.
  if (!ready) {
    return null;
  }

  if (sessionError) return <View className="flex-1 items-center justify-center bg-background px-xl" style={nativeWindTheme[theme.scheme]}>
    <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
    <Text variant="h3">Reconnect to your account</Text>
    <Text color="textMuted" className="mb-lg mt-md text-center">{sessionError}</Text>
    <Button label="Retry connection" onPress={() => { void hydrateAuth(); }} />
  </View>;

  return (
    // GestureHandlerRootView MUST wrap the whole app for react-native-gesture-handler
    // to work — bottom sheets / swipeable rows silently do nothing without it.
    <StyledGestureHandlerRootView className="flex-1">
      <View className="flex-1 bg-background" style={nativeWindTheme[theme.scheme]}>
        {/* SafeAreaProvider powers useSafeAreaInsets()/SafeAreaView used across screens. */}
        <SafeAreaProvider>
          {isSignedIn ? <LocationBootstrap key={`location:${sessionContext}`} /> : null}
          {isSignedIn ? <TripRecovery key={`trip:${sessionContext}`} /> : null}
          {isSignedIn ? <DriverTrackingBootstrap key={`tracking:${sessionContext}`} /> : null}
          {isSignedIn ? <WalletBootstrap key={`wallet:${sessionContext}`} /> : null}
          {isSignedIn ? <DriverServiceSettingsBootstrap /> : null}
          {isSignedIn ? <NotificationBootstrap /> : null}
          {isSignedIn ? <ChatBootstrap /> : null}
          {/* Match the status-bar text to the active theme: light glyphs on the dark
              background, dark glyphs on the light one. Driven by our theme (not "auto")
              so it tracks the in-app toggle, not just the OS setting. */}
          <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
          {/* Custom headers are drawn per-screen (see the mockup), so hide the default.
              Auth-gating: the guard picks which route GROUP is mounted. Flipping the
              session (login/logout) automatically swaps the user between them. */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
            <Stack.Screen name="index" />
            <Stack.Protected guard={!isSignedIn}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={isSignedIn}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
          </Stack>
          {isSignedIn ? <NotificationHost /> : null}
          {isSignedIn ? <CallBootstrap /> : null}
          <FeedbackHost />
        </SafeAreaProvider>
      </View>
    </StyledGestureHandlerRootView>
  );
}

/** Recover rendering failures without displaying source paths or exception text. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  const [retrying, setRetrying] = useState(false);
  return <View style={[{ flex: 1, justifyContent: 'center', padding: 24 }, nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.background }]}>
    <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12 }}>
      <Text variant="h3">Let’s try that again</Text>
      <Text color="textMuted">We couldn’t open this screen. Please try again in a moment.</Text>
      <Button label="Try again" fullWidth loading={retrying} onPress={() => {
        if (retrying) return;
        setRetrying(true);
        void retry().catch(() => undefined).finally(() => setRetrying(false));
      }} />
    </View>
  </View>;
}
