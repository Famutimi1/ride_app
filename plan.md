# Cloudinary implementation plan

Prepared for Rakky Ride on 22 October 2026.

Status: initial implementation completed locally on 22 October 2026. The official SDK, migration 021, authenticated upload routes, private document proxy, durable cleanup reconciliation, and Expo photo controls are implemented. See [setup and verified behavior](docs/features/cloudinary.md). Production deployment and migration of existing identity documents are separate rollout tasks.

Implementation adjustment: **all driver documents use authenticated raw storage**, including JPEG, PNG and WebP. A synthetic live check showed that Cloudinary image storage rewrote the supplied PNG. Raw storage passed byte-for-byte image/PDF round trips and unsigned-access rejection, preserving originals for review. Avatar images still use sanitized public image storage.

Replaced driver documents are retained until a retention policy is chosen. Failed uploads and replaced/removed managed avatars become cleanup candidates after 24 hours. A read-only inventory command is available; no real existing documents were migrated. Android/iOS device checks and Coolify staging checks remain release work.

## 1. What this will do

Store rider and driver profile pictures and driver application documents in Cloudinary. PostgreSQL will keep ownership and asset references. The backend will control uploads, replacements, and document access.

Proposed flow:

```text
Expo app -> authenticated backend upload -> Cloudinary
                         |
                         +-> PostgreSQL: owner and asset metadata

Staff dashboard -> authorized backend document route
                         -> private Cloudinary download -> document bytes
```

Keep the existing single account shared by rider and driver roles. A user's photo belongs to their account; changing roles must not create another photo record. Car and motorcycle applications continue to use their existing document rules.

## 2. What exists today

- `backend/src/modules/driver/driver.routes.ts` accepts three multipart files: `license`, `vehicleRegistration`, and `insurance`. Multer uses memory storage with an 8 MiB limit per file and a three-file limit.
- `driver.service.ts` checks file signatures for PDF, JPEG, PNG, and WebP, then writes files under `.private-uploads/driver-documents/<userId>/`. Existing database columns contain `private://driver-documents/...` references.
- `backend/src/modules/driver/admin.service.ts` reads those local files. The existing staff document endpoint checks staff permissions and records document inspection in the audit log. The normal application response exposes document availability rather than document URLs.
- Docker creates the private upload directory, but its contents need persistent storage to survive container replacement. Files on one backend instance are not automatically available to other instances.
- `users.avatar_url` already exists and can be populated by Google sign-in. There is no custom profile-photo upload endpoint. The profile update endpoint currently accepts only name and email.
- `mobile/src/screens/shared/ProfileScreen.tsx` currently displays an initials avatar without passing the user's `avatarUrl` to it. The shared `Avatar` component already supports a URI.
- The real centralized environment file is `backend/src/config/env.ts`; implementation must extend that file rather than creating a second environment configuration system.

## 3. Cloudinary decisions

### Backend uploads

Use authenticated uploads from Express. Reuse the existing multipart document flow and introduce a separate single-photo endpoint. The mobile app needs only its existing backend API URL.

