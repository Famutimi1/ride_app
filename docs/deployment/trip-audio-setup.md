# Set up real trip audio calls

Use this guide to configure public TURN fallback and native push delivery. The existing local Firebase service-account credential has already been reused and verified with an FCM dry run. Start with **two Android phones**; add iOS after Android calling works. The implementation uses WebRTC for direct audio when possible, Coturn as a fallback relay, Firebase Cloud Messaging (FCM) for Android incoming calls, and Apple PushKit/APNs for iOS incoming calls. WebRTC ICE checks available routes together and prefers direct connectivity; a fallback relay must still be configured before enabling calls.

This guide prepares a private staging test. Local development already has communication migrations 023–027 applied and messaging, audio, video and Android native push configuration available. Public TURN deployment and physical-device push/media delivery remain unverified. The implementation and verification history are in [the second-phase technical notes](trip-audio-phase-two.md).

For local same-network browser testing before TURN is available, use the automatic development-only direct-call mode described in [local testing](../testing/local-direct-audio/README.md). It is now enabled on the local development backend. The public relay/provider setup below remains necessary for reliable production calling.

## 1. Gather the accounts and staging endpoints

You need:

- Access to the Firebase project used by `mobile/google-services.json`, and permission to manage its service accounts.
- An Expo account with access to the existing EAS project. The Android package and iOS bundle ID are both **`com.rackyride.app`**; keep that spelling even though the product is called Rakky Ride.
- A public Linux VM with a stable public IPv4 address, direct UDP/TCP access, and a DNS name you control, such as `turn.example.com`. Use a separate TURN host so its TCP port 443 is available.
- A staging HTTPS backend that both phones can reach, with working PostgreSQL, Redis, and WebSocket forwarding. `localhost:8081` is the web preview; it does not provide native phone calling.
- Two Android phones with Google Play services, microphone access, and separate rider/driver test accounts assigned to the same active trip.

For iOS later, you also need Apple Developer Program access with an Account Holder/Admin able to create keys, a registered App ID, and physical iPhones registered for the chosen distribution method. EAS can build remotely; local iOS compilation requires Xcode, which is not installed on this Mac.

Choose actual staging API and TURN hostnames before filling in examples. Do not enter passwords, private keys, or downloaded service-account JSON into chat.

## 2. Prepare secret storage

Keep server keys outside the repository. On this Mac, the following command creates a protected directory and generates two independent secrets into a new file. It refuses to overwrite an existing file and prints no secret values:

```sh
node <<'NODE'
const { mkdirSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const directory = join(process.env.HOME, '.config/rakky-ride/staging');
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(join(directory, 'call-secrets.env'), [
  `TURN_SHARED_SECRET=${randomBytes(32).toString('hex')}`,
  `CALL_PUSH_TOKEN_KEY=${randomBytes(32).toString('base64')}`,
  '',
].join('\n'), { mode: 0o600, flag: 'wx' });
console.log('Created the protected staging secret file.');
NODE
```

Use a private editor or your hosting secret manager to supply these values to the backend. Keep the token encryption key stable and back it up securely: losing or replacing it prevents reading existing encrypted push registrations. TURN and the backend must share exactly the same `TURN_SHARED_SECRET`. Use different secrets for production.

On a deployed backend, mount credential files read-only, for example at `/run/secrets/rakky-fcm.json` and `/run/secrets/rakky-apns.p8`, readable by the backend process. In Coolify, use private persistent file mounts plus backend **runtime** variables. A Mac file path will not exist inside the deployed container. See [the existing backend deployment guide](../../backend/docs/coolify-deployment.md).

## 3. Set up the TURN relay

### Host, DNS, firewall, and certificate

