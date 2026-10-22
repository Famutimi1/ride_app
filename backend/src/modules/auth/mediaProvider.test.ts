import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { v2 as sdk, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { env } from '../../config/env';
import { assetTarget, checksum, mediaProvider, type MediaAsset } from '../../shared/utils/cloudinary';
test('provider enforces sanitation, authenticated delivery, bounded downloads and safe failures', async (t) => {
    Object.assign(env, { CLOUDINARY_ENABLED: true, CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', CLOUDINARY_ASSET_PREFIX: 'rakky-ride/test' });
    const bytes = Buffer.from('%PDF-1.4 fixture');
    await t.test('avatar upload performs incoming sanitation and bounds the published image', async () => {
        let options: UploadApiOptions = {};
        const mock = t.mock.method(sdk.uploader, 'upload_stream', (input: UploadApiOptions, callback: (error: unknown, result?: UploadApiResponse) => void) => {
            options = input;
            const stream = new PassThrough();
            stream.resume();
            stream.on('finish', () => callback(null, { asset_id: 'asset', public_id: input.public_id, resource_type: 'image', type: 'upload', format: 'jpg', version: 1, bytes: 123, width: 512, height: 300, secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/photo.jpg' } as unknown as UploadApiResponse));
            return stream;
        });
        const result = await mediaProvider.upload(bytes, assetTarget(true));
        assert.equal(options.overwrite, false);
        assert.equal(options.resource_type, 'image');
        assert.equal(options.type, 'upload');
        assert.equal(options.format, 'jpg');
        assert.deepEqual(options.transformation, [{ angle: 'auto', width: 512, height: 512, crop: 'limit' }, { flags: 'force_strip' }, { flags: 'strip_profile' }]);
        assert.ok(result.url);
        mock.mock.restore();
    });
    const asset: MediaAsset = { ...assetTarget(false, 'pdf'), assetId: 'fixture', version: 1, format: 'pdf', bytes: bytes.length, checksum: checksum(bytes) };
    await t.test('temporary private URLs use authenticated raw delivery and expire without reaching the caller', async () => {
        let called = false;
        const mock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
            called = true;
            const url = new URL(String(input));
            assert.equal(url.origin, 'https://api.cloudinary.com');
            assert.equal(url.pathname, '/v1_1/test-cloud/raw/download');
            assert.equal(url.searchParams.get('type'), 'authenticated');
            assert.equal(url.searchParams.get('public_id'), asset.publicId);
            const ttl = Number(url.searchParams.get('expires_at')) - Math.floor(Date.now() / 1000);
            assert.ok(ttl >= 59 && ttl <= 60);
            assert.equal(init?.redirect, 'error');
            return new Response(bytes);
        });
        assert.deepEqual(await mediaProvider.download(asset), bytes);
        assert.ok(called);
        mock.mock.restore();
    });
    await t.test('tampering, excessive download sizes and redirects fail without returning a signed URL', async () => {
        for (const response of [new Response('wrong bytes'), new Response('', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }), new Response('', { status: 302, headers: { Location: 'https://untrusted.invalid' } })]) {
            const mock = t.mock.method(globalThis, 'fetch', async () => response);
            await assert.rejects(mediaProvider.download(asset), error => error instanceof Error && error.message === 'document_storage_unavailable' && !JSON.stringify(error).includes('signature='));
            mock.mock.restore();
        }
        const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
        await assert.rejects(mediaProvider.download({ ...asset, cloudName: 'different-cloud' }), { code: 'media_configuration_mismatch' });
        assert.equal(mock.mock.callCount(), 0);
        mock.mock.restore();
    });
});
