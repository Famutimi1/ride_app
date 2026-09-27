/**
 * uiStore — app-wide UI preferences that aren't tied to a business domain. Right now
 * that's just the colour-scheme choice; other cosmetic prefs can join later.
 *
 * Why it exists: useTheme() used to follow the OS light/dark setting directly. Now it
 * reads `themePreference` from here FIRST, so the user can force Light or Dark no
 * matter what the OS is set to. The default is 'light' — the app opens in white mode.
 *
 * Like authStore, the choice is PERSISTED to AsyncStorage so it survives an app
 * restart, and `_hasHydrated` lets the root layout wait for the stored value before
 * the first React screen. Native launch still follows the OS before JS loads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** 'system' follows the OS; 'light'/'dark' force that scheme. Defaults to 'light'. */
export type ThemePreference = 'light' | 'dark' | 'system';

interface UiState {
  themePreference: ThemePreference;
  /** False until AsyncStorage has been read back (mirrors authStore's pattern). */
  _hasHydrated: boolean;

  /** Set an explicit preference from Settings or the theme toggle. */
  setThemePreference: (preference: ThemePreference) => void;
  /** Legacy binary preference flip; visible toggles use the resolved scheme. */
  toggleTheme: () => void;
  /** Internal: flipped once persisted state has been rehydrated. */
  setHydrated: () => void;
}

export const useUiStore = create<UiState>()((setRuntimeState, get, api) => {
  // Hydration is runtime-only: never write defaults back after a failed read.
  const finishHydration = () => setRuntimeState({ _hasHydrated: true });
  return persist<UiState, [], [], Pick<UiState, 'themePreference'>>(
    (set) => ({
      // White by default: the app opens in light mode unless the user changes it.
      themePreference: 'light',
      _hasHydrated: false,

      setThemePreference: (preference) => set({ themePreference: preference }),

      // Binary flip. From 'system' we treat the app as light and go to dark, so the
      // button always resolves to a well-defined next state.
      toggleTheme: () =>
        set((state) => ({
          themePreference: state.themePreference === 'dark' ? 'light' : 'dark',
        })),

      setHydrated: finishHydration,
    }),
    {
      name: 'ride-ui',
      storage: createJSONStorage(() => AsyncStorage),
      // Static web rendering has no browser storage. Hydrate on the client only.
      skipHydration: Platform.OS === 'web' && typeof window === 'undefined',
      // Persist only the preference; _hasHydrated is runtime-only.
      partialize: (state) => ({ themePreference: state.themePreference }),
      // Runs after AsyncStorage is read back (even when nothing was stored).
      onRehydrateStorage: (initialState) => (state) => {
        // Failed storage reads return no state. Continue with the safe default
        // instead of leaving the native splash visible indefinitely.
        (state ?? initialState).setHydrated();
      },
    },
  )(setRuntimeState, get, api);
});