1. Provision the Linux VM and point a DNS A record for your chosen relay hostname to its public IPv4. Use a direct DNS record; an ordinary HTTP/CDN proxy cannot carry TURN traffic. Do not add an AAAA record until IPv6 listening, routing, and firewall rules have been configured and tested.
2. Install Docker Engine and the Compose plugin using [Docker's Linux instructions](https://docs.docker.com/engine/install/ubuntu/).
3. Allow incoming **3478 UDP and TCP**, **443 TCP**, and **49160–49359 UDP** in both cloud and host firewalls. Preserve SSH access. The host also needs outbound connectivity to the other relay allocations. Behind NAT, forward the same public ports without changing their numbers.
4. Obtain a publicly trusted TLS certificate whose hostname matches the relay DNS name. [Certbot's instructions](https://certbot.eff.org/instructions) cover installation and issuance. DNS validation can issue the certificate without occupying port 443. An HTTP challenge needs its own reachable port 80. Record the full certificate-chain and private-key file locations.

The repository's Compose file uses **Linux host networking**. Running it in Docker Desktop on this Mac does not establish this public relay deployment. The prepared configuration uses UDP relay allocations, including when a phone reaches the TURN listener over TCP/TLS. See [Coturn configuration](https://github.com/coturn/coturn/wiki/turnserver).

### Generate the protected configuration on the Mac

In a terminal, replace the three example network values. `TURN_RELAY_IPV4` must be an address actually assigned to the Linux host: use its private interface IPv4 when the public IPv4 is provided by NAT, or the public IPv4 when it is assigned directly.

```sh
cd /Users/mac/Desktop/project/ride_app/backend
set -a
. "$HOME/.config/rakky-ride/staging/call-secrets.env"
set +a
export TURN_REALM=turn.example.com
export TURN_PUBLIC_IPV4=203.0.113.10
export TURN_RELAY_IPV4=10.0.0.10
npm run prepare:turn -- --output "$HOME/.config/rakky-ride/staging/turnserver.conf"
unset TURN_SHARED_SECRET CALL_PUSH_TOKEN_KEY
```

`203.0.113.10` is a documentation address; replace it. The generator creates a mode-0600 file and refuses overwrite. Its initial allocation/bandwidth limits are starting settings that need load testing.

### Install and start on the Linux host

Copy the generated `turnserver.conf` privately over SSH and copy `backend/docker/turn/compose.yaml` plus `.env.example` to an operator-owned directory on the VM, such as `/opt/rakky-turn`. Do not copy the backend encryption key or Firebase/Apple keys to the relay.

On the VM, install the configuration and certificate into a dedicated directory. These commands assume the container's default UID/GID **1000:1000**; replace the example upload and certificate paths first:

```sh
sudo install -d -o root -g 1000 -m 0750 /etc/rakky-turn
sudo install -o 1000 -g 1000 -m 0600 /home/operator/turnserver.conf /etc/rakky-turn/turnserver.conf
sudo install -o 1000 -g 1000 -m 0600 /etc/letsencrypt/live/turn.example.com/fullchain.pem /etc/rakky-turn/fullchain.pem
sudo install -o 1000 -g 1000 -m 0600 /etc/letsencrypt/live/turn.example.com/privkey.pem /etc/rakky-turn/privkey.pem
cd /opt/rakky-turn
cp -n .env.example .env
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
```

If Docker requires elevated access on the host, use the host's approved Docker administration method. Review service logs locally for startup/bind/certificate errors; they may contain connection details and should not be published. Remove the temporary uploaded configuration once the installed copy is confirmed. Changing UID/GID requires matching file ownership and directory access.

Check DNS and TLS from outside the VM:

```sh
dig +short A turn.example.com
openssl s_client -connect turn.example.com:443 -servername turn.example.com -verify_return_error -verify_hostname turn.example.com </dev/null
```

Use an OpenSSL version that supports hostname verification. DNS/TLS success does **not** prove authenticated TURN allocations or sound; the phone tests below establish those. The backend will issue short-lived TURN credentials. Never paste the shared secret into a public WebRTC test site.

Set up certificate renewal before leaving the service running unattended. A renewal deploy hook must copy the new full chain/private key into the dedicated mounted files with the same ownership, then recreate the container so it reads the new files. Schedule this around tests because existing calls may disconnect. Test the hook and monitor certificate expiry. Preserve the relay restrictions; do not allow private-network peers just to make a test pass.

## 4. Obtain the Firebase server credential for Android

1. Open [Firebase Console](https://console.firebase.google.com/). Select the project matching `project_info.project_id` in the existing `mobile/google-services.json`. Confirm its registered Android app has package `com.rackyride.app`.
2. In Project settings → Cloud Messaging, confirm the **Firebase Cloud Messaging API (HTTP v1)** is enabled. If necessary, enable that API in the same Google Cloud project. The legacy server key is not used.
3. For a dedicated sender identity, open Google Cloud Console → IAM & Admin → Service Accounts in that same project. Create a service account such as `rakky-call-sender`, grant **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`) in the project, and create a JSON key from its Keys tab. This grants messaging access without granting the server Project Owner access. Organization policy may require an administrator to create or authorize key use.
4. Firebase also documents Project settings → Service accounts → Generate New Private Key for its existing service account. This is an alternative if that is your organization's chosen account; do not create both keys just for this test. Existing broad Firebase service-account roles should be reviewed before production.
5. Move the downloaded JSON into `$HOME/.config/rakky-ride/staging/fcm-service-account.json`, protect it with `chmod 600`, and securely mount a copy on the staging backend. Keep its `private_key` out of the app and Git.
6. The backend automatically uses the existing `~/.config/rakkyride/credentials/expo-fcm-v1.json` on this Mac, or a file mounted at `/run/secrets/rakky-fcm.json` on the server. No path or project ID environment value is needed at those locations. A different deployment may explicitly override the path using `CALL_FCM_CREDENTIALS_FILE` or `GOOGLE_APPLICATION_CREDENTIALS`.

The backend uses the selected service-account JSON and Google's authentication library for HTTP v1. `google-services.json` configures the Android app; it cannot authorize server sends. An Expo push access token does not replace the FCM credential.

Sources: [Firebase service-account setup and HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [FCM IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging).

## 5. Configure and migrate the private staging backend

Merge these values into the existing staging configuration. Preserve existing database, Redis, authentication, and other application settings. Use the actual secrets from step 2 and actual runtime file paths:

```dotenv
# Optional address discovery: STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp
TURN_SHARED_SECRET=REPLACE_WITH_THE_GENERATED_TURN_SECRET
CALL_PUSH_TOKEN_KEY=REPLACE_WITH_THE_GENERATED_BASE64_KEY
# Firebase JSON is automatically loaded from /run/secrets/rakky-fcm.json.

# Add Apple provider settings only when shipping iOS; see step 8.
```

Local development already uses the fixed Mac credential-file location automatically. Keep other backend secrets in the ignored `backend/.env`. Do not overwrite that file from `.env.example` or use these placeholder values as real credentials.

Before applying migrations:

1. Back up the intended staging database and confirm its identity privately.
2. Review **all pending migrations**, since the runner applies every unapplied numbered file, not only audio changes.
3. Drain existing API/message writers and background jobs for migration 023's locking/backfill cutover. Avoid overlapping old/new writers or an automatic rolling deployment during this step.
4. Run the project's migration runner once from `backend`, with the intended staging `DATABASE_URL` and suitable migration permissions:

   ```sh
   npm run migrate
   ```

   In a compiled release container, the equivalent is `npm run migrate:deploy`. The Docker startup script can run migrations automatically; use either the controlled startup route or a release job as described in [backend deployment](../../backend/docs/coolify-deployment.md#7-automatic-database-setup-before-api-startup). The npm migration command itself uses `DATABASE_URL`; it does not automatically select `MIGRATION_DATABASE_URL` the way the startup script does.
5. Confirm communication migrations 023–027 were applied, then start the updated backend and its required workers.
6. Messaging, audio and video use normal product defaults and need no separate enable switches. Native push capability is derived from provider credentials and the token-encryption key. Production calling requires TURN; local development supports direct-only testing automatically. Restart the intended staging backend after configuring credentials and relay settings, and complete device tests before distributing the build widely.

Run the read-only check from the backend workspace/runtime using the same configuration:

```sh
npm run check:audio -- --require-ready
```

For Android-first testing, expect `audioEnabled`, `nativeEnabled`, `pushTokenEncryption`, `migrations`, and `fcm` to be `true`, and `readyForProviderTesting: true`. `apns: false` is expected until Apple setup is complete. Failure exits nonzero. The check validates key format and migration presence; it cannot establish provider IAM permission, TURN allocation, native signing, or audible sound.

## 6. Build the Android app with incoming calls enabled

The native bridge is included by default and needs a **new native binary**. Expo Go, the browser, and an over-the-air JavaScript update cannot add it.

In the existing EAS project's **preview** environment, set these non-secret build values using Project settings → Environment variables:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://YOUR_STAGING_API_HOST
```

Android needs only the backend URL here. Set the APNs environment only when preparing an iOS distribution build; it has no Android effect. Retain the existing Maps/Google sign-in configuration. `mobile/app.config.ts` requires both platform Maps keys or the shared Maps key even when building Android.

Upload the matching **client** `mobile/google-services.json` as an EAS file variable named `GOOGLE_SERVICES_JSON` for preview. The app config already reads that variable. Do not upload the Firebase service-account JSON as this file. Private backend keys and TURN secrets belong only on the backend/relay.

Build from the relocated project folder:

```sh
cd /Users/mac/Desktop/project/ride_app/mobile
npx eas-cli@latest whoami
npx eas-cli@latest build --platform android --profile preview
```

Sign in with the authorized Expo account if needed. The existing `preview` profile uses internal distribution and includes its JavaScript bundle, so testing does not depend on Metro. Install the resulting Android build on both phones; matching signing credentials are needed to update an existing installation. Avoid uninstalling an app with data you need to preserve.

For local builds, rebuild using the existing native development workflow; no native-call enable variable is needed. Set the APNs environment only to match an iOS signing environment. Backend credentials cannot enable a bridge omitted at build time.

Source: [EAS environment variables and file variables](https://docs.expo.dev/eas/environment-variables/manage/), [EAS build profile configuration](https://docs.expo.dev/eas/json/).

## 7. Verify a real Android call

1. Open the new app on both physical phones, sign in as different test participants, allow microphone/notification permissions, and keep app push notifications enabled. Open each app after installing so its native FCM token can register against its authenticated session. Allow any OS call-account settings requested by the app.
2. Create or use a staging trip with the two accounts as its actual rider and assigned driver in a callable state. Calling is authorized from server trip membership. A role toggle alone does not create permission.
3. First call with both apps open on a network that allows direct connectivity. Confirm both phones hear each other; test mute, speaker, and end from each side. Inspect authorized WebRTC diagnostics for a selected direct candidate pair (`host`, `srflx`, or `prflx`, with neither endpoint `relay`) and increasing audio byte counters. Then repeat with direct peer connectivity blocked while keeping the TURN host reachable, and confirm a selected pair with a `relay` candidate and two-way sound. Provider acceptance or a call timer is not proof of sound. Never publish candidate addresses in shared logs.
4. Put the recipient app in the background and lock the phone. Call again; check incoming native Answer/Decline controls, answer, and confirm two-way sound while the app remains backgrounded. Repeat after ordinary process termination and record the state. User force-stop/force-quit has different delivery restrictions.
5. Test decline, unanswered timeout, caller cancellation, and answering on another registered device. Check the other devices stop ringing.
6. Put one phone on Wi-Fi and the other on cellular. Change networks during the call. Make a call longer than five minutes to cover credential renewal.
7. Test on a network that blocks the phone's outbound UDP: the TURN **TLS/TCP 443** endpoint must still establish sound. The relay host's own UDP allocation ports remain open. Record selected candidate transport rather than assuming TLS fallback occurred.

If the app works in the foreground but does not ring when locked, investigate FCM registration, provider configuration/delivery, notification permission, and native build settings. If it rings but has no sound, investigate TURN authentication, public/private IP mapping, relay firewall rules, TLS, and microphone/audio routing. Firebase Console's ordinary notification composer does not reproduce the signed native call-invite payload; use the app to initiate a call.

Record phone models, OS versions, app build IDs, network conditions, and each result. Test Bluetooth, cellular interruption, and service outages before wider release. A single working test is not a production readiness claim. The synthetic emulator check is useful for native UI regression but does not replace these tests.

## 8. Add Apple VoIP credentials and an iOS build

Do this after the Android path works, or in parallel once the Apple team is ready.

1. In [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), select/register the explicit App ID **`com.rackyride.app`** and enable Push Notifications. Refresh the provisioning profile after changing capabilities. See [Apple's capability instructions](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/).
2. Under **Keys**, create a key with Apple Push Notification service enabled. Apple now asks for an environment and key scope. For the first internal iOS distribution test, use a **Production, Team Scoped** APNs key. It covers the team's topics, including the app's VoIP topic `com.rackyride.app.voip`. Use a Sandbox key separately for a build signed with the development APNs entitlement. Do not assume a newly created key works in both environments.
3. Download the `.p8` file and record its **Key ID** and your Apple **Team ID**. Apple permits downloading the key file once; store a secure backup. Place it outside Git and mount it read-only on the backend. See [Apple key creation](https://developer.apple.com/help/account/keys/create-a-private-key) and [APNs key scopes/environments](https://developer.apple.com/documentation/UserNotifications/establishing-a-token-based-connection-to-apns?language=objc).
4. Add backend runtime values for the distribution test:

   ```dotenv
   CALL_APNS_KEY_FILE=/run/secrets/rakky-apns.p8
   CALL_APNS_KEY_ID=YOUR_10_CHARACTER_KEY_ID
   CALL_APNS_TEAM_ID=YOUR_10_CHARACTER_TEAM_ID
   CALL_APNS_SANDBOX=false
   ```

5. In the EAS **preview** environment, set `RAKKY_APNS_ENVIRONMENT=production`, the staging API URL, and required Maps/sign-in variables. Register the test iPhones for internal distribution when EAS requests it, then build:

   ```sh
   cd /Users/mac/Desktop/project/ride_app/mobile
   npx eas-cli@latest device:create
   npx eas-cli@latest build --platform ios --profile preview
   ```

6. Inspect the **signed app's** `aps-environment` entitlement. For an Ad Hoc/TestFlight distribution build it should be `production`, matching backend `CALL_APNS_SANDBOX=false` and a Production APNs key. For an Xcode development-signed app, use `development`, backend `true`, and a Sandbox key. The profile name `development` alone is not evidence: this project's EAS development profile also requests internal distribution. Keep the first iOS test cohort on one APNs environment; the current backend uses one APNs environment globally.
7. Restart the staging backend and rerun `check:audio`; expect `apns: true` as well. Install/open/sign in on each test iPhone, grant permissions, and repeat the Android test matrix for iOS-to-iOS and Android-to-iOS in both directions.

The backend sends PushKit requests directly to APNs with the `.voip` topic. An Expo push token, standard APNs device token, Firebase iOS config, or EAS-managed ordinary push setup does not by itself configure this server's VoIP key. The existing plugin adds push entitlement and audio/VoIP background modes, but a correctly signed build and real delivery still need verification. See [Apple PushKit handling requirements](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit).

## 9. Before wider rollout

Keep separate staging/production secrets and provider settings. Validate a second independent relay, certificate renewal, bandwidth/capacity, push retries, app logout, interrupted calls, and Redis/backend/provider outages. Monitor overdue delivery work and native/media failures without logging credentials or private payloads. Complete the physical device gates in [the technical notes](trip-audio-phase-two.md#remaining-exit-gates).

Existing optional incident overrides remain supported. To stop new native wakeups, set `COMMUNICATION_NATIVE_CALLS_ENABLED=false` and restart backend instances. To stop audio calls, set `COMMUNICATION_AUDIO_ENABLED=false`; active calls terminate through reconciliation. Retain the additive migrations and records. Do not roll back to a legacy Expo push worker that cannot distinguish native token rows.

### Setup completion checklist

- [ ] Staging API is reachable from both phones over HTTPS with working WebSockets.
- [ ] Public TURN DNS, certificate, listener ports, NAT mapping, and relay allocations are verified.
- [ ] Stable server secrets and read-only provider files are stored privately and backed up.
- [ ] Migration cutover is complete and updated backend workers are healthy.
- [ ] Android provider readiness passes; fresh native preview builds register both participants.
- [ ] Direct audio, TURN fallback with direct routes blocked, locked-screen ringing, TLS fallback, and a call over five minutes pass.
- [ ] Apple key environment, app entitlement, backend endpoint, and physical iOS tests pass before enabling iOS.
- [ ] Production rollout checks and operational ownership are agreed before public enablement.
