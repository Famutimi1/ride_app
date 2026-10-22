import { Router } from 'express';
import { activeRole, google, staffGoogle, loginInitiate, loginVerify, staffLoginVerify, logout, logoutAll, me, refresh, registerInitiate, registerVerify, resend, profileUpdate, phoneChangeInitiate, phoneChangeVerify } from './auth.controller';
import { requireAuth,limitPublicAuth } from './auth.middleware';

import { limitMediaUpload,parseAvatar,releaseMediaUpload } from '../../shared/middleware/mediaUpload';
import { uploadAvatar,removeAvatar } from './avatar.service';
export const authRouter = Router();
authRouter.post('/profile/avatar',requireAuth,limitMediaUpload,parseAvatar,async(req,res,next)=>{
  try {res.json(await uploadAvatar(req.userId!,req.file,req.get('If-Match')));}catch(error){next(error);}finally{releaseMediaUpload(req);}
});
authRouter.delete('/profile/avatar',requireAuth,async(req,res,next)=>{
  try {res.json(await removeAvatar(req.userId!,req.get('If-Match')));}catch(error){next(error);}
});
const publicAuthPaths=new Set(['/register/initiate','/register/verify','/login/initiate','/login/verify','/login/staff/verify','/otp/resend','/refresh','/google','/google/staff','/logout']);
authRouter.use((req,res,next)=>{if(req.method==='POST'&&publicAuthPaths.has(req.path))void limitPublicAuth(req,res,next);else next();});
authRouter.use((req,res,next)=>{if(['POST','PATCH'].includes(req.method)&&req.path!=='/logout-all'&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return void res.status(400).json({error:'invalid_request_body'});next();});
authRouter.post('/register/initiate', registerInitiate);
authRouter.post('/register/verify', registerVerify);
authRouter.post('/login/initiate', loginInitiate);
authRouter.post('/login/verify', loginVerify);
authRouter.post('/login/staff/verify', staffLoginVerify);
authRouter.post('/otp/resend', resend);
authRouter.post('/refresh', refresh);
authRouter.post('/google', google);
authRouter.post('/google/staff', staffGoogle);
authRouter.get('/me', requireAuth, me);
authRouter.patch('/profile', requireAuth, profileUpdate);
authRouter.post('/phone-change/initiate', requireAuth, phoneChangeInitiate);
authRouter.post('/phone-change/verify', requireAuth, phoneChangeVerify);
authRouter.patch('/active-role', requireAuth, activeRole);
// The refresh credential authenticates its own revocation, including after access expiry.
authRouter.post('/logout', logout);
authRouter.post('/logout-all', requireAuth, logoutAll);
