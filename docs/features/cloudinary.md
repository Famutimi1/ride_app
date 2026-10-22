# Cloudinary media storage

Implemented 22 October 2026. Provider secrets belong only in the backend runtime environment. Expo needs its existing API base URL; no Cloudinary credentials belong in the app or its bundle.

## Local use

1. Fill the Cloudinary block in `backend/.env` using the environment's cloud name, API key and API secret. Use a separate environment/prefix for production.
2. Install backend packages with `npm ci` and run `npm run migrate` from `backend/`. Migration **021_cloudinary_media.sql** adds JSON metadata, a photo revision and durable cleanup intents to existing account/application records. It creates no new table.
3. Run `npm run test:cloudinary` to upload disposable generated fixtures, verify public avatar sanitation, verify private image/PDF downloads and unsigned-access rejection, then delete those fixtures. This intentionally contacts the configured provider; it never selects real user files.
4. Set `CLOUDINARY_ENABLED=true` and restart the backend. Keep Redis/BullMQ running for cleanup reconciliation.
5. Open **Menu → View profile → Change photo**, choose a JPEG/PNG/WebP up to 5 MiB, review its preview and press **Save photo**. **Remove photo** removes the account reference and schedules managed-asset cleanup. Both app roles share the same photo.
6. Driver onboarding's existing three document pickers now upload to Cloudinary when enabled. PDFs, JPEGs, PNGs and WebP files are accepted up to 8 MiB each. Submit the application using the existing steps.

Both riders and drivers, including approved drivers, can upload, replace or remove their profile photo without staff approval. Active trips temporarily block photo changes. Reviewed names and identity documents retain their existing staff-review restrictions.

Phone registrations use a name-initials avatar by default (for example, Ada Okeke → AO), without creating or uploading a placeholder file. Google registrations use the profile photo supplied by Google when available. Missing or failed photos fall back to initials in the shared avatar component. Removing a photo also returns to initials; subsequent Google login does not restore an explicitly removed or replaced photo.

## Storage and access

- Avatars: public image assets, incoming maximum 512 × 512, orientation normalization, JPEG output, `force_strip` and `strip_profile`. Static formats only; byte signatures, dimensions, decoded-pixel bounds, file extensions and MIME types are checked. Framing is preserved without forcing a square crop.
- Driver documents: **authenticated raw assets for every format**. Cloudinary image upload rewrote our synthetic PNG; raw image/PDF round trips preserved the exact bytes. Private images therefore do not support transformations in this implementation.
- IDs are random under `CLOUDINARY_ASSET_PREFIX`; original filenames, plates and identity numbers are not provider asset names. PostgreSQL owns the asset references and checksum.
- Staff continue to use the existing audited `/api/admin/driver-applications/:id/documents/:kind` endpoint. App tokens cannot access it. The backend resolves owned metadata, requests an expiring private Cloudinary URL internally, fetches bounded bytes, checks the checksum and proxies the original verified content type with no-store/nosniff headers. Signed URLs never reach clients. Approval verifies document availability outside SQL locks, then rechecks the application version before committing the review.
- Temporary document grants default to 60 seconds (configurable 30–300). Only the official HTTPS Cloudinary API host for the configured cloud is fetched; redirects are refused. Keep the configured cloud and prefix stable while assets use them.

## Failure handling

Provider uploads happen outside SQL transactions. Before upload, the backend commits a durable intent containing random planned IDs. After upload, it locks the same account/application again, checks the photo/application version and identity restrictions, then atomically commits the new references. A partial three-file upload, concurrent review/edit, or database failure leaves the previous set intact.

The app sends `If-Match` with the photo revision or application material version. A stale request returns 412; fetch the current profile/application and retry. Uploads expire for committing after 15 minutes. Per-account upload admission is limited to ten requests per fifteen minutes; each backend instance admits at most four simultaneous multipart uploads.

An existing BullMQ worker reconciles cleanup intents every minute. Interrupted/failed uploads and replaced/removed managed avatars wait **24 hours** before unreferenced assets are destroyed, allowing ambiguous upload outcomes to settle. Failed cleanup remains in PostgreSQL and is retried. Managed current assets are protected; Google-hosted photos are never deleted through Cloudinary. Replaced driver documents are retained with no automatic expiry until the document-retention policy is agreed. A bounded history guard requires staff review if an account accumulates 200 pending/retained operations.

## Existing files and rollout

Legacy `private://` documents remain readable. Turning off the upload flag restores local document writes; Cloudinary reads and cleanup still require the existing credentials and updated binary. No provider error silently falls back to local disk while Cloudinary is enabled.

`npm run cloudinary:inventory` is a read-only inventory of local document availability, sizes and checksums. Treat its output as private operational data. It uploads/deletes nothing. Bulk migration of existing identity documents is deliberately not executed; a reviewed, resumable migration batch and backups are required before moving those files. Keep the Coolify private-upload volume while legacy references exist. Replaced document retention and eventual account deletion remain policy decisions.

For Coolify: set the seven Cloudinary variables from `backend/.env.production.example` as backend **runtime** secrets, apply migrations before starting the new version, then enable the flag and redeploy the backend. Deploy/update the Expo client separately to expose the photo controls. No production deployment was performed in this task. Verify private document access after redeploy and across instances. The private PDF smoke test currently passes in the configured local product environment; other environments may have different delivery restrictions.

## Verification

- Live synthetic Cloudinary checks passed: sanitized avatar, private raw PNG/PDF downloads, original byte checks and unsigned-access denial; disposable assets removed afterward.
- Focused tests cover spoofed files, animations/pixel limits, metadata sanitation options, expiring download grants, download tampering/redirect/size limits, account ownership, staff audit/scope, partial uploads, database rollback, concurrent edits/review, cleanup retry and legacy reads.
- Mobile store tests cover stale photo revisions and logout while saving. Web layout inspected using a view-only fixture at mobile width. Physical Android/iOS picker and upload behavior and Coolify staging redeploy remain release verification tasks.

References: [Cloudinary Node uploads](https://cloudinary.com/documentation/node_image_and_video_upload), [authenticated access and temporary downloads](https://cloudinary.com/documentation/control_access_to_media), [raw files and upload options](https://cloudinary.com/documentation/upload_parameters), [Expo 57 DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/).
