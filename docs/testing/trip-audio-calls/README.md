# Android native incoming-call smoke test

The native Android incoming-call UI was exercised on the local emulator with a synthetic invite. [Results](android-native-smoke.json) contain nine passing assertions. [Screenshot](android-native-incoming.png) shows the real system call-style notification and Answer/Decline actions.

The test covers native invite validation, Telecom registration, the phone-call foreground service, call notification/UI, and the native decline endpoint. It runs before the app's JavaScript call controller and uses no real contacts or provider push. It does not verify Firebase/APNs wakeup, a real authenticated backend ticket, TURN connectivity, or two-way sound. Application integration tests cover actual server authentication independently; physical device/provider/media validation is still pending.

Run `RAKKY_NATIVE_CALLS_ENABLED=true npx expo prebuild --platform android --no-install`, then build a native-enabled Android debug APK and run from `mobile`:

```sh
npm run test:native-calls-ui -- --serial emulator-5554
```

The script updates the debug app without deleting its stored account data, clears its synthetic native call state afterward, and removes its ADB reverse mapping. It deliberately accepts only emulator targets. The shell-only injection receiver is protected by the system DUMP permission and excluded from release builds.

The latest combined review is in [the communication audit](../communication-audit/README.md). The smoke test also checks installed camera/microphone permission declarations. Its synthetic invite lasts 59 seconds to allow slow emulator UI inspection within the handler’s 60-second bound; the real backend ring window remains 30 seconds.
