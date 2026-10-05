import type { NextFunction, Request, Response } from 'express';
import { inTransaction } from '../../shared/config/db';
import * as auth from './auth.service';
import { ApiError } from '../../shared/errors';

const device = (req: Request) => req.get('user-agent');
const run = (handler: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { res.json(await handler(req)); } catch (error) { next(error); } };

export const registerInitiate = run((req) => inTransaction((client) => auth.initiateRegistration(req.body.fullName, req.body.phone, req.body.accountType, client)));
export const registerVerify = run((req) => inTransaction((client) => auth.verifyRegistration(req.body, device(req), client)));
export const loginInitiate = run((req) => inTransaction((client) => auth.initiateLogin(req.body.phone, client)));
export const loginVerify = run((req) => inTransaction((client) => auth.verifyLogin(req.body.phone, req.body.code, device(req), client)));
export const resend = run((req) => inTransaction((client) => auth.resendOtp(req.body.phone, req.body.purpose, client)));
export const refresh = async (req: Request, res: Response, next: NextFunction) => { try { const result=await inTransaction((client)=>auth.rotateRefreshToken(req.body.refreshToken,device(req),client));if(result.reuseDetected)throw new ApiError(401,'refresh_token_reuse_detected');res.json({tokens:result.tokens}); } catch(error){next(error);} };
export const google = run((req) => inTransaction((client) => auth.googleSignIn(req.body.idToken, device(req), client)));
export const me = run((req) => inTransaction((client) => auth.getMe(req.userId!, client)));
export const activeRole = run((req) => inTransaction((client) => auth.switchActiveRole(req.userId!, req.body.role, client)));
export const logout = run(async (req) => { await inTransaction((client) => auth.revokeToken(req.userId!, req.body.refreshToken, client)); return { success: true }; });
export const logoutAll = run(async (req) => { await inTransaction((client) => auth.revokeAll(req.userId!, client)); return { success: true }; });
