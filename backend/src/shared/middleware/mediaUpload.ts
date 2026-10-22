import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { ensureRedis } from '../config/redis';
import { ApiError } from '../errors';
import { AVATAR_LIMIT, DOCUMENT_LIMIT } from '../utils/mediaValidation';
// Resource admission only; database locks/version checks protect correctness.
let inFlight = 0;
const releases = new WeakMap<Request, () => void>();
export function releaseMediaUpload(req: Request) { releases.get(req)?.(); }
export const limitMediaUpload: RequestHandler = async (req, res, next) => {
    try {
        const redis = await ensureRedis();
        const count = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", 1, `media:rate:${req.userId}`));
        if (count > 10) {
            res.set('Retry-After', '900');
            throw new ApiError(429, 'media_upload_rate_limited');
        }
        if (inFlight >= 4)
            throw new ApiError(503, 'media_upload_busy');
        inFlight++;
        let released = false;
        const release = () => { if (!released) {
            released = true;
            inFlight--;
            releases.delete(req);
        } };
        releases.set(req, release);
        res.once('finish', release);
        res.once('close', () => { if (!req.complete)
            release(); });
        next();
    }
    catch (error) {
        next(error instanceof ApiError ? error : new ApiError(503, 'media_upload_unavailable'));
    }
};
function parser(avatar: boolean): RequestHandler {
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: avatar ? AVATAR_LIMIT : DOCUMENT_LIMIT, files: avatar ? 1 : 3, fields: 0, parts: avatar ? 2 : 6, fieldNameSize: 64 } });
    const parse = avatar ? upload.single('avatar') : upload.fields([{ name: 'license', maxCount: 1 }, { name: 'vehicleRegistration', maxCount: 1 }, { name: 'insurance', maxCount: 1 }]);
    return (req, res, next) => parse(req, res, error => { if (error)
        releaseMediaUpload(req); next(error ? new ApiError(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'invalid_media_upload') : undefined); });
}
export const parseAvatar = parser(true);
export const parseDocuments = parser(false);
