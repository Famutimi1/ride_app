import { env } from '../../config/env';
import type { EmailRequest } from './email.types';

export class EmailProviderError extends Error {
  constructor(public readonly code:string,public readonly retryable:boolean,public readonly ambiguous=false){super(code);}
}

export async function sendResendEmail(id:string,request:EmailRequest):Promise<string>{
  let response:Response;
  try {
    response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`rakky-email/${id}`},body:JSON.stringify(request),signal:AbortSignal.timeout(10_000)});
  }catch{throw new EmailProviderError('provider_connection_unknown',true,true);}
  if(!response.ok){
    // Response bodies can contain recipient addresses or request content. Persist
    // only a bounded, known code; never log provider bodies or credentials.
    const retryable=response.status===429||response.status>=500;
    throw new EmailProviderError(`resend_http_${response.status}`,retryable,response.status>=500);
  }
  let value:unknown;
  try{value=await response.json();}catch{throw new EmailProviderError('provider_response_unknown',true,true);}
  const idValue=value&&typeof value==='object'&&'id' in value?value.id:null;
  if(typeof idValue!=='string'||!/^[0-9a-f-]{36}$/i.test(idValue))throw new EmailProviderError('provider_response_unknown',true,true);
  return idValue;
}
