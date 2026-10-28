# Production and test apps

Configured 27–28 October 2026. Separate identities are configured in the existing Expo project, the Android test app is registered in the existing Firebase project, and development/preview EAS settings are configured. Android test signing and EAS push credentials are configured. The signed preview APK built successfully and was installed and launched on the Android emulator alongside the existing production package. No update publication, Play Store submission or backend deployment has been performed.

## App identities and build selection

- **production:** existing name `RackyRide`, Android/iOS identifier `com.rackyride.app`, link scheme `rackyride`, production EAS environment/channel, Android AAB.
- **preview:** `Rakky Ride Test`, identifier `com.rackyride.app.test`, scheme `rackyride-test`, preview environment/channel, installable Android APK with its own bundled JavaScript.
- **development:** the same test name/identifier/scheme, development environment/channel, development client for Metro. Only this variant advertises the generated Expo development-launcher scheme.

Production and a test app can coexist. Preview and development share one test identifier, so installing one replaces the other. Each build profile selects `APP_VARIANT` inside `eas.json`; there is no new required `.env` switch. Local Expo defaults to development/test. The existing EAS project and fingerprint runtime policy remain unchanged. Test and production native identities differ, so a new binary is necessary; an OTA update cannot change an installed package ID.

The code keeps separate default Firebase client file paths: `mobile/google-services.json` for production and `mobile/google-services.test.json` for test builds. Both are ignored by Git. `GOOGLE_SERVICES_JSON`, already supported by EAS, overrides the local file path using the selected environment's file variable. Files must contain a client registration matching the selected package. A copied production JSON with a renamed package string is not a registered test app.

## Firebase configuration and remaining Google setup

1. **Completed:** registered **Rakky Ride Test**, package **com.rackyride.app.test**, in the existing **rakky-ride-f1892** Firebase project through the signed-in console. Downloaded the real client configuration and validated its project and package.
2. **Completed:** saved the client file as `mobile/google-services.test.json`, excluded from Git, and uploaded it as the secret EAS file variable `GOOGLE_SERVICES_JSON` for **development** and **preview**. The original EAS file remains attached only to **production**, with its value retained. The existing Google Maps, web-client and iOS-client values are reused in preview through their existing EAS variables. Keep the existing Firebase server service-account credential on the backend.
3. **Completed:** generated a separate EAS test keystore, added its SHA-1/SHA-256 fingerprints to the Firebase test app, created an Android OAuth client in the existing Google Sign-In project, and assigned the existing FCM V1 service account to the test package in EAS. See the procedure below. **Remaining:** verify Maps authorization and finish the user-requested public OAuth publishing, then verify delivery and sign-in on the installed APK.

The existing service-account credential successfully authorizes FCM sends, but a read-only Firebase Management API request returned HTTP 403 PERMISSION_DENIED. Registration and download were subsequently completed through the signed-in Firebase console. No IAM changes or new server keys were needed.

## Android signing procedure followed

1. Selected the **preview** EAS profile and confirmed the credentials manager resolves **com.rackyride.app.test**. The generated local Android folder is ignored by Git, so EAS uses the selected Expo configuration rather than that folder's old production identifier.
2. Ran `eas credentials:configure-build --platform android --profile preview` with the preview variant and generated a new test keystore. EAS stores it as the test app's default build credential; the production signing key was not selected or replaced.
3. Read the public certificate fingerprints from `eas credentials --platform android`, selecting **preview**:

   - SHA-1: `3D:69:A3:58:6F:4D:33:63:AC:F0:D4:18:E3:B6:23:49:78:84:98:AD`
   - SHA-256: `EF:1E:9C:85:33:EB:F7:3C:F9:17:CD:B3:D2:A0:90:1A:77:27:8C:38:8A:40:5E:7F:20:55:FA:B5:E9:A1:95:22`

