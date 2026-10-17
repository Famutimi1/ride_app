import { createHmac, timingSafeEqual } from 'node:crypto';
import { ensureRedis } from '../../shared/config/redis';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';

export interface PaymentGateway {
  initializeCharge(input:{email:string;amountKobo:number;reference:string;metadata:Record<string,unknown>;callbackUrl?:string}):Promise<{authorizationUrl:string;accessCode:string}>;
  verifyCharge(reference:string):Promise<{status:string;reference:string;domain:string;amountKobo:number;currency:string;feeKobo:number;channel:string|null;paidAt:string|null}>;
  listBanks():Promise<Array<{name:string;code:string}>>;
  resolveAccount(input:{accountNumber:string;bankCode:string}):Promise<{accountName:string}>;
  createRecipient(input:{name:string;accountNumber:string;bankCode:string}):Promise<{recipientCode:string}>;
  initiateTransfer(input:{amountKobo:number;recipientCode:string;reference:string;reason:string}):Promise<{status:string;transferCode:string|null}>;
  verifyTransfer(reference:string):Promise<VerifiedTransfer>;
  getBalance():Promise<number>;
  verifyWebhookSignature(rawBody:Buffer,signature:string|undefined):boolean;
}

export interface VerifiedTransfer {
  status:string; reference:string; domain:string; amountKobo:number; currency:string;
  recipientCode:string; transferCode:string|null; feeKobo:number|null;
}
export const paymentMode=()=>env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')?'live':'test';

