import { inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { assetTarget, mediaProvider } from '../../shared/utils/cloudinary';
import { validateMedia } from '../../shared/utils/mediaValidation';
import { beginMediaOperation, expectedVersion, failMediaOperation, finishMediaOperation, lockMediaAccount } from './media.service';
import { getMe } from './auth.service';
export async function uploadAvatar(userId: string, file: Express.Multer.File | undefined, header: string | undefined) {
    if (!file)
        throw new ApiError(400, 'avatar_required');
    validateMedia(file, true);
    const version = expectedVersion(header), target = assetTarget(true);
    const operation = await beginMediaOperation(userId, [target], async (_client, account) => {
        if (String(account.avatar_revision) !== version)
            throw new ApiError(412, 'profile_photo_changed');
    }, 'avatar');
    try {
        const asset = await mediaProvider.upload(file.buffer, target);
        return await inTransaction(async (client) => {
            const account = await lockMediaAccount(userId, client, 'avatar');
            if (String(account.avatar_revision) !== version)
                throw new ApiError(412, 'profile_photo_changed');
            await finishMediaOperation(userId, operation, client, account.avatar_asset ? [account.avatar_asset] : []);
            await client.query('UPDATE users SET avatar_asset=$2,avatar_url=$3,avatar_revision=avatar_revision+1,updated_at=now() WHERE id=$1', [userId, asset, asset.url]);
            return getMe(userId, client);
        });
    }
    catch (error) {
        await failMediaOperation(userId, operation);
        throw error;
    }
}
export async function removeAvatar(userId: string, header: string | undefined) {
    const version = expectedVersion(header);
    return inTransaction(async (client) => {
        const account = await lockMediaAccount(userId, client, 'avatar');
        if (String(account.avatar_revision) !== version)
            throw new ApiError(412, 'profile_photo_changed');
        // Only managed assets are queued. Google photos are never sent to destroy.
        if (account.avatar_asset) {
            const { randomUUID } = await import('node:crypto');
            await client.query('UPDATE users SET media_operations=media_operations || $2::jsonb WHERE id=$1', [userId, JSON.stringify([{ id: randomUUID(), targets: [account.avatar_asset], state: 'cleanup', createdAt: Date.now(), cleanupAfter: Date.now() + 24 * 60 * 60 * 1000 }])]);
        }
        await client.query('UPDATE users SET avatar_asset=NULL,avatar_url=NULL,avatar_revision=avatar_revision+1,updated_at=now() WHERE id=$1', [userId]);
        return getMe(userId, client);
    });
}