4. In **rakky-ride-f1892 → Project settings → General → Rakky Ride Test → Add fingerprint**, saved both fingerprints and verified that Firebase lists each with the correct type. Downloaded the refreshed test client JSON; its contents were unchanged, so the existing EAS test file remains current.
5. The existing Google web/iOS clients belong to **rackyride-510222** (project number **15361019121**), rather than the Firebase project. In that Google Cloud project's credentials page, created the Android OAuth client **Rakky Ride Test - EAS preview** for **com.rackyride.app.test** and the SHA-1 above. The app retains its existing web/server client ID. Google rejected `info@rakkyride.com` as an ineligible test user. The user then requested public OAuth access instead of a test-user restriction; public publishing is being configured separately from APK distribution.
6. In EAS credentials, selected **Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1) → Select an existing Google Service Account Key**. Assigned the existing **rakky-ride-f1892** FCM service account to **com.rackyride.app.test**. No new service-account key was generated or bundled into the app.
7. Confirmed the existing local backend responds at `http://172.20.10.2:4000/api/health`, then started an Android **preview** build with remote credentials frozen and without auto-submission.
8. The [first cloud build](https://expo.dev/accounts/famutimi1/projects/rackyride/builds/b9f1be3e-3bd9-46b5-a34e-cf2c9e942aa7) failed before Gradle compilation because `masked-view`'s Gradle script had rewritten the local dependency manifest, changing the fingerprint compared with a fresh cloud install. Added `scripts/normalize-native-fingerprint.ts` to npm `postinstall` to apply that same namespace normalization before fingerprinting. A clean package comparison, repeat-run check, six variant tests, TypeScript and lint passed. Successfully completed the [corrected preview build](https://expo.dev/accounts/famutimi1/projects/rackyride/builds/777298ac-136a-40be-b4e4-e1c2c8d4f065); fingerprint runtime policy remains enabled.
9. Maps authorization is **not yet verified**. The configured mobile Maps key does not equal the Firebase Android client key. The Firebase Browser key also does not match. The FCM service account cannot look up API-key metadata (HTTP 403). Check the actual existing Maps key's project and restrictions before changing any key. If it is Android-restricted, add the test package/SHA-1 pair while preserving existing authorized apps.

10. Downloaded `/Users/mac/Downloads/Rakky-Ride-Test-preview.apk`. Android build tools verified the package `com.rackyride.app.test`, label **Rakky Ride Test**, and both expected signing fingerprints. Installed it on `emulator-5554`; a cold start reached onboarding and its process remained running without a fatal startup error. Both `com.rackyride.app` and `com.rackyride.app.test` remain installed. This verifies installation coexistence and startup, not authenticated provider flows.

## Public Google Sign-In follow-up

The user requested public Google Sign-In rather than a restricted test-user list. The last verified Google Cloud Audience status is **Testing**, with **Publish app** disabled until Branding configuration is completed. Entered the supplied homepage `https://rakkyride.com` and privacy-policy URL `https://rakkyride.com/privacy` in the branding form. Google subsequently confirmed **Branding changes saved!** for those supplied URLs. Public OAuth publishing has **not** yet been confirmed enabled; the Audience publishing step remains. At the time of checking, the homepage redirected to the admin login and the privacy URL returned HTTP 404; serve the real public pages before claiming branding verification is complete. No new OAuth scopes or account allowlists were saved during this follow-up.

The native app currently uses Google Sign-In’s default identity permissions. Google documents an exception allowing basic identity-only requests (`openid`, `email`, `profile`) without a test-user allowlist even while Testing; that exception is not evidence that the project has been published. See [Google OAuth app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview). APK distribution and backend authorization are separate from Google’s OAuth publishing status.

## Backend and database separation

The app talks to an API, not PostgreSQL directly. Set `EXPO_PUBLIC_API_BASE_URL` in each selected EAS environment:

- development: EAS currently uses `http://172.20.10.2:4000`. Local Metro development may use localhost; the existing client resolves the Mac's Metro host.
- preview: EAS currently uses `http://172.20.10.2:4000`, the Mac's local network address when configured. The backend health endpoint responded successfully at that address. The phone must be able to reach the same network; update this value if the Mac's address changes, then rebuild or publish a compatible test update. A standalone APK has no Metro host to infer. Away from the LAN, use a reachable staging HTTPS endpoint.
- production: the actual deployed public HTTPS API URL. Local/emulator addresses and insecure URLs are rejected.

Preview and development native builds permit HTTP for local backend testing. Production keeps Android cleartext and iOS arbitrary-load allowances off. The preview/development backend should continue using local PostgreSQL and Redis; the production backend must use the separate production database/Redis and environment secrets. Selecting a build profile cannot change a backend's database connection. No database or server configuration was changed by this variant setup.

For an iPhone test build later, register/provision `com.rackyride.app.test`, configure its Google iOS sign-in client, and match the Apple push environment to the signed build. A separate test backend must use the matching `CALL_APNS_BUNDLE_ID=com.rackyride.app.test` for VoIP delivery; production retains `com.rackyride.app`. The existing native incoming-call metadata remains app-scoped. iOS signing/provider delivery is not verified here.

## Build and update commands

From `mobile`:

```sh
npm run build:test:android
npm run build:production:android
```

The `eas-build-post-install` hook validates the selected API address and Firebase client package before native compilation. Check locally after obtaining the corresponding client file:

```sh
npm run check:build
APP_VARIANT=preview EXPO_PUBLIC_API_BASE_URL=http://172.20.10.2:4000 npm run check:build
APP_VARIANT=production npm run check:build
```

For Metro development, use `npm start -- --dev-client`. Existing installed binaries and generated native folders still use their previous identifier. Once the test Firebase file is available, regenerate/build the ignored Android native project for the test variant before expecting a separate installed app:

```sh
npx expo prebuild --platform android --clean
npm run android
```

The clean prebuild regenerates ignored native directories; preserve any intentional manual native edits before running it. This setup did not regenerate or erase them.

The existing production submission configuration still targets the Play Store internal track as a draft. A production build does not automatically publish a public release. Preserve the production application's existing signing credentials.

After a compatible binary is installed, use the matching update command:

```sh
npm run update:test:android -- --message "Describe the tested change"
npm run update:production:android -- --message "Describe the release"
```

Each command selects the variant, EAS environment and update channel together. Avoid setting an inconsistent APP_VARIANT in EAS environment variables; build profiles and these commands already select it. Test JavaScript updates never belong on the production channel. Build/update from the intended Git branch or a separate worktree; EAS profiles select configuration, not Git branches.

## Verification

Run `npm run test:variants`, `npm run typecheck`, and `npm run lint` in mobile. All six variant tests, typecheck and lint passed after saving the real Firebase test file. Development and preview preflight passed. Initial native introspection covered all three variants with synthetic Firebase files; a subsequent preview introspection with the real downloaded file passed and retained the existing EAS project and test identifiers. See [native configuration results](../testing/app-variants/results.json).

The signed APK installation and onboarding startup passed on the emulator; see [startup screenshot](../testing/app-variants/android-preview-startup.png). Google sign-in/Maps permissions, notification routing and media between physical phones remain unverified. Complete provider configuration and the deployed production endpoint, then exercise both apps on a phone before declaring device separation complete.
