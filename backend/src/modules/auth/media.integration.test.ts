import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import test from 'node:test';
import type { DocumentAssets, MediaOperation } from './media.service';
import type { AssetTarget, MediaAsset } from '../../shared/utils/cloudinary';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0FEAAAAASUVORK5CYII=', 'base64');
const pdf = Buffer.from('%PDF-1.4\nDisposable fixture\n%%EOF');
function file(bytes = pdf, mimetype = 'application/pdf', originalname = 'fixture.pdf') { return { buffer: bytes, size: bytes.length, mimetype, originalname } as Express.Multer.File; }
test('Cloudinary lifecycle preserves ownership, private documents and last valid material', { skip: !process.env.DATABASE_URL }, async (t) => {
    const schema = `media_test_${process.pid}_${Date.now()}`;
    const owner = new Pool({ connectionString: process.env.DATABASE_URL });
    await owner.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    const { db, inTransaction } = await import('../../shared/config/db.js');
    const { redis } = await import('../../shared/config/redis.js');
    const { env } = await import('../../config/env.js');
    Object.assign(env, { CLOUDINARY_ENABLED: true, CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', CLOUDINARY_ASSET_PREFIX: 'rakky-ride/test' });
    const cloud = await import('../../shared/utils/cloudinary.js');
    const avatar = await import('./avatar.service.js');
    const media = await import('./media.service.js');
    const documents = await import('../driver/documentStorage.service.js');
    const driver = await import('../driver/driver.service.js');
    const admin = await import('../driver/admin.service.js');
    const uploaded = new Map<string, Buffer>(), destroyed: string[] = [];
    let attempts = 0, failAt = 0, onUpload: (() => Promise<void>) | null = null;
    t.mock.method(cloud.mediaProvider, 'upload', async (bytes: Buffer, target: AssetTarget): Promise<MediaAsset> => {
        attempts++;
        if (onUpload)
            await onUpload();
        if (attempts === failAt)
            throw new Error('simulated_cloud_timeout');
        uploaded.set(target.publicId, bytes);
        return { ...target, assetId: randomUUID(), version: 1, format: target.resourceType === 'raw' ? target.publicId.split('.').pop()! : 'jpg', bytes: bytes.length, checksum: cloud.checksum(bytes), ...(target.deliveryType === 'upload' ? { url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${target.publicId}.jpg` } : {}) };
    });
    t.mock.method(cloud.mediaProvider, 'download', async (asset: MediaAsset) => { const bytes = uploaded.get(asset.publicId); if (!bytes)
        throw new Error('missing'); return bytes; });
    t.mock.method(cloud.mediaProvider, 'destroy', async (target: AssetTarget) => { destroyed.push(target.publicId); uploaded.delete(target.publicId); });
    let id = '', server: ReturnType<typeof createServer> | undefined;
    try {
        for (const name of (await readdir('migrations')).filter(name => /^\d+_.*\.sql$/.test(name)).sort())
            await db.query(await readFile(resolve('migrations', name), 'utf8'));
        id = (await db.query("INSERT INTO users(full_name,email) VALUES('Media owner','media@example.test') RETURNING id")).rows[0].id;
        const other = (await db.query("INSERT INTO users(full_name) VALUES('Other owner') RETURNING id")).rows[0].id as string;
        const staff = (await db.query("INSERT INTO users(full_name,role) VALUES('Reviewer','admin') RETURNING id")).rows[0].id as string;
        await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'none')", [id]);
        const version = () => inTransaction(client => media.materialVersion(id, client));
        const uploads = { license: [file()], vehicleRegistration: [file()], insurance: [file()] };
        const snapshot = async () => (await db.query('SELECT license_doc_url,vehicle_reg_doc_url,insurance_doc_url,document_assets FROM driver_profiles WHERE user_id=$1', [id])).rows[0];
        await t.test('validation rejects spoofing, extension mismatch, animated images and pixel bombs before provider work', async () => {
            const { validateMedia, staticImageDimensions } = await import('../../shared/utils/mediaValidation.js');
            assert.deepEqual(staticImageDimensions(image, 'image/png'), { width: 1, height: 1 });
            for (const candidate of [file(Buffer.from('<svg/>'), 'image/png', 'x.png'), file(pdf, 'application/pdf', 'x.png'), file(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', 'x.png'), file(pdf)])
                assert.throws(() => validateMedia(candidate, true));
            const huge = Buffer.from(image);
            huge.writeUInt32BE(10001, 16);
            assert.throws(() => validateMedia(file(huge, 'image/png', 'huge.png'), true));
            const animated = Buffer.concat([image.subarray(0, 33), Buffer.from([0, 0, 0, 0]), Buffer.from('acTL'), Buffer.alloc(4), image.subarray(33)]);
            assert.throws(() => validateMedia(file(animated, 'image/png', 'animated.png'), true));
            assert.equal(attempts, 0);
        });
        await t.test('public avatar is self-owned, versioned, sanitized and never leaks provider metadata', async () => {
            const result = await avatar.uploadAvatar(id, file(image, 'image/png', 'photo.png'), '0');
            assert.equal(result.user.avatarVersion, 1);
            assert.ok(result.user.avatarUrl);
            assert.ok(!JSON.stringify(result).includes('assetId'));
            await assert.rejects(avatar.uploadAvatar(id, file(image, 'image/png', 'photo.png'), '0'), { code: 'profile_photo_changed' });
            await assert.rejects(avatar.removeAvatar(id, undefined), { code: 'media_version_required' });
            assert.equal((await db.query('SELECT avatar_url FROM users WHERE id=$1', [other])).rows[0].avatar_url, null);
        });
        await t.test('all documents commit together and staff reads retain an audit trail', async () => {
            await documents.uploadDocuments(id, uploads, (await version())!);
            const row = await snapshot();
            assert.ok(row.license_doc_url.startsWith(`cloudinary://driver-documents/${id}/`));
            assert.ok(Object.values(row.document_assets as DocumentAssets).every(doc => doc.asset.deliveryType === 'authenticated' && doc.asset.resourceType === 'raw'));
            assert.deepEqual((await admin.readAdminDocument(staff, id, 'license')).bytes, pdf);
            assert.equal((await db.query("SELECT count(*)::int AS count FROM admin_audit_log WHERE action='driver_document_view' AND target_user_id=$1", [id])).rows[0].count, 1);
            await assert.rejects(documents.readCloudDocument(other, row.license_doc_url), { code: 'document_not_found' });
            const status = await inTransaction(client => driver.applicationStatus(id, client));
            assert.ok(status.materialVersion);
            assert.ok(!JSON.stringify(status).includes('cloudinary://'));
            assert.ok(!JSON.stringify(status).includes('publicId'));
        });
        await t.test('partial provider failure leaves all three previous documents intact and durable cleanup intent', async () => {
            const before = await snapshot();
            failAt = attempts + 2;
            await assert.rejects(documents.uploadDocuments(id, uploads, (await version())!), /simulated_cloud_timeout/);
            failAt = 0;
            assert.deepEqual(await snapshot(), before);
            const ops = (await db.query('SELECT media_operations FROM users WHERE id=$1', [id])).rows[0].media_operations as MediaOperation[];
            assert.ok(ops.some(op => op.state === 'cleanup' && op.targets.length === 3));
        });
        await t.test('concurrent material edits and approval invalidate an in-flight upload', async () => {
            const before = await snapshot();
            let called = false;
            onUpload = async () => { if (!called) {
                called = true;
                await db.query('UPDATE driver_profiles SET updated_at=now() WHERE user_id=$1', [id]);
            } };
            await assert.rejects(documents.uploadDocuments(id, uploads, (await version())!), { code: 'application_material_changed' });
            assert.deepEqual(await snapshot(), before);
            called = false;
            onUpload = async () => { if (!called) {
                called = true;
                await db.query("UPDATE driver_profiles SET status='approved',updated_at=now() WHERE user_id=$1", [id]);
            } };
            await assert.rejects(documents.uploadDocuments(id, uploads, (await version())!), { code: 'approved_driver_material_requires_review' });
            onUpload = null;
            await db.query("UPDATE driver_profiles SET status='none',updated_at=now() WHERE user_id=$1", [id]);
        });
        await t.test('approved drivers can upload and remove photos without changing application approval', async () => {
            const driverId = (await db.query("INSERT INTO users(full_name,active_role) VALUES('Approved photo owner','driver') RETURNING id")).rows[0].id as string;
            await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')", [driverId]);
            const saved = await avatar.uploadAvatar(driverId, file(image, 'image/png', 'photo.png'), '0');
            assert.equal(saved.user.avatarVersion, 1);
            assert.ok(saved.user.avatarUrl);
            const removed = await avatar.removeAvatar(driverId, '1');
            assert.equal(removed.user.avatarVersion, 2);
            assert.equal(removed.user.avatarUrl, null);
            assert.equal((await db.query('SELECT status FROM driver_profiles WHERE user_id=$1', [driverId])).rows[0].status, 'approved');
            await assert.rejects(documents.uploadDocuments(driverId, uploads, 'unused'), { code: 'approved_driver_material_requires_review' });
            await db.query('UPDATE users SET is_active=false WHERE id=$1', [driverId]);
            const before = attempts;
            await assert.rejects(avatar.uploadAvatar(driverId, file(image, 'image/png', 'photo.png'), '2'), { code: 'account_inactive' });
            assert.equal(attempts, before);
        });
        await t.test('an active rider trip also prevents photo changes', async () => {
            await db.query("INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key) VALUES($1,$2,'driver_assigned','cash',6.4,3.4,'Fixture',6.5,3.5,'Fixture',1000,300,100000,'media-active-trip')", [other, id]);
            await assert.rejects(avatar.uploadAvatar(other, file(image, 'image/png', 'photo.png'), '0'), { code: 'active_trip_prevents_material_changes' });
            await db.query("UPDATE trips SET status='cancelled' WHERE driver_id=$1", [id]);
        });
        await t.test('database rollback after provider success preserves current avatar and cleanup intent', async () => {
            await db.query(`CREATE FUNCTION reject_media_avatar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.avatar_revision>1 THEN RAISE EXCEPTION 'test_avatar_failure'; END IF; RETURN NEW; END $$`);
            await db.query('CREATE TRIGGER reject_media_avatar BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_media_avatar()');
            await assert.rejects(avatar.uploadAvatar(id, file(image, 'image/png', 'photo.png'), '1'), /test_avatar_failure/);
            await db.query('DROP TRIGGER reject_media_avatar ON users');
            assert.equal((await db.query('SELECT avatar_revision FROM users WHERE id=$1', [id])).rows[0].avatar_revision, 1);
        });
        await t.test('overlapping uploads are serialized and cleanup never deletes a current or retained asset', async () => {
            const target = cloud.assetTarget(true), operation = await media.beginMediaOperation(id, [target], async () => undefined);
            await assert.rejects(avatar.uploadAvatar(id, file(image, 'image/png', 'photo.png'), '1'), { code: 'media_upload_in_progress' });
            await media.failMediaOperation(id, operation);
            const account = (await db.query('SELECT avatar_asset FROM users WHERE id=$1', [id])).rows[0];
            const doc = (await snapshot()).document_assets.license.asset as MediaAsset;
            const retained = { id: randomUUID(), targets: [doc], createdAt: 1, state: 'retained', cleanupAfter: null };
            const current = { id: randomUUID(), targets: [account.avatar_asset], createdAt: 1, state: 'cleanup', cleanupAfter: 1 };
            await db.query(`UPDATE users SET media_operations=(SELECT jsonb_agg(jsonb_set(item,'{cleanupAfter}','1')) FROM jsonb_array_elements(media_operations) item) || $2::jsonb WHERE id=$1`, [id, JSON.stringify([retained, current])]);
            await media.reconcileMedia();
            assert.ok(!destroyed.includes(account.avatar_asset.publicId));
            assert.ok(!destroyed.includes(doc.publicId));
            const remaining = (await db.query('SELECT media_operations FROM users WHERE id=$1', [id])).rows[0].media_operations;
            assert.equal(remaining.length, 1);
            assert.equal(remaining[0].state, 'retained');
        });
        await t.test('failed cleanup remains durable and succeeds on reconciliation retry', async () => {
            const target = cloud.assetTarget(true), op = { id: randomUUID(), targets: [target], createdAt: 1, cleanupAfter: 1, state: 'cleanup' };
            await db.query('UPDATE users SET media_operations=media_operations || $2::jsonb WHERE id=$1', [id, JSON.stringify([op])]);
            const failure = t.mock.method(cloud.mediaProvider, 'destroy', async () => { throw new Error('provider_offline'); });
            await media.reconcileMedia();
            assert.ok((await db.query('SELECT media_operations FROM users WHERE id=$1', [id])).rows[0].media_operations.some((item: MediaOperation) => item.id === op.id));
            failure.mock.restore();
            await media.reconcileMedia();
            assert.ok(!(await db.query('SELECT media_operations FROM users WHERE id=$1', [id])).rows[0].media_operations.some((item: MediaOperation) => item.id === op.id));
        });
        await t.test('HTTP upload parsing requires authentication and rejects extra fields; staff documents reject app scope', async () => {
            const { createApp } = await import('../../app.js');
            const { signAccessToken } = await import('./jwt.service.js');
            server = createServer(createApp());
            await new Promise<void>(done => server!.listen(0, '127.0.0.1', done));
            const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            const response = await fetch(`${base}/api/auth/profile/avatar`, { method: 'POST' });
            assert.equal(response.status, 401);
            const body = new FormData();
            body.append('avatar', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'photo.png');
            body.append('ownerId', other);
            const extra = await fetch(`${base}/api/auth/profile/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${signAccessToken({ id })}`, 'If-Match': '1' }, body });
            assert.equal(extra.status, 400);
            const privateResponse = await fetch(`${base}/api/admin/driver-applications/${id}/documents/license`, { headers: { Authorization: `Bearer ${signAccessToken({ id: staff })}` } });
            assert.equal(privateResponse.status, 403);
            const photo = new FormData();
            photo.append('avatar', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'photo.png');
            const photoResponse = await fetch(`${base}/api/auth/profile/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${signAccessToken({ id: other })}`, 'If-Match': '0' }, body: photo });
            assert.equal(photoResponse.status, 200);
            assert.equal((await photoResponse.json() as {
                user: {
                    id: string;
                    avatarVersion: number;
                };
            }).user.id, other);
            const removed = await fetch(`${base}/api/auth/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${signAccessToken({ id: other })}`, 'If-Match': '1' } });
            assert.equal(removed.status, 200);
            assert.equal((await removed.json() as {
                user: {
                    avatarUrl: null;
                };
            }).user.avatarUrl, null);
            const large = new FormData();
            large.append('avatar', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'photo.png');
            assert.equal((await fetch(`${base}/api/auth/profile/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${signAccessToken({ id: other })}`, 'If-Match': '2' }, body: large })).status, 413);
            const packageFiles = new FormData();
            for (const kind of ['license', 'vehicleRegistration', 'insurance'])
                packageFiles.append(kind, new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'document.pdf');
            const committed = await fetch(`${base}/api/driver/onboarding/documents`, { method: 'POST', headers: { Authorization: `Bearer ${signAccessToken({ id })}`, 'If-Match': (await version())! }, body: packageFiles });
            assert.equal(committed.status, 200);
            assert.deepEqual(await committed.json(), { documentsUploaded: true });
            const sessionId = randomUUID(), startedAt = new Date();
            await db.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1,$2,$3,'staff',now()+interval '12 hours')", [staff, sessionId, randomUUID()]);
            const viewed = await fetch(`${base}/api/admin/driver-applications/${id}/documents/license`, { headers: { Authorization: `Bearer ${signAccessToken({ id: staff }, 'staff', { id: sessionId, startedAt })}` } });
            assert.equal(viewed.status, 200);
            assert.equal(viewed.headers.get('cache-control'), 'no-store');
            assert.equal(viewed.headers.get('x-content-type-options'), 'nosniff');
            assert.equal(viewed.headers.get('content-type'), 'application/pdf');
            assert.deepEqual(Buffer.from(await viewed.arrayBuffer()), pdf);
        });
        await t.test('staff approval downloads outside locks and rejects material changed during verification', async () => {
        await inTransaction(client => driver.savePersonalInfo(id, {fullName:'Media owner',email:'media@example.test',address:'12 Test Street'}, client));
        await inTransaction(client => driver.saveVehicleInfo(id, {make:'Test',model:'Fixture',year:2025,color:'Green',registrationNumber:'TEST-001'}, client));
        const services=await import('../matching/serviceEligibility.js');
        const settings=await inTransaction(client=>services.getServiceSettings(id,client));
        await inTransaction(client=>services.submitServiceApplication(id,{services:['ride'],vehicleCategory:'car',consentVersion:services.SERVICE_CONSENT_VERSION,consentAccepted:true,expectedVersion:settings.version},client));
        await inTransaction(client=>driver.submitApplication(id,client));
        const expected=(await db.query('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[id])).rows[0].version as string;
        let changed=false;
        const downloading=t.mock.method(cloud.mediaProvider,'download',async(asset:MediaAsset)=>{
            if(!changed){changed=true;await inTransaction(async client=>{await client.query("SET LOCAL lock_timeout='1s'");await client.query('UPDATE driver_profiles SET updated_at=now() WHERE user_id=$1',[id]);});}
            return uploaded.get(asset.publicId)!;
        });
        await assert.rejects(admin.reviewAdminApplication(staff,id,{decision:'approved',expectedVersion:expected,reason:'Synthetic evidence verification',requestKey:randomUUID()}),{code:'application_changed'});
        downloading.mock.restore();
        assert.equal((await db.query('SELECT status FROM driver_profiles WHERE user_id=$1',[id])).rows[0].status,'pending');
        await db.query("UPDATE driver_profiles SET status='none',updated_at=now() WHERE user_id=$1",[id]);
    });
    await t.test('legacy local documents still work with cloud uploads switched off; cloud reads remain available', async () => {
            Object.assign(env, { CLOUDINARY_ENABLED: false });
            const before = await snapshot();
            await documents.uploadDocuments(id, uploads, undefined);
            const current = await snapshot();
            assert.ok(current.license_doc_url.startsWith('private://'));
            assert.deepEqual((await admin.readPrivateDocument(id, current.license_doc_url)).bytes, pdf);
            // A rollback switch does not break Cloudinary-backed reads.
            assert.deepEqual((await documents.readCloudDocument(id, before.license_doc_url)).bytes, pdf);
            await assert.rejects(avatar.uploadAvatar(other, file(image, 'image/png', 'photo.png'), '0'), { code: 'media_uploads_not_configured' });
        });
    }
    finally {
        t.mock.restoreAll();
        await new Promise<void>(done => server ? server.close(() => done()) : done());
        const { stopTripWorkers } = await import('../trips/tripQueue.js');
        const { stopPaymentWorkers } = await import('../payments/paymentQueue.js');
        const { stopNotificationWorkers } = await import('../notifications/notificationQueue.js');
        await Promise.all([stopTripWorkers(), stopPaymentWorkers(), stopNotificationWorkers()]);
        await redis?.quit();
        await db.end();
        if (id)
            await rm(resolve('.private-uploads', 'driver-documents', id), { force: true, recursive: true });
        await owner.query(`DROP SCHEMA ${schema} CASCADE`);
        await owner.end();
    }
});
