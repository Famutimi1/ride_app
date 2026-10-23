import type { AuthUserRow, SessionScope } from '../modules/auth/auth.types';
declare global { namespace Express { interface Request { userId?: string; authUser?: AuthUserRow; sessionScope?: SessionScope; sessionId?:string } } }
export {};
