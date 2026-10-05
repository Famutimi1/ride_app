import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFare, splitFare } from './fare.service';
import type { FareConfigRow } from './trip.types';

const config: FareConfigRow = { vehicle_type:'economy',base_fare_kobo:'80000',per_km_kobo:'25000',per_min_kobo:'3500',min_fare_kobo:'120000',commission_bps:1500 };

test('fare respects the minimum and rounds up to a whole naira',()=>{
  assert.equal(calculateFare(config,100,30),120000);
  assert.equal(calculateFare(config,3251,743)%100,0);
});

test('commission and driver earning always equal the fare',()=>{
  for(const fare of [120000,289900,1_340_000]){const split=splitFare(fare,1500);assert.equal(split.commissionKobo+split.driverEarningKobo,fare);}
});
