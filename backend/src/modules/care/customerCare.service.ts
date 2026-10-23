import {createHash} from 'node:crypto';
import {db,inTransaction} from '../../shared/config/db';
import {ApiError} from '../../shared/errors';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const select=`SELECT id,subject,category,status,trip_id AS "tripId",created_at AS "createdAt",updated_at AS "updatedAt" FROM support_cases`;
function text(value:unknown,min:number,max:number){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new ApiError(400,'invalid_care_text');return value.trim();}
function requestInput(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_body');return input as Record<string,unknown>;}
function key(value:unknown){if(typeof value!=='string'||!uuid.test(value))throw new ApiError(400,'invalid_request_key');return value;}
export async function listCustomerCases(userId:string,cursor:unknown){
  if(cursor!==undefined&&(typeof cursor!=='string'||!uuid.test(cursor)))throw new ApiError(400,'invalid_cursor');
  const {rows}=await db.query(`${select} WHERE customer_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM support_cases WHERE id=$2 AND customer_id=$1)) ORDER BY created_at DESC,id DESC LIMIT 21`,[userId,cursor??null]);
  return {cases:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null};
}
export async function customerCase(userId:string,id:string,before:unknown){
  if(!uuid.test(id))throw new ApiError(404,'support_case_not_found');
  if(before!==undefined&&(typeof before!=='string'||!/^\d{1,19}$/.test(before)))throw new ApiError(400,'invalid_cursor');
  const record=(await db.query(`${select} WHERE id=$1 AND customer_id=$2`,[id,userId])).rows[0];
  if(!record)throw new ApiError(404,'support_case_not_found');
  // Staff notes are private unless explicitly marked customer-visible.
  const {rows}=await db.query(`SELECT id::text,body,created_at AS "createdAt",CASE WHEN actor_id=$2 THEN 'you' ELSE 'support' END AS "from" FROM care_activity WHERE case_id=$1 AND visibility='customer' AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT 51`,[id,userId,before??null]);
  return {...record,messages:rows.slice(0,50).reverse(),nextBefore:rows.length>50?rows[49].id:null};
}
export async function createCustomerCase(userId:string,raw:unknown){
  const input=requestInput(raw),subject=text(input.subject,5,160),body=text(input.body,5,4000),requestKey=key(input.requestKey);
  if(typeof input.category!=='string'||!['trip','payment','account','other'].includes(input.category))throw new ApiError(400,'invalid_category');
  const tripId=input.tripId==null?null:String(input.tripId);
  if(tripId&&!uuid.test(tripId))throw new ApiError(400,'invalid_trip_id');
  const hash=createHash('sha256').update(JSON.stringify({subject,body,category:input.category,tripId})).digest('hex');
  return inTransaction(async client=>{
    // Serialize retries and rate limits across all API instances without a new table.
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const known=(await client.query(`SELECT c.id,a.metadata->>'hash' AS hash FROM care_activity a JOIN support_cases c ON c.id=a.case_id WHERE c.customer_id=$1 AND a.actor_id=$1 AND a.kind='created' AND a.metadata->>'customerRequestKey'=$2 LIMIT 1`,[userId,requestKey])).rows[0];
    if(known){if(known.hash!==hash)throw new ApiError(409,'support_request_conflict');return {id:known.id,replayed:true};}
    if(tripId&&!(await client.query('SELECT 1 FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2)',[tripId,userId])).rowCount)throw new ApiError(404,'trip_not_found');
    const count=(await client.query(`SELECT count(*)::int AS count FROM support_cases WHERE customer_id=$1 AND created_by=$1 AND created_at>now()-interval '1 hour'`,[userId])).rows[0].count;
    if(count>=5)throw new ApiError(429,'support_rate_limited');
    const record=(await client.query(`INSERT INTO support_cases(customer_id,trip_id,category,severity,subject,created_by) VALUES($1,$2,$3,'medium',$4,$1) RETURNING id`,[userId,tripId,input.category,subject])).rows[0];
    await client.query(`INSERT INTO care_activity(case_id,actor_id,kind,visibility,body,metadata) VALUES($1,$2,'created','customer',$3,$4)`,[record.id,userId,body,JSON.stringify({customerRequestKey:requestKey,hash})]);
    return {id:record.id,replayed:false};
  });
}
export async function replyCustomerCase(userId:string,id:string,raw:unknown){
  if(!uuid.test(id))throw new ApiError(404,'support_case_not_found');
  const input=requestInput(raw),body=text(input.body,5,4000),requestKey=key(input.requestKey);
  return inTransaction(async client=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const record=(await client.query('SELECT status FROM support_cases WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,userId])).rows[0];
    if(!record)throw new ApiError(404,'support_case_not_found');
    const known=(await client.query(`SELECT body FROM care_activity WHERE case_id=$1 AND actor_id=$2 AND metadata->>'customerRequestKey'=$3`,[id,userId,requestKey])).rows[0];
    if(known){if(known.body!==body)throw new ApiError(409,'support_request_conflict');return {success:true,replayed:true};}
    if(record.status==='resolved')throw new ApiError(409,'support_case_resolved');
    const count=(await client.query(`SELECT count(*)::int AS count FROM care_activity WHERE actor_id=$1 AND visibility='customer' AND created_at>now()-interval '1 hour'`,[userId])).rows[0].count;
    if(count>=30)throw new ApiError(429,'support_rate_limited');
    await client.query(`INSERT INTO care_activity(case_id,actor_id,kind,visibility,body,metadata) VALUES($1,$2,'note','customer',$3,$4)`,[id,userId,body,JSON.stringify({customerRequestKey:requestKey})]);
    await client.query('UPDATE support_cases SET version=version+1,updated_at=now() WHERE id=$1',[id]);
    return {success:true,replayed:false};
  });
}
