import { randomUUID } from 'node:crypto';
import { db } from '../../shared/config/db';
import { emitCallState } from '../../websocket/notifications';
import { presentCall,type CallRow } from './call.types';

export const callTransport={state:emitCallState};
export async function processCallOutbox() {
  const lease=randomUUID();
  const tasks=(await db.query<{id:string;call_id:string;attempts:number}>(`UPDATE call_outbox SET lease_token=$1,lease_until=now()+interval '30 seconds',attempts=attempts+1
    WHERE id IN (SELECT id FROM call_outbox WHERE dispatched_at IS NULL AND available_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED)
    RETURNING id,call_id,attempts`,[lease])).rows;
  let dispatched=0,failed=0;
  for(const task of tasks){
    try{
      // Publish the latest state, so a delayed ringing event cannot resurrect an
      // ended call. Clients reconcile versions and recover via GET /calls/active.
      const row=(await db.query<CallRow>('SELECT * FROM call_sessions WHERE id=$1',[task.call_id])).rows[0];
      if(row)callTransport.state(presentCall(row),[row.caller_id,row.callee_id]);
      await db.query('UPDATE call_outbox SET dispatched_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2',[task.id,lease]);
      dispatched++;
    }catch{
      await db.query(`UPDATE call_outbox SET available_at=now()+make_interval(secs=>$3),lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,[task.id,lease,Math.min(60,2**Math.min(task.attempts,6))]);
      failed++;
    }
  }
  return {dispatched,failed};
}
