import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';

export interface PaymentGateway {
  initializeCharge(input:{email:string;amountKobo:number;reference:string;metadata:Record<string,unknown>;callbackUrl?:string}):Promise<{authorizationUrl:string;accessCode:string}>;
  verifyCharge(reference:string):Promise<{status:string;reference:string;amountKobo:number;currency:string;feeKobo:number;channel:string|null;paidAt:string|null}>;
  listBanks():Promise<Array<{name:string;code:string}>>;
  resolveAccount(input:{accountNumber:string;bankCode:string}):Promise<{accountName:string}>;
  createRecipient(input:{name:string;accountNumber:string;bankCode:string}):Promise<{recipientCode:string}>;
  initiateTransfer(input:{amountKobo:number;recipientCode:string;reference:string;reason:string}):Promise<{status:string;transferCode:string|null}>;
  verifyTransfer(reference:string):Promise<{status:string;transferCode:string|null;failureReason:string|null}>;
  getBalance():Promise<number>;
  verifyWebhookSignature(rawBody:Buffer,signature:string|undefined):boolean;
}

interface Envelope<T> {status:boolean;message:string;data:T}
class PaystackRequestError extends ApiError {
  constructor(status:number,readonly providerMessage:string) {super(status,'paystack_request_failed');}
}
export function verifyPaystackSignature(rawBody:Buffer,signature:string|undefined,secret:string):boolean {
  if (!secret || !signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected=createHmac('sha512',secret).update(rawBody).digest();
  const supplied=Buffer.from(signature,'hex');
  return expected.length===supplied.length && timingSafeEqual(expected,supplied);
}
class PaystackGateway implements PaymentGateway {
  private async request<T>(method:'GET'|'POST',path:string,body?:unknown):Promise<T> {
    if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503,'paystack_not_configured');
    for (let attempt=0;attempt<(method==='GET'?3:1);attempt++) {
      try {
        const response=await fetch(`${env.PAYSTACK_BASE_URL}${path}`,{
          method,headers:{Authorization:`Bearer ${env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},
          body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000),
        });
        const envelope=await response.json() as Envelope<T>;
        if (!response.ok || !envelope.status) throw new PaystackRequestError(response.status>=500?502:400,envelope.message);
        return envelope.data;
      } catch(error) {
        if (method==='POST' || attempt===2 || (error instanceof ApiError && error.status<500)) throw error;
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
    const data=await this.request<{status:string;reference:string;amount:number;currency:string;fees:number|null;channel:string|null;paid_at:string|null}>('GET',`/transaction/verify/${encodeURIComponent(reference)}`);
    return {status:data.status,reference:data.reference,amountKobo:data.amount,currency:data.currency,feeKobo:data.fees??0,channel:data.channel,paidAt:data.paid_at};
  }
  async listBanks() {
    const banks:Array<{name:string;code:string}>=[];
    for(let page=1;page<=10;page++) {
      const batch=await this.request<Array<{name:string;code:string}>>('GET',`/bank?country=nigeria&perPage=100&page=${page}`);
      banks.push(...batch);
      if(batch.length<100) break;
    }
    return banks.map(({name,code})=>({name,code}));
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
    try {
      const data=await this.request<{status:string;transfer_code:string|null}>('POST','/transfer',{source:'balance',amount:input.amountKobo,recipient:input.recipientCode,reference:input.reference,reason:input.reason});
      return {status:data.status,transferCode:data.transfer_code};
    } catch(error) {
      if (error instanceof PaystackRequestError && error.providerMessage.toLowerCase().includes('reference')) return this.verifyTransfer(input.reference);
      throw error;
    }
  }
  async verifyTransfer(reference:string) {
    const data=await this.request<{status:string;transfer_code:string|null;failures:string|null}>('GET',`/transfer/verify/${encodeURIComponent(reference)}`);
    return {status:data.status,transferCode:data.transfer_code,failureReason:data.failures};
  }
  async getBalance() {
    const data=await this.request<Array<{currency:string;balance:number}>>('GET','/balance');
    return data.find((item)=>item.currency==='NGN')?.balance??0;
  }
  verifyWebhookSignature(rawBody:Buffer,signature:string|undefined) {
    return verifyPaystackSignature(rawBody,signature,env.PAYSTACK_SECRET_KEY);
  }
}
export const gateway:PaymentGateway=new PaystackGateway();
