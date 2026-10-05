import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { getOrCreateWalletAccount, getSystemAccountId, postTransaction } from '../payments/ledger.service';

dotenv.config();
const databaseUrl=process.env.DATABASE_URL;
const schema=`ledger_test_${process.pid}_${Date.now()}`;
async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>) {
  const client=await pool.connect();
  try { await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value; }
  catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();}
}

test('ledger balances, concurrency, idempotency and immutability', {skip:!databaseUrl},async()=>{
  const admin=new Pool({connectionString:databaseUrl});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema},public`,max:60});
  try {
    for(const file of ['001_auth.sql','002_trip_system.sql','003_payments_ledger.sql'])
      await pool.query(await readFile(resolve(process.cwd(),'migrations',file),'utf8'));
    const user=(await pool.query<{id:string}>("INSERT INTO users(full_name,phone) VALUES('Ledger Test','+2348000000099') RETURNING id")).rows[0].id;
    const {wallet,expense}=await transaction(pool,async(client)=>({wallet:await getOrCreateWalletAccount(client,user),expense:await getSystemAccountId(client,'expense_adjustments')}));
    await transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'seed',entries:[
      {accountId:expense,direction:'debit',amountKobo:100000},{accountId:wallet,direction:'credit',amountKobo:100000}]}));
    await assert.rejects(transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'bad',entries:[
      {accountId:expense,direction:'debit',amountKobo:100},{accountId:wallet,direction:'credit',amountKobo:99}]})),/unbalanced/);
    const debit=(index:number)=>transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:`debit-${index}`,entries:[
      {accountId:wallet,direction:'debit',amountKobo:10000},{accountId:expense,direction:'credit',amountKobo:10000}]}));
    const results=await Promise.allSettled(Array.from({length:50},(_,index)=>debit(index)));
    assert.equal(results.filter((item)=>item.status==='fulfilled').length,10);
    assert.equal(Number((await pool.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[wallet])).rows[0].balance_kobo),0);
    const replay=await transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'debit-0',entries:[
      {accountId:wallet,direction:'debit',amountKobo:10000},{accountId:expense,direction:'credit',amountKobo:10000}]}));
    assert.equal(replay.replayed,true);
    await assert.rejects(transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'non-positive',entries:[
      {accountId:expense,direction:'debit',amountKobo:0},{accountId:wallet,direction:'credit',amountKobo:0}]})),/bad_amount/);
    await assert.rejects(transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'overdraft',entries:[
      {accountId:wallet,direction:'debit',amountKobo:1},{accountId:expense,direction:'credit',amountKobo:1}]})),/insufficient_funds/);
    const secondUser=(await pool.query<{id:string}>("INSERT INTO users(full_name,phone) VALUES('Second Wallet','+2348000000100') RETURNING id")).rows[0].id;
    const secondWallet=await transaction(pool,(client)=>getOrCreateWalletAccount(client,secondUser));
    await transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'fund-two-wallets',entries:[
      {accountId:expense,direction:'debit',amountKobo:20000},{accountId:wallet,direction:'credit',amountKobo:10000},
      {accountId:secondWallet,direction:'credit',amountKobo:10000}]}));
    const transfers=await Promise.allSettled(Array.from({length:20},(_,index)=>transaction(pool,(client)=>postTransaction(client,{
      type:'adjustment',idempotencyKey:`opposite-${index}`,entries:[
        {accountId:index%2===0?wallet:secondWallet,direction:'debit',amountKobo:100},
        {accountId:index%2===0?secondWallet:wallet,direction:'credit',amountKobo:100},
      ]}))));
    assert.equal(transfers.filter((item)=>item.status==='fulfilled').length,20,'opposite account orders do not deadlock');
    assert.equal(Number((await pool.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[wallet])).rows[0].balance_kobo),10000);
    await assert.rejects(transaction(pool,(client)=>postTransaction(client,{type:'adjustment',idempotencyKey:'debit-0',entries:[
      {accountId:wallet,direction:'debit',amountKobo:1},{accountId:expense,direction:'credit',amountKobo:1}]})),/idempotency_key_reused/);
    await assert.rejects(pool.query('UPDATE ledger_entries SET amount_kobo=1 WHERE account_id=$1',[wallet]),/append-only/);
    await assert.rejects(transaction(pool,async(client)=>{await client.query("INSERT INTO ledger_transactions(type,idempotency_key,request_hash) VALUES('adjustment','empty',repeat('0',64))");}),/unbalanced ledger transaction/);
  } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
