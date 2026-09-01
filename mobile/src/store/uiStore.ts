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
 * the first paint (so a dark-mode user never sees a white flash on launch).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** 'system' follows the OS; 'light'/'dark' force that scheme. Defaults to 'light'. */
export type ThemePreference = 'light' | 'dark' | 'system';

interface UiState {
  themePreference: ThemePreference;
  /** False until AsyncStorage has been read back (mirrors authStore's pattern). */
  _hasHydrated: boolean;

  /** Set an explicit preference — for a future Profile → Preferences row. */
  setThemePreference: (preference: ThemePreference) => void;
  /** Flip between light and dark. This is what the homepage toggle button calls. */
  toggleTheme: () => void;
  /** Internal: flipped once persisted state has been rehydrated. */
  setHydrated: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
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

      setHydrated: () => set({ _hasHydrated: true }),
    }),
    {
      name: 'ride-ui',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist only the preference; _hasHydrated is runtime-only.
      partialize: (state) => ({ themePreference: state.themePreference }),
      // Runs after AsyncStorage is read back (even when nothing was stored).
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);
