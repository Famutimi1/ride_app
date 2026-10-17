import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import {Pool} from 'pg';
dotenv.config();
const url=process.env.DATABASE_URL;
test('booking commission survives rate changes and is immutable through settlement', {skip:!url||!process.env.REDIS_URL},async()=>{
  const schema=`commission_test_${process.pid}_${Date.now()}`;
  const admin=new Pool({connectionString:url});let scoped:Pool|undefined;let redis:import('ioredis').default|undefined;const quoteId=randomUUID();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const dbUrl=new URL(url!);dbUrl.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=dbUrl.toString();
    const {db,inTransaction}=await import('../../shared/config/db.js');scoped=db;
    for(const file of (await readdir('migrations')).filter(x=>/^\d+_.*\.sql$/.test(x)).sort()) await db.query(await readFile(resolve('migrations',file),'utf8'));
    const rider=(await db.query("INSERT INTO users(full_name) VALUES('Commission rider') RETURNING id")).rows[0].id as string;
    const driver=(await db.query("INSERT INTO users(full_name,active_role) VALUES('Commission driver','driver') RETURNING id")).rows[0].id as string;
    await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')",[driver]);
    const {ensureRedis}=await import('../../shared/config/redis.js');redis=await ensureRedis();
    const pickup={latitude:6.45,longitude:3.39,address:'Test pickup'},dropoff={latitude:6.55,longitude:3.49,address:'Test destination'};
    await db.query("UPDATE fare_config SET commission_bps=1500 WHERE vehicle_type='economy'");
    await redis.set(`trip:quote:${quoteId}`,JSON.stringify({riderId:rider,pickup,dropoff,expiresAt:Date.now()+60000,estimate:{vehicleType:'economy',distanceM:1000,durationS:300,encodedPolyline:'',fareKobo:500000,distanceKm:1,durationMin:5,estimatedFare:5000,currency:'NGN'}}),'EX',60);
    const {createTrip,completeTrip}=await import('./trips.service.js');
    const booked=await createTrip(rider,{pickup,dropoff,quoteId,paymentMethod:'cash'},randomUUID());
    assert.equal(booked.trip.commission_bps_snapshot,1500);
    await db.query("UPDATE fare_config SET commission_bps=3000 WHERE vehicle_type='economy'");
    await assert.rejects(db.query('UPDATE trips SET commission_bps_snapshot=3000 WHERE id=$1',[booked.trip.id]),/trip_commission_snapshot_is_immutable/);
    const {transitionTrip}=await import('./tripStateMachine.js');
    await inTransaction(async client=>{
      await transitionTrip(client,{tripId:booked.trip.id,from:'searching',to:'driver_assigned',actorType:'driver',actorId:driver,fields:{driver_id:driver,accepted_at:new Date()}});
      await transitionTrip(client,{tripId:booked.trip.id,from:'driver_assigned',to:'driver_arrived',actorType:'driver',actorId:driver,fields:{arrived_at:new Date()}});
      await transitionTrip(client,{tripId:booked.trip.id,from:'driver_arrived',to:'in_progress',actorType:'driver',actorId:driver,fields:{started_at:new Date()}});
    });
    const completed=await completeTrip(driver,booked.trip.id);
    assert.equal(completed.commission_kobo,75000);
    assert.equal(completed.driver_earning_kobo,425000);
    assert.equal(completed.payment_status,'settled');
    const evidence=(await db.query('SELECT settle_tx_id FROM trips WHERE id=$1',[booked.trip.id])).rows[0].settle_tx_id;
    assert.ok(evidence);
    const {refundEligibility}=await import('../payments/dashboard.service.js');
    assert.equal((await refundEligibility(booked.trip.id)).eligible,true);
  } finally {
    await redis?.del(`trip:quote:${quoteId}`);await redis?.quit();await scoped?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
  }
});
