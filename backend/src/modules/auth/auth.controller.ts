import type { NextFunction, Request, Response } from 'express';
import { inTransaction } from '../../shared/config/db';
import * as auth from './auth.service';
import { ApiError } from '../../shared/errors';
import { disconnectAccountSockets, disconnectSessionSockets } from '../../websocket/notifications';
import { revokeAllDevices, revokeDeviceIfPresent } from '../notifications/notifications.service';

const device = (req: Request) => req.get('user-agent');
const run = (handler: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { res.json(await handler(req)); } catch (error) { next(error); } };

export const registerInitiate = run((req) => inTransaction((client) => auth.initiateRegistration(req.body.fullName, req.body.phone, req.body.accountType, client)));
export const registerVerify = run((req) => auth.verifyRegistration(req.body, device(req)));
export const loginInitiate = run((req) => inTransaction((client) => auth.initiateLogin(req.body.phone, client)));
export const loginVerify = run((req) => auth.verifyLogin(req.body.phone, req.body.code, device(req)));
export const staffLoginVerify = run((req) => auth.verifyLogin(req.body.phone, req.body.code, device(req), 'staff'));
export const resend = run((req) => inTransaction((client) => auth.resendOtp(req.body.phone, req.body.purpose, client)));
export const refresh = async (req: Request, res: Response, next: NextFunction) => { try { const result=await inTransaction((client)=>auth.rotateRefreshToken(req.body?.refreshToken,device(req),client));if(result.reuseDetected){disconnectSessionSockets(result.sessionId);throw new ApiError(401,'refresh_token_reuse_detected');}res.json({tokens:result.tokens}); } catch(error){next(error);} };
export const google = run((req) => inTransaction((client) => auth.googleSignIn(req.body.idToken, device(req), client)));
export const staffGoogle = run((req) => inTransaction((client) => auth.staffGoogleSignIn(req.body?.idToken, req.body?.expectedNonce, device(req), client)));
export const me = run((req) => inTransaction((client) => auth.getMe(req.userId!, client, req.sessionScope)));
export const profileUpdate = run((req) => inTransaction((client) => auth.updateProfile(req.userId!, req.body, client)));
export const phoneChangeInitiate = run((req) => inTransaction((client) => auth.initiatePhoneChange(req.userId!, req.body?.phone, client)));
export const phoneChangeVerify = run((req) => auth.verifyPhoneChange(req.userId!, req.body?.challenge, req.body?.code));
export const activeRole = run((req) => inTransaction((client) => auth.switchActiveRole(req.userId!, req.body.role, client)));
export const logout = run(async (req) => { const session=await inTransaction(async(client) => {const value=await auth.revokePresentedToken(req.body?.refreshToken, client);if(value)await revokeDeviceIfPresent(client,value.userId,req.body?.deviceId);return value;});if(session)disconnectSessionSockets(session.sessionId);return { success: true }; });
export const logoutAll = run(async (req) => { await inTransaction(async(client) => {await auth.revokeAll(req.userId!, client);await revokeAllDevices(client,req.userId!,'user_logout_all');});disconnectAccountSockets(req.userId!);return { success: true }; });
