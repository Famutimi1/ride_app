import type {} from 'multer';
import { ApiError } from '../errors';
export const DOCUMENT_LIMIT = 8 * 1024 * 1024;
export const AVATAR_LIMIT = 5 * 1024 * 1024;
export function mediaContentType(bytes: Buffer): string | null {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        return 'image/jpeg';
    if (bytes.subarray(0, 5).toString() === '%PDF-')
        return 'application/pdf';
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
        return 'image/webp';
    return null;
}
/** Bound decoded image work before sending bytes to the provider's decoder. */
export function staticImageDimensions(bytes: Buffer, type: string) {
    let width = 0, height = 0;
    const invalid = () => { throw new ApiError(415, 'invalid_static_image'); };
    if (type === 'image/png') {
        let offset = 8;
        while (offset + 12 <= bytes.length) {
            const size = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8);
            if (offset + 12 + size > bytes.length)
                invalid();
            if (name === 'acTL')
                invalid();
            if (name === 'IHDR' && size === 13) {
                width = bytes.readUInt32BE(offset + 8);
                height = bytes.readUInt32BE(offset + 12);
            }
            offset += 12 + size;
        }
    }
    else if (type === 'image/jpeg') {
        for (let i = 2; i + 4 <= bytes.length;) {
            if (bytes[i++] !== 255)
                invalid();
            while (bytes[i] === 255)
                i++;
            const marker = bytes[i++];
            if (marker === 0xda || marker === 0xd9)
                break;
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
                continue;
            const length = bytes.readUInt16BE(i);
            if (length < 2 || i + length > bytes.length)
                invalid();
            if (marker === 0xe2 && bytes.toString('ascii', i + 2, i + 6) === 'MPF\0')
                invalid();
            if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
                height = bytes.readUInt16BE(i + 3);
                width = bytes.readUInt16BE(i + 5);
            }
            i += length;
        }
    }
    else if (type === 'image/webp') {
        for (let i = 12; i + 8 <= bytes.length;) {
            const name = bytes.toString('ascii', i, i + 4), length = bytes.readUInt32LE(i + 4), data = i + 8;
            if (data + length > bytes.length)
                invalid();
            if (name === 'ANIM' || name === 'ANMF')
                invalid();
            if (name === 'VP8X' && length >= 10) {
                if (bytes[data] & 2)
                    invalid();
                width = 1 + bytes.readUIntLE(data + 4, 3);
                height = 1 + bytes.readUIntLE(data + 7, 3);
            }
            if (name === 'VP8 ' && length >= 10) {
                width = bytes.readUInt16LE(data + 6) & 0x3fff;
                height = bytes.readUInt16LE(data + 8) & 0x3fff;
            }
            if (name === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
                const bits = bytes.readUInt32LE(data + 1);
                width = 1 + (bits & 0x3fff);
                height = 1 + ((bits >>> 14) & 0x3fff);
            }
            i = data + length + (length % 2);
        }
    }
    if (!width || !height || width > 10000 || height > 10000 || width * height > 20000000)
        invalid();
    return { width, height };
}
export function validateMedia(file: Express.Multer.File, avatar = false) {
    if (!file?.buffer?.length)
        throw new ApiError(400, 'file_required');
    if (file.buffer.length > (avatar ? AVATAR_LIMIT : DOCUMENT_LIMIT))
        throw new ApiError(413, 'file_too_large');
    const type = mediaContentType(file.buffer);
    if (!type || type !== file.mimetype || (avatar && type === 'application/pdf'))
        throw new ApiError(415, 'unsupported_file_content');
    const extension = file.originalname.split('.').pop()?.toLowerCase();
    const allowed: Record<string, string[]> = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'application/pdf': ['pdf'] };
    if (!extension || !allowed[type].includes(extension))
        throw new ApiError(415, 'file_extension_mismatch');
    if (avatar)
        staticImageDimensions(file.buffer, type);
    return type;
}
