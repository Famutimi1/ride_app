import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { assetTarget, mediaProvider } from '../../shared/utils/cloudinary';
import { validateMedia, mediaContentType } from '../../shared/utils/mediaValidation';
import { beginMediaOperation, expectedVersion, failMediaOperation, finishMediaOperation, lockMediaAccount, materialVersion, type DocumentAssets } from '../auth/media.service';
import { saveDocuments } from './driver.service';
export async function uploadDocuments(userId: string, files: Record<string, Express.Multer.File[]>, header: string | undefined) {
    const entries = [['license', files?.license?.[0]], ['registration', files?.vehicleRegistration?.[0]], ['insurance', files?.insurance?.[0]]] as const;
    for (const [, file] of entries) {
        if (!file)
            throw new ApiError(400, 'all_documents_required');
        validateMedia(file);
    }
    if (!env.CLOUDINARY_ENABLED)
        return inTransaction(client => saveDocuments(userId, files, client));
    const version = expectedVersion(header);
    const targets = entries.map(([, file]) => assetTarget(false, ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const)[file!.mimetype as 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp']));
    const operation = await beginMediaOperation(userId, targets, async (client) => {
        const current = await materialVersion(userId, client);
        if (!current)
            throw new ApiError(409, 'personal_info_required');
        if (current !== version)
            throw new ApiError(412, 'application_material_changed');
    });
    try {
        const documents: DocumentAssets = {};
        // Sequential uploads bound memory and stop promptly after the first failure.
        for (const [index, [kind, file]] of entries.entries())
            documents[kind] = { reference: `cloudinary://driver-documents/${userId}/${randomUUID()}`, asset: await mediaProvider.upload(file!.buffer, targets[index]) };
        return await inTransaction(async (client) => {
            await lockMediaAccount(userId, client);
            if (await materialVersion(userId, client) !== version)
                throw new ApiError(412, 'application_material_changed');
            const old = (await client.query<{
                document_assets: DocumentAssets;
            }>('SELECT document_assets FROM driver_profiles WHERE user_id=$1', [userId])).rows[0].document_assets;
            // Retain old identity documents until an explicit retention policy is set.
            await finishMediaOperation(userId, operation, client, Object.values(old).map(value => value.asset), true);
            await client.query('UPDATE driver_profiles SET license_doc_url=$2,vehicle_reg_doc_url=$3,insurance_doc_url=$4,document_assets=$5,updated_at=now() WHERE user_id=$1', [userId, documents.license.reference, documents.registration.reference, documents.insurance.reference, documents]);
            return { documentsUploaded: true };
        });
    }
    catch (error) {
        await failMediaOperation(userId, operation);
        throw error;
    }
}
export async function readCloudDocument(userId: string, reference: string) {
    if (!reference.startsWith(`cloudinary://driver-documents/${userId}/`))
        throw new ApiError(404, 'document_not_found');
    const metadata = (await db.query<{
        document_assets: DocumentAssets;
    }>('SELECT document_assets FROM driver_profiles WHERE user_id=$1', [userId])).rows[0]?.document_assets;
    const match = Object.values(metadata ?? {}).find(value => value.reference === reference);
    if (!match)
        throw new ApiError(404, 'document_not_found');
    const bytes = await mediaProvider.download(match.asset), contentType = mediaContentType(bytes);
    if (!contentType)
        throw new ApiError(415, 'unsupported_document_content');
    return { bytes, contentType };
}
