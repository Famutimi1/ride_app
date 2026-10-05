import { db } from '../../shared/config/db';
import { env } from '../../config/env';
import { gateway } from './gateway';
import { applySuccessfulTopup } from './topups.service';
import { applyWithdrawalOutcome } from './withdrawals.service';
import { enqueuePayout } from './paymentQueue';
import { enqueueWebhook } from './paymentQueue';

async function alertOps(kind:string,details:Record<string,unknown>) {
  console.error('[payments] alert',kind,details);
  if (!env.ALERT_WEBHOOK_URL) return;
  try { await fetch(env.ALERT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:`Rakky Ride payment alert: ${kind}`,details}),signal:AbortSignal.timeout(5000)}); }
  catch(error) { console.error('[payments] alert delivery failed',error instanceof Error?error.message:'unknown'); }
}
export async function reconcileTopups() {
  const stuckEvents=await db.query<{dedupe_key:string}>("SELECT dedupe_key FROM payment_webhook_events WHERE status IN ('received','failed') AND received_at<now()-interval '2 minutes' LIMIT 100");
  for (const event of stuckEvents.rows) await enqueueWebhook(event.dedupe_key);
  const rows=await db.query<{provider_reference:string;created_at:Date}>("SELECT provider_reference,created_at FROM payment_intents WHERE status='pending' AND created_at<now()-interval '10 minutes' LIMIT 100");
  for (const row of rows.rows) {
    try {
      const result=await applySuccessfulTopup(row.provider_reference);
      if (result.status==='mismatch') await alertOps('topup_mismatch',{reference:row.provider_reference});
      if (!result.applied && new Date(row.created_at).getTime()<Date.now()-86400000 && ['abandoned','failed'].includes(result.status))
        await db.query("UPDATE payment_intents SET status='abandoned',updated_at=now() WHERE provider_reference=$1 AND status='pending'",[row.provider_reference]);
    } catch(error) { console.error('[payments] top-up reconciliation failed',{reference:row.provider_reference,error:error instanceof Error?error.message:'unknown'}); }
  }
}
export async function reconcileWithdrawals() {
  const pending=await db.query<{id:string;provider_reference:string}>("SELECT id,provider_reference FROM withdrawals WHERE status='pending' AND requested_at<now()-interval '2 minutes' LIMIT 100");
  for (const row of pending.rows) {
    try {
      const verified=await gateway.verifyTransfer(row.provider_reference);
      if (['success','failed','reversed'].includes(verified.status)) await applyWithdrawalOutcome(row.provider_reference,verified.status);
      else if (verified.status==='pending') await enqueuePayout(row.id);
    } catch { await enqueuePayout(row.id); }
  }
  const processing=await db.query<{provider_reference:string}>("SELECT provider_reference FROM withdrawals WHERE status='processing' AND updated_at<now()-interval '15 minutes' LIMIT 100");
  for (const row of processing.rows) {
    try { const verified=await gateway.verifyTransfer(row.provider_reference);await applyWithdrawalOutcome(row.provider_reference,verified.status); }
    catch(error) { console.error('[payments] withdrawal reconciliation failed',{reference:row.provider_reference,error:error instanceof Error?error.message:'unknown'}); }
  }
}
export async function checkLedgerIntegrity() {
  const problems=await db.query<{kind:string;id:string}>(`
    SELECT 'unbalanced' kind,t.id::text id FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.id
      GROUP BY t.id HAVING COALESCE(SUM(e.amount_kobo) FILTER(WHERE e.direction='debit'),0)<>COALESCE(SUM(e.amount_kobo) FILTER(WHERE e.direction='credit'),0)
    UNION ALL
    SELECT 'cached_balance',a.id::text FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id
      GROUP BY a.id HAVING a.balance_kobo<>COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)
    UNION ALL
    SELECT 'last_entry',a.id::text FROM ledger_accounts a JOIN LATERAL (SELECT balance_after_kobo FROM ledger_entries WHERE account_id=a.id ORDER BY id DESC LIMIT 1) e ON true
      WHERE a.balance_kobo<>e.balance_after_kobo LIMIT 100`);
  if (problems.rows.length) await alertOps('ledger_integrity_failed',{problems:problems.rows});
  return problems.rows;
}
export async function checkGatewayBalance() {
  if (!env.PAYSTACK_SECRET_KEY) return;
  const actual=await gateway.getBalance();
  const expected=Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code='gateway_balance'")).rows[0]?.balance_kobo??0);
  const alertLevel=Number((await db.query<{paystack_balance_alert_kobo:string}>('SELECT paystack_balance_alert_kobo FROM payment_settings WHERE id=true')).rows[0]?.paystack_balance_alert_kobo??0);
  if (Math.abs(actual-expected)>10000) await alertOps('gateway_balance_drift',{actualKobo:actual,ledgerKobo:expected});
  if (actual<alertLevel) await alertOps('gateway_balance_low',{actualKobo:actual,thresholdKobo:alertLevel});
}
export async function checkStuckEscrow() {
  const rows=await db.query<{id:string}>("SELECT id FROM trips WHERE status IN ('completed','cancelled','no_drivers_found') AND payment_status='held' LIMIT 50");
  const escrow=Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code='escrow_trips'")).rows[0]?.balance_kobo??0);
  const active=Number((await db.query<{total:string}>("SELECT COALESCE(SUM(fare_kobo),0)::text total FROM trips WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress') AND payment_status='held'")).rows[0]?.total??0);
  if (rows.rows.length||escrow!==active) await alertOps('stuck_escrow',{terminalTripIds:rows.rows.map((row)=>row.id),escrowKobo:escrow,activeFaresKobo:active});
}
export async function dailyFinanceReport() {
  const totals=(await db.query<{topups:string;gmv:string;commission:string;withdrawals:string;failed_withdrawals:string;gateway_fees:string;cash_debt:string;suspense:string}>(`
    SELECT
      (SELECT COALESCE(SUM(amount_kobo),0)::text FROM payment_intents WHERE status='succeeded' AND paid_at>=now()-interval '1 day') topups,
      (SELECT COALESCE(SUM(fare_kobo),0)::text FROM trips WHERE status='completed' AND completed_at>=now()-interval '1 day') gmv,
      (SELECT COALESCE(SUM(commission_kobo),0)::text FROM trips WHERE status='completed' AND completed_at>=now()-interval '1 day') commission,
      (SELECT COALESCE(SUM(amount_kobo),0)::text FROM withdrawals WHERE status='success' AND completed_at>=now()-interval '1 day') withdrawals,
      (SELECT COUNT(*)::text FROM withdrawals WHERE status IN ('failed','reversed') AND completed_at>=now()-interval '1 day') failed_withdrawals,
      (SELECT COALESCE(SUM(e.amount_kobo),0)::text FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.code='expense_gateway_fees' AND e.direction='debit' AND e.created_at>=now()-interval '1 day') gateway_fees,
      (SELECT COALESCE(SUM(-balance_kobo),0)::text FROM ledger_accounts WHERE kind='driver_earnings' AND balance_kobo<0) cash_debt,
      (SELECT balance_kobo::text FROM ledger_accounts WHERE code='suspense') suspense`)).rows[0];
  console.info('[payments] daily finance report',totals);
  if (env.ALERT_WEBHOOK_URL) {
    try { await fetch(env.ALERT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Rakky Ride daily finance report',totals}),signal:AbortSignal.timeout(5000)}); }
    catch(error) { console.error('[payments] daily report delivery failed',error instanceof Error?error.message:'unknown'); }
  }
  return totals;
}