The official Node SDK provides `upload_stream`, which fits the existing Multer buffers. It does not remove the memory cost of those buffers, so bounded request sizes and upload concurrency are still required. This plan proposes adding the official `cloudinary` backend package during implementation, as authorized by the implementation request. The official SDK is now installed as part of the implementation. [Cloudinary Node upload guide](https://cloudinary.com/documentation/node_image_and_video_upload)

Do not add unsigned upload presets or a client-side signature endpoint in the initial implementation. They are unnecessary for this backend-mediated flow. Never accept a client-supplied Cloudinary asset ID, remote URL, owner ID, delivery type, or folder as authority to update an account.

### Profile pictures

Proposed initial policy: a sanitized avatar derivative is public CDN media, using `resource_type: image` and `type: upload`. Anyone with its URL could view it. This is the implemented initial visibility policy; authenticated avatar delivery would require a separate product change.

Accept JPEG, PNG, and WebP, with a proposed 5 MiB limit. Check actual file bytes, dimensions, and pixel limits; reject SVG, animated formats, PDF, and unsupported encodings. Produce a bounded, static avatar, normalize orientation, remove unnecessary metadata, and verify the result before exposing its URL. Preserve the original framing unless the user chooses a crop. Do not expose an untouched original containing metadata as the avatar.

### Driver documents

Use `type: authenticated` and `resource_type: raw` for every driver document to preserve its original bytes (see the verified adjustment above). A raw PDF cannot use image transformations; provide the original through the existing staff viewer/download flow. Keep the current 8 MiB file limit and current allowlist.

Cloudinary distinguishes `private` originals from `authenticated` assets, which also protect derivatives. Public `upload` delivery is unsuitable for identity and vehicle documents. This is why the plan uses authenticated documents. [Upload customization and delivery types](https://cloudinary.com/documentation/upload_parameters)

Use random asset names under an environment-specific prefix. Do not put licence numbers, registration plates, email addresses, or original filenames into public IDs, folder names, or provider tags. Keep metadata to the minimum needed for ownership and lifecycle tracking.

### Document access

Preserve `GET /api/admin/driver-applications/:id/documents/:kind`, staff authorization, kind allowlisting, and audit logging. Resolve assets from the database, never from an arbitrary URL supplied by the caller.

After authorization, the backend should generate a short-lived `private_download_url`, fetch it from Cloudinary, and return bounded bytes through the existing endpoint. Do not give that provider URL to the dashboard or mobile app. Apply `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, safe filenames, and the verified content type. Restrict fetch destinations to the configured Cloudinary environment and reject unexpected redirects.

A normal signed delivery URL should not be treated as an automatically expiring access grant. Use the explicit expiry facility for temporary downloads; this API delivery path does not use the CDN cache. Cloudinary documents a bandwidth tradeoff for this method, so include it in usage monitoring. [Media access controls and temporary downloads](https://cloudinary.com/documentation/control_access_to_media)

## 4. Account and environment setup

1. Create or sign in to the intended account at [Cloudinary Console](https://console.cloudinary.com/).
2. Select a development product environment. Keep production separate where the account permits it; otherwise use separate prefixes and credentials with appropriate access.
3. Find the **cloud name**, **API key**, and **API secret** in the product environment/API Keys settings. The Node SDK supports these as explicit configuration values. [Node configuration guide](https://cloudinary.com/documentation/node_integration)
4. Copy the Cloudinary block in `backend/.env.example` into your ignored `backend/.env`. Fill the three credential values locally. Do not send the secret in chat or commit it.
5. Leave `CLOUDINARY_ENABLED=false` until the implementation and staging tests are complete. These are proposed application settings, not settings automatically understood by Expo or Cloudinary.
6. On Coolify, put the same values into the **backend application's runtime environment variables**. Use the production prefix and production credentials there. Do not put secrets into Docker build arguments or the Expo dashboard.
7. Verify private PDF downloads in staging. Free Cloudinary accounts may block PDF delivery until the product environment's Security setting allows PDF/ZIP delivery. Check that setting only if required, and retain authenticated asset delivery; allowing the format does not justify publishing private documents. The application will still reject ZIP uploads. [Image and file delivery restrictions](https://cloudinary.com/documentation/image_delivery_options)
8. Set usage alerts and review storage, transfer, transformation, and account quota limits for the chosen environment. Confirm the account's terms and retention choices for storing driver identity documents before production migration.

### Variables to fill

The actual placeholders are in `backend/.env.example` and `backend/.env.production.example`.

- `CLOUDINARY_ENABLED=false`: proposed rollout switch. Turn on only after implementation and staging verification.
- `CLOUDINARY_CLOUD_NAME=`: cloud name for the chosen product environment.
- `CLOUDINARY_API_KEY=`: that environment's API key, backend only.
- `CLOUDINARY_API_SECRET=`: matching API secret, backend only.
- `CLOUDINARY_ASSET_PREFIX=rakky-ride/development`: proposed asset namespace; production template uses `rakky-ride/production`. A prefix helps organization and must not be treated as access control.
- `CLOUDINARY_UPLOAD_TIMEOUT_MS=30000`: proposed upload deadline. Implementation must validate a positive, bounded integer and handle ambiguous timeout outcomes.
- `CLOUDINARY_PRIVATE_DOWNLOAD_TTL_SECONDS=60`: proposed expiry for the internal temporary document download URL. Validate an explicit safe range, such as 30–300 seconds.

Use the explicit credential fields above rather than configuring both those fields and `CLOUDINARY_URL`. No Cloudinary variables are needed in `mobile/.env`; none of the secret values may have an `EXPO_PUBLIC_` prefix.

When enabled, missing or invalid credentials must stop startup with a clear configuration error. Provider failures must not silently switch production uploads back to local disk. When disabled during rollout, preserve the existing local document behavior and keep new avatar uploads unavailable with a clear message. Cloudinary-backed document reads must remain supported during rollback while their credentials remain configured.

## 5. Implementation work

### Phase A: backend storage and asset metadata

1. After dependency approval, add the official Node SDK to `backend/package.json` and its lockfile.
2. Add typed Cloudinary configuration and validation to `backend/src/config/env.ts`.
3. Add a small provider utility, for example `backend/src/shared/utils/cloudinary.ts`, for upload, temporary download, and deletion. Keep account and application rules in the existing auth and driver modules. Do not add a new server or standalone media service.
4. Propose additive metadata columns on existing `users` and `driver_profiles` records. No new table is currently proposed. Obtain approval for the exact migration before creating it.
5. Store ownership plus `asset_id`, `public_id`, resource type, delivery type, version, format, byte count, and content checksum. Store the current avatar URL in `users.avatar_url` for existing clients. Retain pending cleanup references until deletion succeeds.
6. Preserve the existing document-reference columns for local records. Add explicit provider metadata for Cloudinary records instead of inserting a publicly usable document URL into responses. Do not attempt to reconstruct asset IDs by parsing arbitrary URLs.

### Phase B: document uploads and staff review

1. Validate all three files before calling Cloudinary. Preserve account-active, application-editable, approved-driver review, and active-trip restrictions.
2. Refactor the current controller transaction boundary: check eligibility and capture an application material version, then upload outside a database transaction. Do not hold PostgreSQL locks while waiting on Cloudinary.
3. Add an opaque material version to the application status contract and send it as an `If-Match` header with the upload. The multipart body can retain its existing three file fields. Recheck the version and eligibility under the existing user-to-profile locking order before committing asset metadata.
4. Commit all three document references together. A partial provider upload, concurrent application change, or database failure must leave the previous document set intact.
5. Adapt `readPrivateDocument` to dispatch between legacy local storage and Cloudinary. Keep path checks for legacy files and provider validation for remote files. Preserve the existing audited staff endpoint and dashboard response shape.
6. Clean up newly uploaded assets when a request fails. Retain old assets until the replacement commits and the agreed retention policy permits deletion.

### Phase C: profile-photo upload

1. Add an authenticated single-file route under the existing auth/profile module, for example `POST /api/auth/profile/avatar`, with multipart field `avatar`.
2. Do not send this through the current JSON-only auth body validation middleware unchanged: give the multipart endpoint its own parsing/validation path. Keep the existing name/email endpoint's allowlist.
3. Enforce self ownership, active account, file limits and request limits. Updated product policy (22 October 2026): both riders and approved drivers can change their profile photo without staff approval. Block photo replacement during active trips; names and identity documents keep their separate review rules.
4. Upload a new unique asset, then atomically replace the user's current avatar metadata. Use a version check so concurrent uploads cannot delete the winning avatar. Return the updated public user payload through the normal auth-store update flow.
5. Add a remove-photo action with the same ownership and active-trip rules, without staff approval. Clear the database reference first; schedule managed asset cleanup afterward. Never delete a Google-hosted photo or a default brand asset through Cloudinary cleanup.

### Phase D: Expo and dashboard integration

1. Start with the already installed `expo-document-picker` to choose a supported image file for the profile page. Reuse the existing document picker for onboarding. No additional mobile dependency is required for this first version.
2. If a camera, device photo-library picker, or interactive crop is wanted, propose `expo-image-picker` separately before installing it, then consult the project's exact Expo 57 documentation and configure permissions during that implementation.
3. Show selected photo/file previews, progress/busy state, retry, and concise error messages. Cancelling a picker must leave the current asset unchanged.
4. Pass `avatarUrl` into the profile view's existing `Avatar uri` property. Update the shared account/session state so menus and trip surfaces render the same photo in both roles.
5. Keep native multipart file objects and web `Blob`/`File` handling compatible with the current upload service. Do not persist device-local file URIs as server asset references.
6. Verify the dashboard can still view each document through its backend endpoint. Do not embed private Cloudinary URLs into application lists, notifications, logs, or exports.

## 6. Failure handling, migration, and rollout

- Database commits and Cloudinary uploads are separate operations. Use unique asset IDs, compensating cleanup, and version checks; do not assume a SQL rollback removes uploaded files.
- Reuse the existing durable BullMQ/Redis infrastructure for bounded cleanup retries. Retain pending cleanup metadata until success. Add reconciliation for crashes between provider upload, database commit, and queueing. Only delete confirmed unreferenced assets in the configured application namespace after a safety window; never broadly delete a folder.
- Apply per-user upload rate limits and bounded concurrent uploads. Keep logs to request IDs, asset identifiers, error categories, and byte counts. Exclude file contents, secrets, signed URLs, original document names, and document identifiers.
- Use HTTPS, conservative timeouts, bounded download size, and deliberate retries. A network timeout can occur after an upload succeeded; reconciliation must account for that case.
- Stage migration using synthetic files first. Then prepare a dry-run inventory of existing local references, file existence, sizes, and checksums. Do not upload real identity documents as an incidental test.
- Keep dual reads during migration: existing `private://` references remain readable, and only newly migrated records use Cloudinary metadata.
- For each migration batch, upload privately, verify bytes/checksum and authorized reads, and atomically switch the database reference if it has not changed. Make the job resumable and keep an audit manifest that contains no signed URLs or secrets.
- Keep original local files and a database backup until migration verification and the agreed retention window are complete. Do not remove the Coolify persistent volume while any legacy references remain.
- Retain old and new read support during rollback. Reverting the upload flag alone cannot make Cloudinary assets available to an older binary that understands only local paths.
- Decide document replacement, account deletion, audit, and provider-backup retention together before enabling automatic deletion. Cache invalidation is not instant erasure of already downloaded content. Cloudinary's deletion API identifies the asset by its resource/delivery type or asset ID; CDN invalidation is a separate option. [Upload API lifecycle reference](https://cloudinary.com/documentation/image_upload_api_reference)

## 7. Acceptance checks before production

- [ ] Wrong MIME type, mismatched file signatures, unsupported extensions, oversized files, and excessive multipart fields are rejected before upload.
- [ ] A rider and a driver can select an avatar for their own shared account; another user's assets cannot be replaced, read, or deleted.
- [ ] Approved-driver identity restrictions and active-trip guards still work.
- [ ] All three document uploads commit together. Replacing one set cannot leave mixed old/new metadata after failure.
- [ ] Documents are inaccessible through unsigned/public asset URLs, including image derivatives; PDFs work with authenticated raw delivery.
- [ ] Staff document reads require the existing permissions, generate an audit entry, and preserve no-store behavior. Provider URLs are not exposed in ordinary API payloads.
- [ ] Internal temporary download URLs expire as configured; secrets and URLs are redacted from error logs.
- [ ] Timeout, quota, partial upload, database rollback, concurrent replacement, and cleanup failure paths preserve the last valid asset set.
- [ ] Legacy local files remain readable throughout migration and rollback. Missing originals are reported rather than silently discarded.
- [ ] Both role views, profile/menu photos, application status, and dashboard previews work on web and Android; iOS is checked before an iOS release.
- [ ] Backend and mobile `npm run typecheck` pass; mobile lint and focused upload/access/lifecycle tests pass.
- [ ] A staging Coolify redeploy and a second backend instance can read newly stored assets without relying on a local upload volume.

## 8. Scope and decisions still to approve

The implementation request authorized the SDK and additive metadata fields on existing tables. Public sanitized avatars are self-service for riders and drivers under the updated product policy. Approved-driver name and document protections remain. Replacement document deletion remains disabled pending a retention decision. No production deployment, historical-document migration, or automated account-deletion policy has been run.
