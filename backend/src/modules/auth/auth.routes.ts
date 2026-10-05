import { Router } from 'express';
import { activeRole, google, loginInitiate, loginVerify, logout, logoutAll, me, refresh, registerInitiate, registerVerify, resend } from './auth.controller';
import { requireAuth } from './auth.middleware';

export const authRouter = Router();
authRouter.post('/register/initiate', registerInitiate);
authRouter.post('/register/verify', registerVerify);
authRouter.post('/login/initiate', loginInitiate);
authRouter.post('/login/verify', loginVerify);
authRouter.post('/otp/resend', resend);
authRouter.post('/refresh', refresh);
authRouter.post('/google', google);
authRouter.get('/me', requireAuth, me);
authRouter.patch('/active-role', requireAuth, activeRole);
authRouter.post('/logout', requireAuth, logout);
authRouter.post('/logout-all', requireAuth, logoutAll);
