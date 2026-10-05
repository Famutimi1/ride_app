import { db, inTransaction } from '../../shared/config/db';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import { generateOtp, verifyOtp } from '../auth/otp.service';
import { gateway } from './gateway';

async function approvedDriver(userId:string) {
  const user=(await db.query<{full_name:string;phone:string|null}>("SELECT u.full_name,u.phone FROM users u JOIN driver_profiles d ON d.user_id=u.id AND d.status='approved' WHERE u.id=$1 AND u.is_active=true",[userId])).rows[0];
  if (!user) throw new ApiError(403,'driver_not_approved');
  return user;
}
async function rateLimit(key:string,limit:number,seconds:number) {
  const redis=await ensureRedis();
  const count=await redis.incr(key);
  if (count===1) await redis.expire(key,seconds);
  if (count>limit) throw new ApiError(429,'rate_limited',{retryAfterSeconds:await redis.ttl(key)});
}
export async function sendStepUpOtp(userId:string,purpose:'withdrawal'|'payout_account') {
  const user=await approvedDriver(userId);
  if (!user.phone) throw new ApiError(400,'verified_phone_required');
  await inTransaction((client)=>generateOtp(user.phone!,purpose,client));
  return {sent:true};
}
export async function listPayoutAccounts(userId:string) {
  await approvedDriver(userId);
  const {rows}=await db.query('SELECT id,bank_code,bank_name,account_last4,account_name,created_at FROM payout_accounts WHERE user_id=$1 AND is_active=true ORDER BY created_at DESC',[userId]);
  return {accounts:rows};
}
export async function listBanksCached() {
  const redis=await ensureRedis();
  const cached=await redis.get('payments:banks:nigeria');
  if (cached) return JSON.parse(cached) as Array<{name:string;code:string}>;
  const banks=await gateway.listBanks();
  await redis.set('payments:banks:nigeria',JSON.stringify(banks),'EX',86400);
  return banks;
}
export async function resolvePayoutAccount(userId:string,accountNumber:string,bankCode:string) {
  await approvedDriver(userId);
  if (!/^\d{10}$/.test(accountNumber)||!/^\d{3,10}$/.test(bankCode)) throw new ApiError(400,'invalid_bank_account');
  await rateLimit(`payments:resolve:${userId}`,10,3600);
  return gateway.resolveAccount({accountNumber,bankCode});
}
export async function addPayoutAccount(userId:string,input:{accountNumber:string;bankCode:string;otpCode:string}) {
  const user=await approvedDriver(userId);
  if (!user.phone||!/^\d{10}$/.test(input.accountNumber)||!/^\d{3,10}$/.test(input.bankCode)) throw new ApiError(400,'invalid_bank_account');
  const banks=await listBanksCached();
  const bank=banks.find((entry)=>entry.code===input.bankCode);
  if (!bank) throw new ApiError(400,'unknown_bank');
  const resolved=await gateway.resolveAccount({accountNumber:input.accountNumber,bankCode:input.bankCode});
  const mode=(await db.query<{payout_name_match:string}>('SELECT payout_name_match FROM payment_settings WHERE id=true')).rows[0]?.payout_name_match??'lenient';
  const ownTokens=user.full_name.toLowerCase().split(/\s+/).filter((token)=>token.length>1);
  const accountTokens=resolved.accountName.toLowerCase().split(/\s+/);
  const matches=mode==='off'||(mode==='strict'?ownTokens.every((token)=>accountTokens.includes(token)):ownTokens.some((token)=>accountTokens.includes(token)));
  if (!matches) throw new ApiError(409,'payout_name_mismatch');
  await inTransaction((client)=>verifyOtp(user.phone!,'payout_account',input.otpCode,client));
  const recipient=await gateway.createRecipient({name:resolved.accountName,accountNumber:input.accountNumber,bankCode:input.bankCode});
  const row=(await db.query('INSERT INTO payout_accounts(user_id,bank_code,bank_name,account_last4,account_name,recipient_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,recipient_code) DO UPDATE SET is_active=true RETURNING id,bank_code,bank_name,account_last4,account_name,created_at',
    [userId,input.bankCode,bank.name,input.accountNumber.slice(-4),resolved.accountName,recipient.recipientCode])).rows[0];
  return {account:row};
}
export async function deactivatePayoutAccount(userId:string,id:string) {
  const result=await db.query('UPDATE payout_accounts SET is_active=false WHERE id=$1 AND user_id=$2 AND NOT EXISTS(SELECT 1 FROM withdrawals WHERE payout_account_id=$1 AND status IN(\'pending\',\'processing\')) RETURNING id',[id,userId]);
  if (!result.rowCount) throw new ApiError(409,'payout_account_not_found_or_in_use');
  return {success:true};
}
export { approvedDriver, rateLimit };
