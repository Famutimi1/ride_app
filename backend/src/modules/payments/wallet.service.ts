import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { getBalances } from './ledger.service';

export const walletSummary=getBalances;

export interface DriverEarningsSummary {
  range: 'today' | 'week' | 'month'; trips: number; grossKobo: number; commissionKobo: number; netKobo: number;
  cashTrips: number; walletTrips: number; cashCollectedKobo: number; cashEarningsKobo: number;
  walletEarningsKobo: number; cashCommissionKobo: number;
}

/** Trip income is separate from wallet movement and outstanding cash commission. */
export async function driverEarningsSummary(userId: string, rangeValue: unknown): Promise<DriverEarningsSummary> {
  const range = rangeValue === 'week' || rangeValue === 'month' ? rangeValue : 'today';
  const period = range === 'today' ? 'day' : range;
  const row = (await db.query<{
    trips: string; gross_kobo: string; commission_kobo: string; net_kobo: string;
    cash_trips: string; wallet_trips: string; cash_collected_kobo: string;
    cash_earnings_kobo: string; wallet_earnings_kobo: string; cash_commission_kobo: string;
  }>(`SELECT COUNT(*)::text AS trips,
      COALESCE(SUM(fare_kobo),0)::text AS gross_kobo,
      COALESCE(SUM(commission_kobo),0)::text AS commission_kobo,
      COALESCE(SUM(COALESCE(driver_earning_kobo, fare_kobo - COALESCE(commission_kobo,0))),0)::text AS net_kobo,
      COUNT(*) FILTER(WHERE payment_method='cash')::text AS cash_trips,
      COUNT(*) FILTER(WHERE payment_method='wallet')::text AS wallet_trips,
      COALESCE(SUM(fare_kobo) FILTER(WHERE payment_method='cash'),0)::text AS cash_collected_kobo,
      COALESCE(SUM(COALESCE(driver_earning_kobo, fare_kobo - COALESCE(commission_kobo,0))) FILTER(WHERE payment_method='cash'),0)::text AS cash_earnings_kobo,
      COALESCE(SUM(COALESCE(driver_earning_kobo, fare_kobo - COALESCE(commission_kobo,0))) FILTER(WHERE payment_method='wallet'),0)::text AS wallet_earnings_kobo,
      COALESCE(SUM(commission_kobo) FILTER(WHERE payment_method='cash'),0)::text AS cash_commission_kobo
    FROM trips WHERE driver_id=$1 AND status IN ('completed','returned') AND payment_status='settled'
      AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END)
        >= (date_trunc($2,now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')`,
  [userId, period])).rows[0];
  return {
    range, trips: Number(row.trips), grossKobo: Number(row.gross_kobo), commissionKobo: Number(row.commission_kobo),
    netKobo: Number(row.net_kobo), cashTrips: Number(row.cash_trips), walletTrips: Number(row.wallet_trips),
    cashCollectedKobo: Number(row.cash_collected_kobo), cashEarningsKobo: Number(row.cash_earnings_kobo),
    walletEarningsKobo: Number(row.wallet_earnings_kobo), cashCommissionKobo: Number(row.cash_commission_kobo),
  };
}

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
