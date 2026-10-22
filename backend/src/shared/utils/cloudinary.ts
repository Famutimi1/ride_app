import { v2 as sdk } from 'cloudinary';
import { createHash, randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { ApiError } from '../errors';
import { AVATAR_LIMIT, DOCUMENT_LIMIT } from './mediaValidation';
export interface AssetTarget {
    cloudName: string;
    publicId: string;
    resourceType: 'image' | 'raw';
    deliveryType: 'upload' | 'authenticated';
}
export interface MediaAsset extends AssetTarget {
    assetId: string;
    version: number;
    format: string;
    bytes: number;
    checksum: string;
    url?: string;
}
export const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function mediaConfigured() { return !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET); }
const options = () => ({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
export function assetTarget(avatar: boolean, format: 'pdf' | 'png' | 'jpg' | 'webp' = 'pdf'): AssetTarget {
    return { cloudName: env.CLOUDINARY_CLOUD_NAME, publicId: `${env.CLOUDINARY_ASSET_PREFIX}/${avatar ? 'avatars' : 'documents'}/${randomUUID()}${avatar ? '' : '.' + format}`, resourceType: avatar ? 'image' : 'raw', deliveryType: avatar ? 'upload' : 'authenticated' };
}
export function assertManagedTarget(asset: AssetTarget) {
    if (!mediaConfigured() || asset.cloudName !== env.CLOUDINARY_CLOUD_NAME || !asset.publicId.startsWith(`${env.CLOUDINARY_ASSET_PREFIX}/`) || !/^[a-zA-Z0-9_./-]+$/.test(asset.publicId) || asset.publicId.includes('..') || !['image', 'raw'].includes(asset.resourceType) || !['upload', 'authenticated'].includes(asset.deliveryType))
        throw new ApiError(503, 'media_configuration_mismatch');
}
/** Errors deliberately exclude the SDK error object and signed provider URLs. */
export const mediaProvider = {
    async upload(bytes: Buffer, target: AssetTarget): Promise<MediaAsset> {
        assertManagedTarget(target);
        const avatar = target.deliveryType === 'upload';
        try {
            const result = await new Promise<import('cloudinary').UploadApiResponse>((resolve, reject) => {
                let deadline: ReturnType<typeof setTimeout> | undefined;
                const stream = sdk.uploader.upload_stream({ ...options(), public_id: target.publicId, resource_type: target.resourceType, type: target.deliveryType, overwrite: false, unique_filename: false, timeout: env.CLOUDINARY_UPLOAD_TIMEOUT_MS,
                    ...(avatar ? { format: 'jpg', transformation: [{ angle: 'auto', width: 512, height: 512, crop: 'limit' }, { flags: 'force_strip' }, { flags: 'strip_profile' }] } : {}) }, (error, result) => { clearTimeout(deadline); if (error || !result)
                    reject(new Error('upload_failed'));
                else
                    resolve(result); });
                deadline = setTimeout(() => { stream.destroy(); reject(new Error('upload_failed')); }, env.CLOUDINARY_UPLOAD_TIMEOUT_MS);
                stream.on('error', () => { clearTimeout(deadline); reject(new Error('upload_failed')); });
                stream.end(bytes);
            });
            if (result.public_id !== target.publicId || result.resource_type !== target.resourceType || result.type !== target.deliveryType || !result.asset_id || !Number.isSafeInteger(result.version) || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || (!avatar && result.bytes !== bytes.length) || (avatar && (result.bytes > AVATAR_LIMIT || result.format !== 'jpg' || !Number.isSafeInteger(result.width) || result.width < 1 || result.width > 512 || !Number.isSafeInteger(result.height) || result.height < 1 || result.height > 512 || (result.pages ?? 1) > 1)))
                throw new Error('unexpected_upload_result');
            let url: string | undefined;
            if (avatar) {
                const parsed = new URL(result.secure_url);
                if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !parsed.pathname.startsWith(`/${target.cloudName}/`))
                    throw new Error('unexpected_asset_url');
                url = parsed.toString();
            }
            return { ...target, assetId: result.asset_id, version: result.version, format: result.format ?? target.publicId.split('.').pop() ?? 'pdf', bytes: result.bytes, checksum: checksum(bytes), ...(url ? { url } : {}) };
        }
        catch {
            throw new ApiError(502, 'media_upload_failed');
        }
    },
    async download(asset: MediaAsset): Promise<Buffer> {
        assertManagedTarget(asset);
        if (asset.deliveryType !== 'authenticated')
            throw new ApiError(404, 'document_not_found');
        try {
            const url = sdk.utils.private_download_url(asset.publicId, asset.resourceType === 'raw' ? '' : asset.format, { ...options(), resource_type: asset.resourceType, type: asset.deliveryType, expires_at: Math.floor(Date.now() / 1000) + env.CLOUDINARY_PRIVATE_DOWNLOAD_TTL_SECONDS });
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.cloudinary.com' || !parsed.pathname.startsWith(`/v1_1/${asset.cloudName}/`))
                throw new Error('unexpected_download_origin');
            const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(env.CLOUDINARY_UPLOAD_TIMEOUT_MS) });
            if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > DOCUMENT_LIMIT)
                throw new Error('download_unavailable');
            const reader = response.body.getReader(), chunks: Uint8Array[] = [];
            let size = 0;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    size += value.byteLength;
                    if (size > DOCUMENT_LIMIT)
                        throw new Error('download_too_large');
                    chunks.push(value);
                }
            }
            finally {
                await reader.cancel().catch(() => undefined);
            }
            const bytes = Buffer.concat(chunks);
            if (checksum(bytes) !== asset.checksum || bytes.length !== asset.bytes)
                throw new Error('document_integrity_mismatch');
            return bytes;
        }
        catch (error) {
            const reason = error instanceof Error && ['unexpected_download_origin', 'download_unavailable', 'download_too_large', 'document_integrity_mismatch'].includes(error.message) ? error.message : 'download_failed';
            throw new ApiError(502, 'document_storage_unavailable', { reason });
        }
    },
    async destroy(target: AssetTarget): Promise<void> {
        assertManagedTarget(target);
        try {
            const destroyOptions = { ...options(), resource_type: target.resourceType, type: target.deliveryType, invalidate: true, timeout: env.CLOUDINARY_UPLOAD_TIMEOUT_MS };
            const result = await sdk.uploader.destroy(target.publicId, destroyOptions);
            if (!['ok', 'not found'].includes(result.result))
                throw new Error();
        }
        catch {
            throw new ApiError(502, 'media_cleanup_failed');
        }
    },
};
