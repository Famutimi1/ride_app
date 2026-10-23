# EAS Update

Configured on 23 October 2026 for the existing RackyRide Expo project.

## Configuration

- `mobile/package.json` includes Expo SDK 57's `expo-updates` package.
- `mobile/app.json` points to the existing EAS project update URL and uses the
  `fingerprint` runtime policy. Builds only receive updates with a matching native
  fingerprint. Native library, SDK or native configuration changes need a new build.
- `mobile/eas.json` pairs development, preview and production builds with their
  matching update channels and EAS environments.
- Release builds check for updates at launch. The default launch wait is zero,
  so a downloaded update normally applies on a subsequent launch. There is no
  added forced reload during a ride.
- Android/iOS directories are generated and ignored by Git. EAS regenerates them
  for cloud builds. Android's local generated configuration has also been updated.

## First Android release with update support

Run from `mobile/` after saving the intended application changes:

```sh
eas build --platform android --profile production
```

After that build completes, submit that specific build from its EAS build page,
or use the following command if it is still the latest Android build:

```sh
eas submit --platform android --profile production --latest
```

The existing submission profile sends the bundle to Google Play's **internal**
track as a **draft**. Complete the release in Play Console and promote it to the
intended track. Users must install this new binary before they can receive EAS
updates; an older installed binary without `expo-updates` cannot gain support remotely.

## Publish later JavaScript, styling and asset updates

Test on a preview build before publishing to production:

```sh
eas build --platform android --profile preview
eas update --platform android --channel preview --environment preview --message "Describe the tested change"
```

Once verified, publish the intended code to production:

```sh
eas update --platform android --channel production --environment production --message "Describe the release"
```

Use the same EAS environment for a build and its updates, including the public
backend URL and Google configuration. Set public frontend variables as plain or
sensitive EAS variables so update export can access them; secret-visibility
variables are unavailable to the local update exporter. Never bundle backend secrets.
Do not publish a production update with a development API URL.

To test a downloaded update in a release build, close and reopen the app, allow
the download to finish, then close and reopen again. A development client loading
Metro is not an end-to-end test of production OTA delivery. A fingerprint change
requires a compatible new build even when the channel name stays the same.

## Setup verification

Verified the resolved update URL, runtime policy and profile channels, enabled
Android native update metadata, TypeScript, lint, and a production Android Hermes
bundle export. No new APK/AAB, cloud build, store submission or published update
was created during setup. End-to-end delivery must be checked on the first new
preview/release build containing this native module.

References: [EAS Update setup](https://docs.expo.dev/eas-update/getting-started/),
[SDK 57 updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/),
[runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/).
