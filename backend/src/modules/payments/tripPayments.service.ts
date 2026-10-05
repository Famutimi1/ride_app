import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import type { TripRow } from '../trips/trip.types';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';

export async function holdTripFare(client: PoolClient, trip: TripRow): Promise<void> {
  if (trip.payment_method !== 'wallet') return;
  const wallet = await getOrCreateWalletAccount(client, trip.rider_id);
  const escrow = await getSystemAccountId(client, 'escrow_trips');
  const { transactionId } = await postTransaction(client, { type: 'trip_hold', idempotencyKey: `trip:${trip.id}:hold`, referenceType: 'trip', referenceId: trip.id,
    entries: [{accountId:wallet,direction:'debit',amountKobo:Number(trip.fare_kobo)},{accountId:escrow,direction:'credit',amountKobo:Number(trip.fare_kobo)}] });
  await client.query("UPDATE trips SET payment_status='held',hold_tx_id=$2 WHERE id=$1",[trip.id,transactionId]);
}

export async function releaseTripHold(client: PoolClient, trip: TripRow): Promise<void> {
  if (trip.payment_status !== 'held') return;
  const wallet = await getOrCreateWalletAccount(client, trip.rider_id);
  const escrow = await getSystemAccountId(client, 'escrow_trips');
  await postTransaction(client, { type: 'trip_hold_release', idempotencyKey: `trip:${trip.id}:release`, referenceType: 'trip', referenceId: trip.id,
    entries: [{accountId:escrow,direction:'debit',amountKobo:Number(trip.fare_kobo)},{accountId:wallet,direction:'credit',amountKobo:Number(trip.fare_kobo)}] });
  await client.query("UPDATE trips SET payment_status='released' WHERE id=$1",[trip.id]);
}

export async function settleTrip(client: PoolClient, trip: TripRow, commissionKobo: number, driverEarningKobo: number): Promise<void> {
  if (!trip.driver_id) throw new ApiError(409,'trip_has_no_driver');
  const earnings = await getOrCreateEarningsAccount(client,trip.driver_id);
  const revenue = await getSystemAccountId(client,'revenue_commission');
  const fare = Number(trip.fare_kobo);
  if (trip.payment_method === 'wallet' && trip.payment_status !== 'held') throw new ApiError(409,'trip_fare_not_held');
  if (trip.payment_method !== 'wallet' && trip.payment_method !== 'cash') throw new ApiError(409,'card_payment_not_available');
  if (trip.payment_method === 'cash' && commissionKobo === 0) {
    await client.query("UPDATE trips SET payment_status='settled' WHERE id=$1",[trip.id]);
    return;
  }
  const entries = trip.payment_method === 'wallet'
    ? [{accountId:await getSystemAccountId(client,'escrow_trips'),direction:'debit' as const,amountKobo:fare},
       ...(driverEarningKobo>0?[{accountId:earnings,direction:'credit' as const,amountKobo:driverEarningKobo}]:[]),
       ...(commissionKobo>0?[{accountId:revenue,direction:'credit' as const,amountKobo:commissionKobo}]:[])]
    : [{accountId:earnings,direction:'debit' as const,amountKobo:commissionKobo},{accountId:revenue,direction:'credit' as const,amountKobo:commissionKobo}];
  const {transactionId}=await postTransaction(client,{type:trip.payment_method==='wallet'?'trip_settlement_wallet':'trip_commission_cash',
    idempotencyKey:`trip:${trip.id}:settle`,referenceType:'trip',referenceId:trip.id,entries});
  await client.query("UPDATE trips SET payment_status='settled',settle_tx_id=$2 WHERE id=$1",[trip.id,transactionId]);
}
