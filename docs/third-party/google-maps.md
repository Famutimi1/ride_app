# Third-Party: Google Maps API

## Why / how we use it
Real map embeds (never illustrated/placeholder maps — see AGENTS.md Section 7).
Used for: live map view, address autocomplete (Places API), route/ETA (Directions/Routes API).

## Rendering & libraries (verified 2026-08-22)
- Maps are rendered with **react-native-maps** using `provider={PROVIDER_GOOGLE}`
  so both iOS and Android show real Google Maps. (We deliberately do **not** use
  `expo-maps` — it's alpha and only does Google Maps on Android. See
  docs/third-party/expo.md.)
- Config-plugin keys: `androidGoogleMapsApiKey` and `iosGoogleMapsApiKey`; the
  Android key should be restricted by SHA-1 fingerprint + package name.
- **Routing:** Google now steers new projects to the **Routes API**
  (`computeRoutes`) over the legacy **Directions API** — confirm which is enabled
  in the Cloud Console. Both return an **encoded polyline**; decode it with
  **`@mapbox/polyline`** and render as a `<Polyline>`.
- Keep the routing/Places key **server-side** where possible — proxy those calls
  through the backend so a routing-enabled key never ships in the app bundle.
- Full stack plan + versions: docs/setup/dependencies.md

## APIs enabled (fill in as each is turned on in Google Cloud Console)
- [ ] Maps SDK for Android
- [ ] Maps SDK for iOS
- [ ] Places API (autocomplete for pickup/dropoff search)
- [ ] Directions API (route line + ETA)
- [ ] Distance Matrix API (fare distance calculation, if not using Directions)

## Key management
- Client-side key: EXPO_PUBLIC_GOOGLE_MAPS_KEY (restricted by bundle ID / package name
  in Google Cloud Console — never leave unrestricted)
- Server-side key (if backend calls Places/Directions directly): GOOGLE_MAPS_API_KEY,
  restricted by IP if possible

## Cost awareness
Google Maps billing is usage-based. Note here once real usage patterns are known —
autocomplete-per-keystroke can get expensive if not debounced.

## Links
- https://developers.google.com/maps/documentation
