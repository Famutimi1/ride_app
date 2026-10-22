import assert from 'node:assert/strict';
import { v2 as sdk } from 'cloudinary';
import { ApiError } from '../src/shared/errors';
import { env } from '../src/config/env';
import { assetTarget, mediaConfigured, mediaProvider } from '../src/shared/utils/cloudinary';
async function main() {
    if (!process.argv.includes('--synthetic-upload'))
        throw new Error('Use --synthetic-upload to test disposable PNG/PDF files only.');
    if (!mediaConfigured())
        throw new Error('Cloudinary credentials are not configured.');
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0FEAAAAASUVORK5CYII=', 'base64');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
    const targets = [assetTarget(true), assetTarget(false, 'png'), assetTarget(false, 'pdf')];
    try {
        const avatar = await mediaProvider.upload(image, targets[0]);
        assert.ok(avatar.url);
        console.info('PASS: sanitized public avatar');
        for (const [index, bytes] of [image, pdf].entries()) {
            const asset = await mediaProvider.upload(bytes, targets[index + 1]);
            console.info(`Uploaded synthetic ${index ? 'PDF' : 'image'}.`);
            assert.deepEqual(await mediaProvider.download(asset), bytes);
            const unsigned = sdk.url(asset.publicId, { cloud_name: env.CLOUDINARY_CLOUD_NAME, secure: true, resource_type: asset.resourceType, type: 'authenticated', version: asset.version, ...(asset.resourceType === 'image' ? { format: asset.format } : {}) });
            const response = await fetch(unsigned, { redirect: 'error', signal: AbortSignal.timeout(15000) });
            assert.ok(!response.ok, 'Private documents must reject unsigned access');
            await response.body?.cancel();
            console.info(`PASS: private ${index ? 'PDF' : 'image'} round-trip and unsigned access denied`);
        }
    }
    finally {
        const cleanup = await Promise.allSettled(targets.map(target => mediaProvider.destroy(target)));
        if (cleanup.some(result => result.status === 'rejected')) {
            console.error('Some disposable fixtures need cleanup:', targets.map(target => target.publicId));
            throw new Error('synthetic_cleanup_failed');
        }
        console.info('Disposable Cloudinary assets removed.');
    }
}
void main().catch(error => { if (error instanceof ApiError)
    console.error(error.code, error.details ?? {}); console.error('Cloudinary smoke check failed. Check credentials, delivery restrictions and connectivity; no provider secrets logged.'); process.exitCode = 1; });
