import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { mediaProvider, type AssetTarget, type MediaAsset } from '../../shared/utils/cloudinary';
import { assertDriverMaterialEditable } from '../driver/driver.service';
export interface MediaOperation {
    id: string;
    targets: AssetTarget[];
    createdAt: number;
    cleanupAfter: number | null;
    state: 'uploading' | 'cleanup' | 'retained';
}
export interface DocumentAsset {
    reference: string;
    asset: MediaAsset;
}
export type DocumentAssets = Record<string, DocumentAsset>;
export interface MediaAccount {
    avatar_revision: number;
    avatar_asset: MediaAsset | null;
    media_operations: MediaOperation[];
}
const safetyWindow = 24 * 60 * 60 * 1000;
type MediaPurpose = 'documents' | 'avatar';
export async function lockMediaAccount(userId: string, client: PoolClient, purpose: MediaPurpose = 'documents') {
    if (purpose === 'documents') {
        await assertDriverMaterialEditable(userId, client);
    } else {
        // Profile photos are self-service for both roles, including approved drivers.
        const account = await client.query('SELECT id FROM users WHERE id=$1 AND is_active=true FOR UPDATE', [userId]);
        if (!account.rowCount) throw new ApiError(401, 'account_inactive');
        if ((await client.query("SELECT 1 FROM trips WHERE (driver_id=$1 OR rider_id=$1) AND status IN ('driver_assigned','driver_arrived','in_progress','returning') LIMIT 1", [userId])).rowCount)
            throw new ApiError(409, 'active_trip_prevents_material_changes');
    }
    return (await client.query<MediaAccount>('SELECT avatar_revision,avatar_asset,media_operations FROM users WHERE id=$1', [userId])).rows[0];
}
export function expectedVersion(header: string | undefined) {
    const version = header?.replace(/^"|"$/g, '');
    if (!version || !/^[a-zA-Z0-9-]{1,80}$/.test(version))
        throw new ApiError(428, 'media_version_required');
    return version;
}
export async function materialVersion(userId: string, client: PoolClient) {
    return (await client.query<{
        version: string;
    }>('SELECT md5(updated_at::text) AS version FROM driver_profiles WHERE user_id=$1', [userId])).rows[0]?.version ?? null;
}
export async function beginMediaOperation(userId: string, targets: AssetTarget[], check: (client: PoolClient, account: MediaAccount) => Promise<void>, purpose: MediaPurpose = 'documents') {
    if (!env.CLOUDINARY_ENABLED)
        throw new ApiError(503, 'media_uploads_not_configured');
    return inTransaction(async (client) => {
        const account = await lockMediaAccount(userId, client, purpose);
        await check(client, account);
        if (account.media_operations.some(op => op.state === 'uploading' && Date.now() - op.createdAt < 15 * 60 * 1000))
            throw new ApiError(409, 'media_upload_in_progress');
        if (account.media_operations.length >= 200)
            throw new ApiError(409, 'media_history_review_required');
        const operation: MediaOperation = { id: randomUUID(), targets, createdAt: Date.now(), cleanupAfter: Date.now() + safetyWindow, state: 'uploading' };
        await client.query('UPDATE users SET media_operations=media_operations || $2::jsonb WHERE id=$1', [userId, JSON.stringify([operation])]);
        return operation;
    });
}
export async function finishMediaOperation(userId: string, operation: MediaOperation, client: PoolClient, oldTargets: AssetTarget[], retain = false) {
    const current = (await client.query<MediaAccount>('SELECT media_operations FROM users WHERE id=$1', [userId])).rows[0];
    if (Date.now() - operation.createdAt >= 15 * 60 * 1000 || !current.media_operations.some(op => op.id === operation.id && op.state === 'uploading'))
        throw new ApiError(409, 'media_upload_expired');
    const operations = current.media_operations.filter(op => op.id !== operation.id);
    if (oldTargets.length)
        operations.push({ id: randomUUID(), targets: oldTargets, createdAt: Date.now(), cleanupAfter: retain ? null : Date.now() + safetyWindow, state: retain ? 'retained' : 'cleanup' });
    await client.query('UPDATE users SET media_operations=$2 WHERE id=$1', [userId, JSON.stringify(operations)]);
}
export async function failMediaOperation(userId: string, operation: MediaOperation) {
    // Leave the durable intent if even this update fails. The reconciler handles
    // both states after the safety window, including ambiguous provider timeouts.
    await db.query(`UPDATE users SET media_operations=(SELECT COALESCE(jsonb_agg(CASE WHEN item->>'id'=$2 THEN jsonb_set(item,'{state}','"cleanup"') ELSE item END),'[]'::jsonb) FROM jsonb_array_elements(media_operations) item) WHERE id=$1`, [userId, operation.id]).catch(() => undefined);
}
export async function reconcileMedia() {
    const rows = (await db.query<{
        id: string;
        media_operations: MediaOperation[];
    }>(`SELECT id,media_operations FROM users WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(media_operations) item WHERE item->>'cleanupAfter' IS NOT NULL AND (item->>'cleanupAfter')::numeric<$1) ORDER BY id LIMIT 100`, [Date.now()])).rows;
    for (const row of rows)
        for (const operation of row.media_operations) {
            if (operation.cleanupAfter === null || operation.cleanupAfter > Date.now())
                continue;
            // Committed references always win. UUID public IDs are never reused.
            const current = (await db.query<{
                avatar_asset: MediaAsset | null;
                document_assets: DocumentAssets | null;
            }>('SELECT u.avatar_asset,p.document_assets FROM users u LEFT JOIN driver_profiles p ON p.user_id=u.id WHERE u.id=$1', [row.id])).rows[0];
            if (!current)
                continue;
            const active = [current.avatar_asset, ...Object.values(current.document_assets ?? {}).map(value => value.asset)].filter((asset): asset is MediaAsset => !!asset);
            const isCurrent = (target: AssetTarget) => active.some(asset => asset.cloudName === target.cloudName && asset.publicId === target.publicId && asset.resourceType === target.resourceType && asset.deliveryType === target.deliveryType);
            try {
                for (const target of operation.targets)
                    if (!isCurrent(target))
                        await mediaProvider.destroy(target);
                await db.query(`UPDATE users SET media_operations=(SELECT COALESCE(jsonb_agg(item),'[]'::jsonb) FROM jsonb_array_elements(media_operations) item WHERE item->>'id'<>$2) WHERE id=$1`, [row.id, operation.id]);
            }
            catch {
                console.error('[media] Cleanup deferred', operation.id);
            }
        }
}
