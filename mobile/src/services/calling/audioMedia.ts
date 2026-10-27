import { UserFacingError } from '@/utils/userMessage';
// Metro selects audioMedia.native.ts or audioMedia.web.ts. This fallback keeps
// non-browser evaluation safe without importing native or DOM media modules.
import type { AudioMedia,CallMedia,VideoFrames } from './callTypes';

export function mediaPermissionsPending(){return false;}
export function audioMediaAvailable(){return false;}
export async function prepareAudioMedia(_kind:CallMedia='audio',_video?:(frames:VideoFrames)=>void):Promise<AudioMedia>{throw new UserFacingError('Calls require the updated Android or iOS app.');}
