import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { getBalances } from './ledger.service';

export const walletSummary=getBalances;
export async function walletTransactions(userId:string,account:'wallet'|'earnings',cursor?:number) {
  if (account!=='wallet'&&account!=='earnings') throw new ApiError(400,'invalid_account');
  if (cursor!==undefined&&(!Number.isSafeInteger(cursor)||cursor<1)) throw new ApiError(400,'invalid_cursor');
  const kind=account==='wallet'?'user_wallet':'driver_earnings';
  const rows=await db.query<{id:string;transaction_id:string;direction:string;amount_kobo:string;balance_after_kobo:string;created_at:Date;type:string;description:string|null;reference_type:string|null;reference_id:string|null}>(
    `SELECT e.id,e.transaction_id,e.direction,e.amount_kobo,e.balance_after_kobo,e.created_at,t.type,t.description,t.reference_type,t.reference_id
     FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id JOIN ledger_accounts a ON a.id=e.account_id
     WHERE a.owner_user_id=$1 AND a.kind=$2 AND ($3::bigint IS NULL OR e.id<$3) ORDER BY e.id DESC LIMIT 51`,
    [userId,kind,cursor??null]);
  const items=rows.rows.slice(0,50).map((row)=>({id:row.id,transactionId:row.transaction_id,direction:row.direction,
    amountKobo:Number(row.amount_kobo),balanceAfterKobo:Number(row.balance_after_kobo),createdAt:row.created_at,
    type:row.type,description:row.description,referenceType:row.reference_type,referenceId:row.reference_id}));
  return {items,nextCursor:rows.rows.length>50?items[items.length-1]?.id:null};
}
