import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireApprovedDriver, requireAuth } from '../auth/auth.middleware';
import { driverEarningsSummary, walletSummary, walletTransactions } from './wallet.service';
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
withdrawalsRouter.post('/',run((req)=>requestWithdrawal(req.userId!,String(req.body.payoutAccountId??''),Number(req.body.amountKobo),String(req.body.otpCode??''),req.body.expectedFeeKobo)));
withdrawalsRouter.get('/',run((req)=>listWithdrawals(req.userId!)));
withdrawalsRouter.get('/:id',run((req)=>getWithdrawal(req.userId!,String(req.params.id))));

export const driverEarningsRouter=Router();
driverEarningsRouter.get('/summary',requireAuth,requireApprovedDriver,run(req=>driverEarningsSummary(req.userId!,req.query.range)));

// Show the configured charges and limits before a driver confirms a withdrawal.
paymentsRouter.get('/withdrawal-policy',requireApprovedDriver,run(async()=>{
 const row=(await db.query<{min_withdrawal_kobo:string;max_daily_withdrawal_kobo:string;withdrawal_fee_kobo:string;new_payout_account_cooldown_hours:number}>('SELECT min_withdrawal_kobo,max_daily_withdrawal_kobo,withdrawal_fee_kobo,new_payout_account_cooldown_hours FROM payment_settings WHERE id=true')).rows[0];
 if(!row)throw new Error('withdrawal_policy_unavailable');
 return {minWithdrawalKobo:Number(row.min_withdrawal_kobo),maxDailyWithdrawalKobo:Number(row.max_daily_withdrawal_kobo),withdrawalFeeKobo:Number(row.withdrawal_fee_kobo),newAccountCooldownHours:row.new_payout_account_cooldown_hours};
}));
