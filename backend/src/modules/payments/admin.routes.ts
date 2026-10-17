import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireStaffRole } from '../auth/auth.middleware';
import { adjustBalance, freezeAccount, getPaymentSettings, inspectUser, refundTrip, sweepGateway, updatePaymentSettings } from './admin.service';

const run=(fn:(req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req).then((value)=>res.json(value)).catch(next);};
export const paymentAdminRouter=Router();
paymentAdminRouter.use(requireAuth,requireStaffRole('admin','super_admin'));
paymentAdminRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const moneyEnabled=(_req:Request,_res:Response,next:NextFunction)=>env.ENABLE_ADMIN_MONEY_ACTIONS ? next() : next(new ApiError(403,'admin_money_actions_disabled'));
paymentAdminRouter.post('/refunds',moneyEnabled,run((req)=>refundTrip(req.userId!,req.body)));
paymentAdminRouter.post('/adjustments',moneyEnabled,run((req)=>adjustBalance(req.userId!,req.authUser!.role,req.body)));
paymentAdminRouter.post('/accounts/:userId/freeze',moneyEnabled,run((req)=>freezeAccount(req.userId!,String(req.params.userId),req.body.account,req.body.frozen,req.body.reason,req.body.requestKey)));
paymentAdminRouter.get('/users/:userId',run((req)=>inspectUser(req.userId!,String(req.params.userId))));
paymentAdminRouter.post('/sweeps',moneyEnabled,requireStaffRole('super_admin'),run((req)=>sweepGateway(req.userId!,Number(req.body.amountKobo),req.body.reason,req.body.requestKey)));
paymentAdminRouter.get('/settings',run(()=>getPaymentSettings()));
paymentAdminRouter.patch('/settings',requireStaffRole('super_admin'),run((req)=>updatePaymentSettings(req.userId!,req.body)));
