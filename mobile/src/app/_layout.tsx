import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useIsSignedIn, useAuthStore } from '@/store/authStore';

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

  // The auth store rehydrates from AsyncStorage asynchronously. We wait for that too,
  // so a returning (already-logged-in) user never sees a flash of the login screen.
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const isSignedIn = useIsSignedIn();

  const ready = (fontsLoaded || fontError) && hasHydrated;

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

  return (
    // GestureHandlerRootView MUST wrap the whole app for react-native-gesture-handler
    // to work — bottom sheets / swipeable rows silently do nothing without it.
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* SafeAreaProvider powers useSafeAreaInsets()/SafeAreaView used across screens. */}
      <SafeAreaProvider>
        {/* `style="auto"` flips the status bar text light/dark to match the theme. */}
        <StatusBar style="auto" />
        {/* Custom headers are drawn per-screen (see the mockup), so hide the default.
            Auth-gating: the guard picks which route GROUP is mounted. Flipping the
            session (login/logout) automatically swaps the user between them. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={!isSignedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={isSignedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
