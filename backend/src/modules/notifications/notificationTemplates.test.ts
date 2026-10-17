import assert from 'node:assert/strict';
import test from 'node:test';
import { careNotification, driverApplicationNotification, driverOfferNotification, tripStatusNotifications, walletNotification } from './notificationTemplates';
import { buildExpoPushMessage, notificationCategoryEnabled, type DeliveryPreferences } from './notificationQueue';

const trip = {
  id: 'trip-1',
  rider_id: 'rider-1',
  driver_id: 'driver-1',
  service_type: 'ride',
  scheduled_at: null,
} as const;

test('trip templates target the correct participant and route', () => {
  const arrival = tripStatusNotifications(trip, 'driver_arrived');
  assert.equal(arrival.length, 1);
  assert.equal(arrival[0].userId, 'rider-1');
  assert.equal(arrival[0].type, 'driver_arrived');
  assert.equal(arrival[0].priority, 'high');
  assert.equal(arrival[0].deepLink, '/ongoing-trip');

  const completed = tripStatusNotifications(trip, 'completed');
  assert.deepEqual(completed.map((item) => item.userId), ['rider-1', 'driver-1']);
  assert.equal(new Set(completed.map((item) => item.eventKey)).size, 2);
});

test('scheduled activation produces a scheduled reminder', () => {
  const scheduled = tripStatusNotifications({ ...trip, scheduled_at: new Date('2026-10-14T10:00:00Z') }, 'searching');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].category, 'scheduled_reminders');
  assert.equal(scheduled[0].type, 'scheduled_ride_starting');
  assert.equal(tripStatusNotifications({ ...trip, scheduled_at: new Date('2026-10-14T10:00:00Z') }, 'completed')[0].category,'trip_updates');
});

test('driver offers expire and carry the trip identity', () => {
  const expiresAt = new Date('2026-10-14T10:00:30Z');
  const offer = driverOfferNotification({ driverId: 'driver-1', tripId: 'trip-1', serviceType: 'ride', fareKobo: 255000, distanceToPickupM: 1450, expiresAt });
  assert.equal(offer.category, 'driver_offers');
  assert.equal(offer.priority, 'high');
  assert.equal(offer.expiresAt, expiresAt);
  assert.equal(offer.data?.tripId, 'trip-1');
  assert.match(offer.body, /₦2,550/);
});

test('wallet and driver application templates use stable event keys', () => {
  const wallet = walletNotification({ userId: 'user-1', eventKey: 'topup:ref:success', type: 'topup_succeeded', title: 'Done', body: 'Done', referenceId: 'ref' });
  assert.equal(wallet.category, 'wallet_updates');
  assert.equal(wallet.eventKey, 'topup:ref:success');
  const review = driverApplicationNotification({ userId: 'user-1', status: 'rejected', reason: 'Document is unreadable', version: 'audit-1' });
  assert.equal(review.category, 'support');
  assert.equal(review.priority, 'high');
  assert.match(review.body, /unreadable/);
  assert.match(review.eventKey, /audit-1$/);
});

test('push delivery enforces the master and category preferences', () => {
  const preferences:DeliveryPreferences={category:'trip_updates',push_enabled:true,trip_updates_enabled:true,driver_offers_enabled:true,scheduled_reminders_enabled:true,wallet_updates_enabled:true,promotions_enabled:false,sound_enabled:true,vibration_enabled:true};
  assert.equal(notificationCategoryEnabled(preferences),true);
  assert.equal(notificationCategoryEnabled({...preferences,push_enabled:false}),false);
  assert.equal(notificationCategoryEnabled({...preferences,category:'promotions'}),false);
  assert.equal(notificationCategoryEnabled({...preferences,category:'wallet_updates',wallet_updates_enabled:false}),false);
});

test('Expo payload carries only the route metadata needed by the app', () => {
  const message=buildExpoPushMessage({type:'driver_arrived',category:'trip_updates',priority:'high',title:'Arrived',body:'Meet your driver.',data:{tripId:'trip-1'},deep_link:'/ongoing-trip',sound_enabled:false},'ExponentPushToken[test]','notification-1',45);
  assert.deepEqual(message.data,{tripId:'trip-1',notificationId:'notification-1',type:'driver_arrived',category:'trip_updates',priority:'high',deepLink:'/ongoing-trip'});
  assert.equal(message.priority,'high');
  assert.equal(message.data.priority,'high');
  assert.equal('sendPush' in message.data,false);
  assert.equal(message.sound,null);
  assert.equal(message.ttl,45);
});

test('care alerts keep lock-screen text generic',()=>{
  const safety=careNotification({userId:'user-1',kind:'safety',careId:'case-1',status:'responding',version:2});
  assert.equal(safety.category,'safety_security');
  assert.equal(safety.priority,'high');
  assert.doesNotMatch(safety.body,/address|phone|incident details/i);
  const support=careNotification({userId:'user-1',kind:'support',careId:'case-2',status:'waiting_customer',version:3});
  assert.equal(support.category,'support');
  assert.match(support.body,/waiting customer/);
});
