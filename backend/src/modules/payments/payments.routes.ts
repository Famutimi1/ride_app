import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireApprovedDriver, requireAuth } from '../auth/auth.middleware';
import { walletSummary, walletTransactions } from './wallet.service';
import { createTopup, getTopup } from './topups.service';
import { addPayoutAccount, deactivatePayoutAccount, listBanksCached, listPayoutAccounts, resolvePayoutAccount, sendStepUpOtp } from './payoutAccounts.service';
import { getWithdrawal, listWithdrawals, requestWithdrawal } from './withdrawals.service';
import { db } from '../../shared/config/db';

const run=(fn:(req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req).then((value)=>res.json(value)).catch(next);};
export const walletRouter=Router();
walletRouter.use(requireAuth);
walletRouter.get('/',run((req)=>walletSummary(req.userId!)));
walletRouter.get('/transactions',run((req)=>walletTransactions(req.userId!,req.query.account==='earnings'?'earnings':'wallet',req.query.cursor?Number(req.query.cursor):undefined)));

export const paymentsRouter=Router();
paymentsRouter.use(requireAuth);
paymentsRouter.post('/topups',run((req)=>createTopup(req.userId!,Number(req.body.amountKobo),req.body.target)));
paymentsRouter.get('/topups/:reference',run((req)=>getTopup(req.userId!,String(req.params.reference))));
paymentsRouter.get('/banks',requireApprovedDriver,run(()=>listBanksCached()));

export const payoutAccountsRouter=Router();
payoutAccountsRouter.use(requireAuth,requireApprovedDriver);
payoutAccountsRouter.post('/otp',run((req)=>sendStepUpOtp(req.userId!,'payout_account')));
payoutAccountsRouter.post('/resolve',run((req)=>resolvePayoutAccount(req.userId!,String(req.body.accountNumber??''),String(req.body.bankCode??''))));
payoutAccountsRouter.get('/',run((req)=>listPayoutAccounts(req.userId!)));
payoutAccountsRouter.post('/',run((req)=>addPayoutAccount(req.userId!,req.body)));
payoutAccountsRouter.delete('/:id',run((req)=>deactivatePayoutAccount(req.userId!,String(req.params.id))));

export const withdrawalsRouter=Router();
withdrawalsRouter.use(requireAuth,requireApprovedDriver);
withdrawalsRouter.post('/otp',run((req)=>sendStepUpOtp(req.userId!,'withdrawal')));
withdrawalsRouter.post('/',run((req)=>requestWithdrawal(req.userId!,String(req.body.payoutAccountId??''),Number(req.body.amountKobo),String(req.body.otpCode??''))));
withdrawalsRouter.get('/',run((req)=>listWithdrawals(req.userId!)));
withdrawalsRouter.get('/:id',run((req)=>getWithdrawal(req.userId!,String(req.params.id))));

export const driverEarningsRouter=Router();
driverEarningsRouter.get('/summary',requireAuth,requireApprovedDriver,run(async(req)=>{
  const range=['today','week','month'].includes(String(req.query.range))?String(req.query.range):'today';
  const since=range==='today'?"date_trunc('day',now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'":range==='week'?"date_trunc('week',now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'":"date_trunc('month',now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'";
  const row=(await db.query<{trips:string;gross_kobo:string;commission_kobo:string;net_kobo:string;cash_trips:string;wallet_trips:string}>(
    `SELECT COUNT(*)::text trips,COALESCE(SUM(fare_kobo),0)::text gross_kobo,COALESCE(SUM(commission_kobo),0)::text commission_kobo,
      COALESCE(SUM(CASE WHEN payment_method='wallet' THEN driver_earning_kobo ELSE -commission_kobo END),0)::text net_kobo,
      COUNT(*) FILTER(WHERE payment_method='cash')::text cash_trips,COUNT(*) FILTER(WHERE payment_method='wallet')::text wallet_trips
     FROM trips WHERE driver_id=$1 AND status='completed' AND completed_at>=${since}`,[req.userId])).rows[0];
  return {range,trips:Number(row.trips),grossKobo:Number(row.gross_kobo),commissionKobo:Number(row.commission_kobo),netKobo:Number(row.net_kobo),cashTrips:Number(row.cash_trips),walletTrips:Number(row.wallet_trips)};
}));
