# Third-Party: Expo

## Why / how we use it
React Native app is built with Expo, **managed workflow + a custom dev build**
(EAS Build / `expo-dev-client`) — confirmed 2026-08-22. A custom dev build is
**mandatory**, not optional: background location, push notifications, and maps
each require it, so Expo Go can only run non-native screens as a scratchpad.
Handles build tooling, OTA updates, and native module access (location, maps, permissions).

Current SDK: **57** — always read the versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing native code.

## Key packages (verified against SDK 57)
Install with `npx expo install <pkg>` so versions match the SDK. Full plan +
caveats in `docs/setup/dependencies.md`.
- expo-location + expo-task-manager (background GPS for driver mode)
- **react-native-maps** (Google Maps on both platforms via `provider={PROVIDER_GOOGLE}`)
  — **not** `expo-maps`, which is still alpha and only does Google Maps on Android
- expo-notifications (push notifications — dev build required)
- expo-secure-store (storing JWT securely, not AsyncStorage for sensitive tokens)
- @react-native-async-storage/async-storage (Zustand persistence — non-sensitive only)
- expo-image-picker (license / vehicle photos; set `microphonePermission: false`)

## Config
- app.json / app.config.js — bundle IDs, permissions (location "always" for driver mode)
- EXPO_PUBLIC_* env vars are exposed to the client — never put secrets here
  (see .env.example — only API_BASE_URL and the public Maps key go here)

## Gotchas to document as we hit them
- Background location permission flow differs iOS vs Android — document once implemented
- **Custom dev build is required** (confirmed): background location, remote push,
  and maps all fail in Expo Go. Set up the EAS dev-build workflow from day one.
- `TaskManager.defineTask` must be called at the **top level** of the JS bundle,
  not inside a component (background launches JS without mounting the UI).
- Android 13+: create a notification channel *before* requesting the push token,
  or the permission prompt never appears.

## Links
- https://docs.expo.dev/versions/v57.0.0/ (pin the SDK 57 versioned docs)
- Full dependency plan: `docs/setup/dependencies.md`
- Claude Code skills for this stack: `docs/setup/claude-code-skills.md`
