import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLOWED_TRANSITIONS, canTransition } from './tripStateMachine';
import type { TripStatus } from './trip.types';

const legal: Array<[TripStatus,TripStatus]> = [
  ['searching','driver_assigned'],['searching','no_drivers_found'],['searching','cancelled'],
  ['driver_assigned','driver_arrived'],['driver_assigned','cancelled'],
  ['driver_arrived','in_progress'],['driver_arrived','cancelled'],['in_progress','completed'],
];

test('allows every documented transition',()=>{for(const [from,to] of legal)assert.equal(canTransition(from,to),true,`${from} -> ${to}`);});
test('rejects every undocumented transition',()=>{const statuses=Object.keys(ALLOWED_TRANSITIONS) as TripStatus[];for(const from of statuses)for(const to of statuses)if(!legal.some(([a,b])=>a===from&&b===to))assert.equal(canTransition(from,to),false,`${from} -> ${to}`);});
