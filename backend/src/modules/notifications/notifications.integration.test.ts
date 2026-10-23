import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';

test('notification persistence, preferences and provider receipts', { skip: !process.env.DATABASE_URL }, async (t) => {
  const schema = `notifications_test_${process.pid}_${Date.now()}`;
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
  const { db } = await import('../../shared/config/db.js');
  const originalQuery = db.query;
  const originalConnect = db.connect;
  db.query = pool.query.bind(pool) as typeof db.query;
  db.connect = pool.connect.bind(pool) as typeof db.connect;
  try {
    for (const file of (await readdir(resolve('migrations'))).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
      await pool.query(await readFile(resolve('migrations', file), 'utf8'));
    }
    const user = (await pool.query<{id:string}>("INSERT INTO users(full_name,role) VALUES('Notification user','user') RETURNING id")).rows[0];
    const service = await import('./notifications.service.js');
    const input = { userId:user.id,type:'trip_started',category:'trip_updates' as const,eventKey:'trip:one:started:rider',title:'Trip started',body:'Your ride is moving.',data:{tripId:'one'},sendPush:false };
    const first = await service.createNotificationRecord(db, input);
    const retry = await service.createNotificationRecord(db, input);
    assert.equal(first.isNew, true);
    assert.equal(retry.isNew, false);
    assert.equal(first.record.id, retry.record.id);
    assert.equal('sendPush' in first.record.data, false);
    assert.equal((await pool.query('SELECT count(*)::int count FROM notifications')).rows[0].count, 1);

    const defaults = await service.getPreferences(user.id);
    assert.equal(defaults.tripUpdatesEnabled, true);
    assert.equal(defaults.promotionsEnabled, false);
    const updated = await service.updatePreferences(user.id, { tripUpdatesEnabled:false, soundEnabled:false });
    assert.equal(updated.tripUpdatesEnabled, false);
    assert.equal(updated.soundEnabled, false);
    await assert.rejects(service.updatePreferences(user.id, { promotionsEnabled:'yes' }), /invalid_notification_preferences/);
    await assert.rejects(service.registerDevice(user.id, { expoPushToken:'not-a-token',platform:'android',deviceIdentifier:'test-device',appVersion:'1.0.0' }), /invalid_push_device/);
    const device=await service.registerDevice(user.id,{expoPushToken:'ExponentPushToken[notification-fixture]',platform:'android',deviceIdentifier:'test-device',appVersion:'1.0.0'});
    assert.equal((await pool.query('SELECT enabled FROM push_devices WHERE id=$1',[device.deviceId])).rows[0].enabled,true);
    await service.revokeDevice(user.id,device.deviceId);
    assert.deepEqual((await pool.query('SELECT enabled,revocation_reason FROM push_devices WHERE id=$1',[device.deviceId])).rows[0],{enabled:false,revocation_reason:'user_revoked'});
    const another=(await pool.query<{id:string}>("INSERT INTO users(full_name,role) VALUES('Second notification user','user') RETURNING id")).rows[0];
    await service.registerDevice(another.id,{expoPushToken:'ExponentPushToken[notification-fixture]',platform:'android',deviceIdentifier:'second-device',appVersion:'1.0.0'});
    assert.equal((await pool.query('SELECT user_id FROM push_devices WHERE expo_push_token=$1',['ExponentPushToken[notification-fixture]'])).rows[0].user_id,another.id);
    await service.revokeAllDevices(db,another.id);
    assert.equal((await pool.query('SELECT enabled FROM push_devices WHERE expo_push_token=$1',['ExponentPushToken[notification-fixture]'])).rows[0].enabled,false);

    const inbox = await service.listNotifications(user.id);
    assert.equal(inbox.notifications.length, 1);
    assert.equal((await service.unreadCount(user.id)).count, 1);
    await service.markRead(user.id, first.record.id);
    assert.equal((await service.unreadCount(user.id)).count, 0);
    assert.ok((await service.markOpened(user.id,first.record.id)).openedAt);

    for(const key of ['two','three'])await service.createNotificationRecord(db,{...input,eventKey:`trip:${key}:started:rider`,data:{tripId:key}});
    await pool.query("UPDATE notifications SET created_at='2026-10-14T10:00:00Z' WHERE user_id=$1",[user.id]);
    const pageOne=await service.listNotifications(user.id,undefined,1);
    const pageTwo=await service.listNotifications(user.id,pageOne.nextCursor??undefined,1);
    const pageThree=await service.listNotifications(user.id,pageTwo.nextCursor??undefined,1);
    assert.equal(new Set([...pageOne.notifications,...pageTwo.notifications,...pageThree.notifications].map(item=>item.id)).size,3);

    await t.test('role-scoped pages, counts and reads separate an account with both roles', async () => {
      const both = (await pool.query<{id:string}>("INSERT INTO users(full_name,role) VALUES('Dual role fixture','user') RETURNING id")).rows[0];
      const fixtures = [
        { type: 'trip_completed', category: 'trip_updates' as const, eventKey: 'trip:ride:rider', deepLink: '/ongoing-trip', audience: 'rider' },
        { type: 'trip_completed', category: 'trip_updates' as const, eventKey: 'trip:work:driver', deepLink: '/driver-trip', audience: 'driver' },
        { type: 'ride_payment_settled', category: 'wallet_updates' as const, eventKey: 'payment:old', deepLink: '/account/driver-wallet', audience: 'rider' },
        { type: 'topup_succeeded', category: 'wallet_updates' as const, eventKey: 'topup:old-rider', deepLink: '/account/driver-wallet', audience: 'rider', title: 'Wallet top-up successful' },
        { type: 'topup_succeeded', category: 'wallet_updates' as const, eventKey: 'topup:old-driver', deepLink: '/account/driver-wallet', audience: 'driver', title: 'Earnings balance updated' },
        { type: 'ride_offer', category: 'driver_offers' as const, eventKey: 'offer:one', deepLink: '/driver-dashboard', audience: 'driver' },
        { type: 'driver_application_approved', category: 'support' as const, eventKey: 'application:one', deepLink: '/driver-dashboard', audience: 'driver' },
        { type: 'withdrawal_succeeded', category: 'wallet_updates' as const, eventKey: 'withdrawal:one', deepLink: '/account/driver-wallet', audience: 'driver' },
        { type: 'scheduled_ride_confirmed', category: 'scheduled_reminders' as const, eventKey: 'schedule:one', deepLink: null, audience: 'rider' },
        { type: 'support_updated', category: 'support' as const, eventKey: 'support:one', deepLink: '/account/support', audience: 'shared' },
        { type: 'safety_updated', category: 'safety_security' as const, eventKey: 'safety:one', deepLink: '/account/safety', audience: 'shared' },
      ];
      const ids: string[] = [];
      for (const fixture of fixtures) {
        const created = await service.createNotificationRecord(db, { ...input, ...fixture, userId: both.id, title: fixture.title ?? 'Fixture', data: {} });
        assert.equal(created.record.data.audience, fixture.audience);
        ids.push(created.record.id);
      }
      // Deliberately use distinct sub-millisecond times: JS Date must not truncate the cursor.
      for(const [index,id] of ids.entries())await pool.query("UPDATE notifications SET created_at='2026-10-23T08:00:00Z'::timestamptz+($2::int*interval '1 microsecond') WHERE id=$1",[id,index+1]);
      // Exercise the pre-existing rows too, without a migration or destructive backfill.
      await pool.query("UPDATE notifications SET data=data-'audience' WHERE user_id=$1", [both.id]);
      for (const role of ['rider', 'driver'] as const) {
        const expected = fixtures.filter(fixture => fixture.audience === role || fixture.audience === 'shared');
        assert.equal((await service.unreadCount(both.id, role)).count, expected.length);
        const received: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await service.listNotifications(both.id, cursor, 2, role);
          assert.ok(page.notifications.every(item => item.data.audience === role || item.data.audience === 'shared'));
          received.push(...page.notifications.map(item => item.eventKey));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        assert.deepEqual(received.sort(), expected.map(item => item.eventKey).sort());
      }
      await assert.rejects(service.markOpened(both.id, ids[0], 'driver'), /notification_not_found/);
      await assert.rejects(service.markRead(both.id, ids[1], 'rider'), /notification_not_found/);
      await assert.rejects(service.markOpened(another.id, ids[1], 'driver'), /notification_not_found/);
      assert.equal((await service.markAllRead(both.id, 'driver')).updated, 7);
      assert.equal((await service.unreadCount(both.id, 'driver')).count, 0);
      assert.equal((await service.unreadCount(both.id, 'rider')).count, 4);
      const opened = await service.markOpened(both.id, ids[0], 'rider');
      assert.ok(opened.openedAt);
      await service.markRead(both.id, ids[0], 'rider');
      assert.equal((await service.unreadCount(both.id, 'rider')).count, 3);
      assert.equal((await service.listNotifications(both.id)).notifications.length, fixtures.length);
    });

    const { processNotificationReceipts } = await import('./notificationQueue.js');
    const originalFetch = globalThis.fetch;
    const receipts = new Map<string, { status:'ok'|'error'; details?:{error:string} }>();
    const sentNotification = async (name:string, results:Array<'ok'|'invalid'|'pending'>) => {
      const notification = await service.createNotificationRecord(db, {...input,eventKey:`receipt:${name}`});
      const tickets:Array<{id:string;token:string}> = [];
      const deviceIds:string[] = [];
      for (const [index,result] of results.entries()) {
        const id = `${name}-${index}`;
        const token = `ExponentPushToken[receipt-${id}]`;
        const device = await service.registerDevice(user.id, {
          expoPushToken:token,platform:'android',deviceIdentifier:`receipt-${id}`,appVersion:'1.0.0',
        });
        tickets.push({id,token});
        deviceIds.push(device.deviceId);
        if (result==='ok') receipts.set(id,{status:'ok'});
        if (result==='invalid') receipts.set(id,{status:'error',details:{error:'DeviceNotRegistered'}});
      }
      await pool.query(`UPDATE notifications SET delivery_status='sent',push_ticket_ids=$2::jsonb,
        last_delivery_error='previous_error',updated_at=now()-interval '2 minutes' WHERE id=$1`,
      [notification.record.id,JSON.stringify(tickets)]);
      return {id:notification.record.id,deviceIds};
    };
    const receiptState = async (id:string) => (await pool.query<{
      delivery_status:string;delivered_at:Date|null;last_delivery_error:string|null;
    }>('SELECT delivery_status,delivered_at,last_delivery_error FROM notifications WHERE id=$1',[id])).rows[0];
    try {
      // Exercise the actual receipt processor and PostgreSQL update, without
      // contacting Expo or delivering anything to a real device.
      globalThis.fetch = async (url,options) => {
        assert.equal(String(url),'https://exp.host/--/api/v2/push/getReceipts');
        const request = JSON.parse(String(options?.body)) as {ids:string[]};
        const data = Object.fromEntries(request.ids.filter(id=>receipts.has(id)).map(id=>[id,receipts.get(id)]));
        return new Response(JSON.stringify({data}),{status:200});
      };
      await t.test('successful receipts persist delivery and clear the previous error',async()=>{
        const notification = await sentNotification('delivered',['ok']);
        await processNotificationReceipts();
        const state = await receiptState(notification.id);
        assert.equal(state.delivery_status,'delivered');
        assert.ok(state.delivered_at);
        assert.equal(state.last_delivery_error,null);
      });
      await t.test('unregistered devices are revoked and the exact error is persisted',async()=>{
        const notification = await sentNotification('invalid',['invalid']);
        await processNotificationReceipts();
        assert.deepEqual(await receiptState(notification.id),{
          delivery_status:'failed',delivered_at:null,last_delivery_error:'DeviceNotRegistered',
        });
        assert.deepEqual((await pool.query('SELECT enabled,revocation_reason FROM push_devices WHERE id=$1',
          [notification.deviceIds[0]])).rows[0],{enabled:false,revocation_reason:'device_not_registered'});
      });
      await t.test('missing receipts leave the notification awaiting a provider result',async()=>{
        const notification = await sentNotification('pending',['pending']);
        await processNotificationReceipts();
        assert.deepEqual(await receiptState(notification.id),{
          delivery_status:'sent',delivered_at:null,last_delivery_error:'previous_error',
        });
      });
      await t.test('a valid device can receive delivery while an invalid device is revoked',async()=>{
        const notification = await sentNotification('multiple',['invalid','ok']);
        await processNotificationReceipts();
        const state = await receiptState(notification.id);
        assert.equal(state.delivery_status,'delivered');
        assert.ok(state.delivered_at);
        assert.equal(state.last_delivery_error,null);
        const {rows} = await pool.query<{id:string;enabled:boolean}>(
          'SELECT id,enabled FROM push_devices WHERE id=ANY($1::uuid[])',[notification.deviceIds]);
        assert.equal(rows.find(row=>row.id===notification.deviceIds[0])?.enabled,false);
        assert.equal(rows.find(row=>row.id===notification.deviceIds[1])?.enabled,true);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    db.query = originalQuery;
    db.connect = originalConnect;
    const { stopNotificationWorkers } = await import('./notificationQueue.js');
    await stopNotificationWorkers();
    await pool.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    await owner.end();
    await db.end();
  }
});
