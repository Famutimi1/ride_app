import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireStaffRole } from '../auth/auth.middleware';
import { adjustBalance, freezeAccount, getPaymentSettings, inspectUser, refundTrip, sweepGateway, updatePaymentSettings } from './admin.service';

const run=(fn:(req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req).then((value)=>res.json(value)).catch(next);};
export const paymentAdminRouter=Router();
paymentAdminRouter.use(requireAuth,requireStaffRole('admin','super_admin'));
paymentAdminRouter.post('/refunds',run((req)=>refundTrip(req.userId!,req.body)));
paymentAdminRouter.post('/adjustments',run((req)=>adjustBalance(req.userId!,req.authUser!.role,req.body)));
paymentAdminRouter.post('/accounts/:userId/freeze',run((req)=>freezeAccount(req.userId!,String(req.params.userId),req.body.account,req.body.frozen,req.body.reason,req.body.requestKey)));
paymentAdminRouter.get('/users/:userId',run((req)=>inspectUser(String(req.params.userId))));
paymentAdminRouter.post('/sweeps',requireStaffRole('super_admin'),run((req)=>sweepGateway(req.userId!,Number(req.body.amountKobo),req.body.reason,req.body.requestKey)));
paymentAdminRouter.get('/settings',run(()=>getPaymentSettings()));
paymentAdminRouter.patch('/settings',requireStaffRole('super_admin'),run((req)=>updatePaymentSettings(req.userId!,req.body)));
