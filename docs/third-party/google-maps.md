# Google Maps setup

Implementation details and file ownership are documented in
`docs/features/google-maps-integration.md`.

Use three restricted keys in one Google Cloud project:

- Android key: Maps SDK for Android; restrict to `com.famutimi.ride` and the release/debug SHA-1 fingerprints.
- iOS key: Maps SDK for iOS; restrict to bundle ID `com.famutimi.ride`.
- Backend key: Places API (New), Geocoding API, Directions API, and Distance Matrix API; restrict by the deployed backend IP addresses.

Put only the platform keys in `mobile/.env`:

```dotenv
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY=
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
```

Put the private web-service key and pricing in `backend/.env`:

```dotenv
GOOGLE_MAPS_API_KEY=
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://user:pass@localhost:5432/rideapp
FARE_BASE_NGN=800
FARE_PER_KM_NGN=250
FARE_PER_MINUTE_NGN=35
PORT=4000
```

Set daily request quotas and billing alerts in Google Cloud before production use. Native key or permission changes require a new development/production build; Expo Go cannot apply native config plugins or run iOS background location.

The mobile app may use only Maps SDK keys. Places, Place Details, reverse
geocoding, Directions, and Distance Matrix requests go through Express so the
server key and fare rules do not ship in the application bundle.

The app identifiers configured for key restrictions are:

- Android package: `com.famutimi.ride`
- iOS bundle identifier: `com.famutimi.ride`
