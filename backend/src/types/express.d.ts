import type { AuthUserRow } from '../modules/auth/auth.types';
declare global { namespace Express { interface Request { userId?: string; authUser?: AuthUserRow } } }
export {};