interface Envelope<T> {status:boolean;message:string;data:T;code?:string}
export class PaystackRequestError extends ApiError {
  constructor(readonly httpStatus:number,readonly category:'not_found'|'rejected'|'access_denied'|'unavailable'|'invalid_response') {
    super(category==='not_found'?404:category==='access_denied'?503:category==='rejected'?400:502,`paystack_${category}`);
  }
}
export const isTransferNotFound=(error:unknown)=>error instanceof PaystackRequestError && error.category==='not_found';
export function verifyPaystackSignature(rawBody:Buffer,signature:string|undefined,secret:string):boolean {
  if (!secret || !signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected=createHmac('sha512',secret).update(rawBody).digest();
  const supplied=Buffer.from(signature,'hex');
  return expected.length===supplied.length && timingSafeEqual(expected,supplied);
}
export class PaystackGateway implements PaymentGateway {
  private async request<T>(method:'GET'|'POST',path:string,body?:unknown,deadline=AbortSignal.timeout(12000)):Promise<T> {
    if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503,'paystack_not_configured');
    if(method==='POST' && paymentMode()==='live' && !env.ENABLE_LIVE_PAYMENTS) throw new ApiError(503,'live_payments_disabled');
    for (let attempt=0;attempt<(method==='GET'?3:1);attempt++) {
      try {
        const response=await fetch(`${env.PAYSTACK_BASE_URL}${path}`,{
          method,headers:{Authorization:`Bearer ${env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},
          body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)]),
        });
        const envelope=await response.json().catch(()=>{throw new PaystackRequestError(response.status,'invalid_response');}) as Envelope<T>;
        if (!envelope || typeof envelope.status!=='boolean') throw new PaystackRequestError(response.status,'invalid_response');
        if (!response.ok || !envelope.status) {
          const transferMissing=path.startsWith('/transfer/verify/') && (response.status===404 || (response.status===400 && /^transfer not found\.?$/i.test(envelope.message??'')));
          throw new PaystackRequestError(response.status,transferMissing?'not_found':response.status===401||response.status===403||envelope.code==='transfer_unavailable'?'access_denied':response.status>=500||response.status===429?'unavailable':'rejected');
        }
        if(envelope.data===undefined || envelope.data===null)throw new PaystackRequestError(response.status,'invalid_response');
        void ensureRedis().then(r=>r.set('rakky:health:paystack',JSON.stringify({state:'reachable',observedAt:new Date().toISOString()}),'EX',86400)).catch(()=>undefined);
        return envelope.data;
      } catch(error) {
        if ((error instanceof PaystackRequestError&&error.category==='access_denied') || deadline.aborted || method==='POST' || attempt===2 || (error instanceof ApiError && error.status<500)) {
          void ensureRedis().then(r=>r.set('rakky:health:paystack',JSON.stringify({state:'degraded',observedAt:new Date().toISOString()}),'EX',86400)).catch(()=>undefined);
          throw error instanceof ApiError?error:new PaystackRequestError(0,'unavailable');
        }
        await new Promise((resolve)=>setTimeout(resolve,250*(attempt+1)));
      }
    }
    throw new ApiError(502,'paystack_unavailable');
  }
  async initializeCharge(input:{email:string;amountKobo:number;reference:string;metadata:Record<string,unknown>;callbackUrl?:string}) {
    const data=await this.request<{authorization_url:string;access_code:string}>('POST','/transaction/initialize',{
      email:input.email,amount:input.amountKobo,reference:input.reference,metadata:input.metadata,
      ...(input.callbackUrl?{callback_url:input.callbackUrl}:{}),
    });
    return {authorizationUrl:data.authorization_url,accessCode:data.access_code};
  }
  async verifyCharge(reference:string) {
    const data=await this.request<{status:string;reference:string;domain:string;amount:number;currency:string;fees:number;channel:string|null;paid_at:string|null}>('GET',`/transaction/verify/${encodeURIComponent(reference)}`);
    return {status:data.status,reference:data.reference,domain:data.domain,amountKobo:data.amount,currency:data.currency,feeKobo:data.fees,channel:data.channel,paidAt:data.paid_at};
  }
  async listBanks() {
    // Paystack currently returns the complete Nigerian bank list for this endpoint.
    // Paging it repeats the same banks and makes the picker thousands of rows long.
    const banks=await this.request<Array<{name:string;code:string}>>('GET','/bank?country=nigeria');
    return [...new Map(banks.map(({name,code})=>[code,{name,code}])).values()];
  }
  async resolveAccount(input:{accountNumber:string;bankCode:string}) {
    const data=await this.request<{account_name:string}>('GET',`/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`);
    return {accountName:data.account_name};
  }
  async createRecipient(input:{name:string;accountNumber:string;bankCode:string}) {
    const data=await this.request<{recipient_code:string}>('POST','/transferrecipient',{type:'nuban',name:input.name,account_number:input.accountNumber,bank_code:input.bankCode,currency:'NGN'});
    return {recipientCode:data.recipient_code};
  }
  async initiateTransfer(input:{amountKobo:number;recipientCode:string;reference:string;reason:string}) {
    const data=await this.request<{status:string;transfer_code:string|null}>('POST','/transfer',{source:'balance',amount:input.amountKobo,recipient:input.recipientCode,reference:input.reference,reason:input.reason,currency:'NGN'});
    return {status:data.status,transferCode:data.transfer_code};
  }
  async verifyTransfer(reference:string) {
    interface TransferData {status:string;reference:string;domain:string;amount:number;currency:string;transfer_code:string|null;recipient:{recipient_code:string};fee_charged?:number}
    const deadline=AbortSignal.timeout(14000);
    let data=await this.request<TransferData>('GET',`/transfer/verify/${encodeURIComponent(reference)}`,undefined,deadline);
    // Verify responses may omit fees. Fetch the same transfer's documented fee;
    // never settle using a mutable commercial estimate or silently assume zero.
    if(data.status==='success' && data.fee_charged===undefined && typeof data.transfer_code==='string') {
      const details=await this.request<TransferData>('GET',`/transfer/${encodeURIComponent(data.transfer_code)}`,undefined,deadline);
      if(details.reference!==data.reference || details.transfer_code!==data.transfer_code)throw new PaystackRequestError(200,'invalid_response');
      data=details;
    }
    return {status:data.status,reference:data.reference,domain:data.domain,amountKobo:data.amount,currency:data.currency,recipientCode:data.recipient?.recipient_code,
      transferCode:data.transfer_code,feeKobo:data.fee_charged??null};
  }
  async getBalance() {
    const data=await this.request<Array<{currency:string;balance:number}>>('GET','/balance');
    const balance=Array.isArray(data)?data.find((item)=>item.currency==='NGN')?.balance:undefined;
    if(typeof balance!=='number'||!Number.isSafeInteger(balance)||balance<0)throw new PaystackRequestError(200,'invalid_response');
    return balance!;
  }
  verifyWebhookSignature(rawBody:Buffer,signature:string|undefined) {
    return verifyPaystackSignature(rawBody,signature,env.PAYSTACK_SECRET_KEY);
  }
}
export const gateway:PaymentGateway=new PaystackGateway();
