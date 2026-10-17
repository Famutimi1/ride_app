import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function connectedDashboard(root: string, apiOrigin: string) {
  await readFile(resolve(root,'.next/BUILD_ID'),'utf8');
  const reservation=createServer();
  await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));
  const port=(reservation.address() as AddressInfo).port;
  await new Promise<void>((done,reject)=>reservation.close(error=>error?reject(error):done()));
  const origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    cwd:root,stdio:'ignore',env:{...process.env,NODE_ENV:'production',DASHBOARD_PREVIEW:'false',RAKKY_API_URL:apiOrigin,DASHBOARD_ORIGIN:origin,RAKKY_ENVIRONMENT:'test'},
  });
  let spawnError:Error|undefined;
  child.once('error',error=>{spawnError=error;});
  const stop=async()=>{
    if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
    const exited=new Promise<void>(done=>child.once('exit',()=>done()));
    child.kill('SIGTERM');
    const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);timeout.unref();
    await exited;clearTimeout(timeout);
  };
  try {
    for(let attempt=0;attempt<60;attempt++){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null)throw new Error('Connected dashboard failed to start.');
      try { if((await fetch(`${origin}/login`,{signal:AbortSignal.timeout(1000)})).ok)return {origin,stop}; } catch {}
      await delay(100);
    }
    throw new Error('Connected dashboard startup timed out.');
  } catch(error){await stop();throw error;}
}

test('service enrollment, supply and assignment stay separate across passenger and courier work', { skip: !process.env.DATABASE_URL || !process.env.REDIS_URL, timeout: 60000 }, async t => {
  const schema = `driver_services_${process.pid}_${Date.now()}`;
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  await owner.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const { db, inTransaction } = await import('../../shared/config/db.js');
  const services = await import('../matching/serviceEligibility.js');
  const driver = await import('../driver/driver.service.js');
  const admin = await import('../driver/admin.service.js');
  const { findNearbyDrivers, saveDriverLocation } = await import('../location/location.service.js');
  const { findEligibleDrivers } = await import('../matching/matching.service.js');
  const { acceptTrip, getCurrentOffer } = await import('../trips/trips.service.js');
  const { dispatchNext } = await import('../trips/dispatch.service.js');
  const { ensureRedis } = await import('../../shared/config/redis.js');
  const partners: string[] = [];
  const tripIds: string[] = [];
  const redis = await ensureRedis();
  const point = { latitude: 6.456, longitude: 3.391 };
  const settings = (id: string) => inTransaction(client => services.getServiceSettings(id, client));
  const preferences = async (id: string, ride: boolean, courier: boolean) => {
    const current = await settings(id);
    return inTransaction(client => services.setServicePreferences(id, { acceptsRide: ride, acceptsCourier: courier, expectedVersion: current.version }, client));
  };
  try {
    const migrations = (await readdir('migrations')).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    for (const name of migrations.filter(name => !name.startsWith('016_'))) await db.query(await readFile(resolve('migrations', name), 'utf8'));
    const legacy = (await db.query("INSERT INTO users(full_name,active_role) VALUES('Legacy driver','driver') RETURNING id")).rows[0].id as string;
    partners.push(legacy);
    await db.query("INSERT INTO driver_profiles(user_id,status,accepts_courier) VALUES($1,'approved',true)", [legacy]);
    const legacyPending=(await db.query("INSERT INTO users(full_name) VALUES('Legacy pending partner') RETURNING id")).rows[0].id as string;
    partners.push(legacyPending);
    await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'pending')",[legacyPending]);
    await db.query(await readFile(resolve('migrations/016_driver_service_eligibility.sql'), 'utf8'));
    const staff = (await db.query("INSERT INTO users(full_name,role) VALUES('Service reviewer','super_admin') RETURNING id")).rows[0].id as string;
    const review = async (id: string, decisions: Record<string, string>, vehicleCategory?: string) => {
      const version = (await db.query('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1', [id])).rows[0].version;
      return admin.reviewAdminApplication(staff, id, { decision: 'approved', services: decisions, vehicleCategory, expectedVersion: version, reason: 'Isolated service eligibility review', requestKey: randomUUID() });
    };
    const apply = async (id: string, requested: Array<'ride' | 'courier'>, vehicleCategory: 'car' | 'motorcycle') => {
      const current = await settings(id);
      return inTransaction(client => services.submitServiceApplication(id, { services: requested, vehicleCategory, consentAccepted: true, consentVersion: services.SERVICE_CONSENT_VERSION, expectedVersion: current.version }, client));
    };
    const makePartner = async (requested: Array<'ride' | 'courier'>, category: 'car' | 'motorcycle' = 'car', approve = true) => {
      const id = (await db.query("INSERT INTO users(full_name,active_role) VALUES('Service fixture','driver') RETURNING id")).rows[0].id as string;
      partners.push(id);
      await db.query("INSERT INTO driver_profiles(user_id,residential_address,vehicle_make,vehicle_model,vehicle_year,vehicle_color,plate_number) VALUES($1,'Lekki test address','Test','Vehicle',2020,'Silver',$2)", [id, `T-${partners.length}`]);
      const bytes = Buffer.from('%PDF-1.4\n% Isolated service evidence\n');
      const file = { buffer: bytes, mimetype: 'application/pdf', size: bytes.length } as Express.Multer.File;
      await inTransaction(client => driver.saveDocuments(id, { license: [file], vehicleRegistration: [file], insurance: [file] }, client));
      await apply(id, requested, category);
      await inTransaction(client => driver.submitApplication(id, client));
      if(approve)await review(id, Object.fromEntries(requested.map(service => [service, 'approved'])));
      await saveDriverLocation({ driverId: id, ...point, timestamp: Date.now() });
      return id;
    };
    const makeTrip = async (service: 'ride' | 'courier', offerTo?: string) => {
      const rider = (await db.query("INSERT INTO users(full_name) VALUES('Service test rider') RETURNING id")).rows[0].id as string;
      const details = service === 'courier' ? { description: 'Books', weightKg: 1, recipientName: 'Test recipient', recipientPhone: '+2348012345678' } : null;
      const id = (await db.query(`INSERT INTO trips(rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key,service_type,vehicle_type,courier_details)
        VALUES($1,$2,6.456,3.391,'Pickup',6.5,3.4,'Dropoff',1000,300,100000,$3,$4,$5,$6) RETURNING id`, [rider, service === 'courier' ? 'wallet' : 'cash', randomUUID(), service, service === 'courier' ? 'courier' : 'economy', details])).rows[0].id as string;
      tripIds.push(id);
      if (offerTo) await db.query("INSERT INTO trip_offers(trip_id,driver_id,expires_at) VALUES($1,$2,now()+interval '1 minute')", [id, offerTo]);
      return id;
    };

    await t.test('migration preserves passenger compatibility without fabricating courier consent', async () => {
      const value = await settings(legacy);
      assert.equal(value.services.ride.enabled, true);
      assert.equal(value.services.ride.consentAccepted, true);
      assert.equal(value.services.courier.enabled, false);
      const profile = (await db.query('SELECT * FROM driver_profiles WHERE user_id=$1', [legacy])).rows[0];
      assert.deepEqual(profile.service_consent_history, []);
      assert.equal(profile.service_review_details.legacyCourierPreference, true);
      assert.equal(profile.vehicle_category, null);
      await saveDriverLocation({ driverId: legacy, ...point, timestamp: Date.now() });
    });

    await t.test('an existing pending application can finish service selection without repeating registration',async()=>{
      assert.equal((await settings(legacyPending)).services.ride.status,'pending');
      await apply(legacyPending,['courier'],'motorcycle');
      const selected=await settings(legacyPending);
      assert.equal(selected.vehicleCategory,'motorcycle');
      assert.equal(selected.services.ride.status,'none');
      assert.equal(selected.services.courier.status,'pending');
      assert.equal((await db.query('SELECT status FROM driver_profiles WHERE user_id=$1',[legacyPending])).rows[0].status,'pending');
    });

    const courierCar = await makePartner(['courier']);
    const courierBike = await makePartner(['courier'], 'motorcycle');
    const rides = await makePartner(['ride']);
    const both = await makePartner(['ride', 'courier']);
    await t.test('staff can distinguish grandfathered approval from recorded consent',async()=>{
      const legacyApplication=await admin.getAdminApplication(legacy,staff);
      const explicitApplication=await admin.getAdminApplication(courierCar,staff);
      assert.equal(legacyApplication.serviceSettings.services.ride.consentBasis,'legacy_passenger_approval');
      assert.equal(legacyApplication.serviceSettings.services.ride.consentRecord,null);
      assert.equal(explicitApplication.serviceSettings.services.courier.consentBasis,'recorded');
      assert.equal(explicitApplication.serviceSettings.services.courier.consentRecord?.action,'accepted');
    });
    await t.test('staff directory filters service enrollment and reports courier availability independently',async()=>{
      const {adminQuery}=await import('../../shared/utils/adminQuery.js');
      const {listAdminPeople}=await import('./admin.service.js');
      const page=await listAdminPeople(adminQuery({page:'1',service:'courier'}),true);
      assert.ok(page.items.some(person=>person.id===courierCar));
      assert.ok(!page.items.some(person=>person.id===rides));
      const {adminDriverPresence}=await import('../location/admin.service.js');
      const presence=(await adminDriverPresence([courierCar])).get(courierCar);
      assert.equal(presence?.availability,'available');
      assert.equal(presence?.serviceAvailability.ride,'ineligible');
      assert.equal(presence?.serviceAvailability.courier,'available');
    });
    await t.test('legacy classification preserves approvals, requires documents, and replays one audited decision',async()=>{
      const partner=await makePartner(['ride']);
      await db.query('UPDATE driver_profiles SET vehicle_category=NULL WHERE user_id=$1',[partner]);
      const version=(await db.query('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[partner])).rows[0].version;
      const input={decision:'approved',services:{},vehicleCategory:'car',expectedVersion:version,reason:'Legacy vehicle documents confirmed',requestKey:randomUUID()};
      const first=await admin.reviewAdminApplication(staff,partner,input);
      const replay=await admin.reviewAdminApplication(staff,partner,input);
      assert.equal(first.status,'approved');assert.equal(replay.status,'approved');assert.equal(first.auditId,replay.auditId);
      assert.equal((await settings(partner)).services.ride.enabled,true);
      assert.equal((await settings(partner)).services.courier.status,'none');
      const audit=(await db.query('SELECT metadata FROM admin_audit_log WHERE id=$1',[first.auditId])).rows[0].metadata;
      assert.equal(audit.before.vehicleCategory,null);assert.equal(audit.after.vehicleCategory,'car');
      await redis.del(`driver:${partner}:status`);
    });
    await t.test('staff HTTP approval, suspension and restoration return current versions and preserve the other service', async () => {
      const partner = await makePartner(['ride', 'courier'], 'car', false);
      const { createApp } = await import('../../app.js');
      const { signAccessToken } = await import('./jwt.service.js');
      const sessionId = randomUUID();
      const startedAt = new Date();
      await db.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) VALUES($1,$2,$3,'staff',now()+interval '12 hours')", [staff, sessionId, randomUUID()]);
      const token = signAccessToken({ id: staff }, 'staff', { id: sessionId, startedAt });
      const app = createApp();
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>(done => server.once('listening', done));
      const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/admin/driver-applications/${partner}`;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      let reviewUrl=`${base}/review`;
      let reviewHeaders:Record<string,string>=headers;
      let dashboard:Awaited<ReturnType<typeof connectedDashboard>>|undefined;
      const post = (body: object) => fetch(reviewUrl, { method: 'POST', headers:reviewHeaders, body: JSON.stringify(body) });
      const origin = new URL(base).origin;
      const driverHeaders = { Authorization: `Bearer ${signAccessToken({ id:partner })}`, 'Content-Type': 'application/json' };
      const driverRequest = (path:string, method = 'GET', body?:object) => fetch(`${origin}/api/driver/${path}`, {
        method, headers:driverHeaders, ...(body ? {body:JSON.stringify(body)} : {}),
      });
      const assertPersisted = async (ride:string,courier:string) => {
        const url=dashboard ? `${dashboard.origin}/api/admin/driver-applications/${partner}` : base;
        const response=await fetch(url,{headers:reviewHeaders,cache:'no-store'});
        assert.equal(response.status,200);
        const saved=await response.json() as {version:string;serviceSettings:{services:{ride:{status:string};courier:{status:string}}}};
        assert.equal(saved.serviceSettings.services.ride.status,ride);
        assert.equal(saved.serviceSettings.services.courier.status,courier);
        const row=(await db.query<{ride:string;courier:string;version:string}>('SELECT ride_service_status AS ride,courier_service_status AS courier,updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[partner])).rows[0];
        assert.deepEqual(row,{ride,courier,version:saved.version});
        return saved.version;
      };
      try {
        if(process.env.RAKKY_DASHBOARD_TEST_ROOT){
          dashboard=await connectedDashboard(resolve(process.env.RAKKY_DASHBOARD_TEST_ROOT),origin);
          reviewUrl=`${dashboard.origin}/api/admin/driver-applications/${partner}/review`;
          reviewHeaders={'Content-Type':'application/json',Origin:dashboard.origin,Cookie:`__Host-rakky-access=${token}`};
          const page=await fetch(`${dashboard.origin}/admin/applications/${partner}`,{headers:reviewHeaders});
          assert.equal(page.status,200);
          const html=await page.text();
          assert.ok(html.includes('Service fixture'));
          assert.equal(html.includes('Interactive preview.'),false);
          assert.equal((await fetch(reviewUrl,{method:'POST',headers:{...reviewHeaders,Origin:'https://other.invalid'},body:'{}'})).status,403);
          assert.equal((await fetch(reviewUrl,{method:'POST',headers:{'Content-Type':'application/json',Origin:dashboard.origin},body:'{}'})).status,401);
          const document=await fetch(`${dashboard.origin}/api/admin/driver-applications/${partner}/documents/license`,{headers:reviewHeaders});
          assert.equal(document.status,200);
          assert.ok(document.headers.get('content-type')?.startsWith('application/pdf'));
        }
        assert.equal((await fetch(base)).status, 401);
        const ownResponse = await driverRequest('application/status');
        assert.equal(ownResponse.status, 200);
        const ownText = await ownResponse.text();
        assert.equal(ownText.includes('private://'), false);
        const own = JSON.parse(ownText) as {vehicle:{make:string};documents:Array<{available:boolean}>};
        assert.equal(own.vehicle.make, 'Test');
        assert.equal(own.documents.length, 3);
        assert.ok(own.documents.every(document => document.available));
        assert.equal((await fetch(base, { headers:driverHeaders })).status, 403);
        const detail = await (await fetch(base, { headers })).json() as { version: string };
        const approval = { decision: 'approved', services: { courier: 'approved' }, expectedVersion: detail.version, reason: 'Disposable HTTP approval fixture', requestKey: randomUUID() };
        const approved = await post(approval);
        assert.equal(approved.status, 200);
        const result = await approved.json() as { version: string; auditId: string; serviceSettings: { services: { ride: {status:string}; courier: {status:string;enabled:boolean} } } };
        assert.equal(result.serviceSettings.services.ride.status, 'pending');
        assert.equal(result.serviceSettings.services.courier.status, 'approved');
        assert.notEqual(result.version, detail.version);
        assert.equal(await assertPersisted('pending','approved'),result.version);
        const replay = await (await post(approval)).json() as { version: string; auditId: string };
        assert.equal(replay.version, result.version);
        assert.equal(replay.auditId, result.auditId);
        assert.equal((await post({ ...approval, requestKey: randomUUID() })).status, 409);
        const rideApproved=await post({decision:'approved',services:{ride:'approved'},expectedVersion:result.version,reason:'Disposable passenger approval fixture',requestKey:randomUUID()});
        assert.equal(rideApproved.status,200);
        const bothVersion=await assertPersisted('approved','approved');
        const suspended = await post({ decision: 'rejected', services: { courier: 'suspended' }, expectedVersion: bothVersion, reason: 'Disposable HTTP suspension fixture', requestKey: randomUUID() });
        assert.equal(suspended.status, 200);
        const suspension = await suspended.json() as { version: string };
        assert.equal(await assertPersisted('approved','suspended'),suspension.version);
        const restored = await post({ decision: 'approved', services: { courier: 'approved' }, expectedVersion: suspension.version, reason: 'Disposable HTTP restoration fixture', requestKey: randomUUID() });
        assert.equal(restored.status, 200);
        const restoreVersion=await assertPersisted('approved','approved');
        const rideSuspended=await post({decision:'rejected',services:{ride:'suspended'},expectedVersion:restoreVersion,reason:'Disposable passenger suspension fixture',requestKey:randomUUID()});
        assert.equal(rideSuspended.status,200);
        const rideSuspensionVersion=await assertPersisted('suspended','approved');
        const rideRestored=await post({decision:'approved',services:{ride:'approved'},expectedVersion:rideSuspensionVersion,reason:'Disposable passenger restoration fixture',requestKey:randomUUID()});
        assert.equal(rideRestored.status,200);
        await assertPersisted('approved','approved');
        const current = await settings(partner);
        assert.equal(current.services.ride.status, 'approved');
        assert.equal(current.services.ride.enabled, false);
        assert.equal(current.services.courier.status, 'approved');
        assert.equal(current.services.courier.enabled, false);
        const latestResponse = await driverRequest('service-settings');
        assert.equal(latestResponse.status, 200);
        const latest = await latestResponse.json() as {version:number};
        const enabledResponse = await driverRequest('service-preferences', 'PUT', { acceptsRide:false,acceptsCourier:true,expectedVersion:latest.version });
        assert.equal(enabledResponse.status, 200);
        const enabled = await enabledResponse.json() as {version:number;services:{courier:{enabled:boolean}}};
        assert.equal(enabled.services.courier.enabled, true);
        assert.equal((await driverRequest('service-preferences', 'PUT', { acceptsRide:false,acceptsCourier:false,expectedVersion:latest.version })).status, 409);
        const withdrawnResponse = await driverRequest('service-consent/withdraw', 'POST', {service:'courier',expectedVersion:enabled.version});
        assert.equal(withdrawnResponse.status, 200);
        const withdrawn = await withdrawnResponse.json() as {version:number;services:{courier:{enabled:boolean;consentAccepted:boolean}}};
        assert.equal(withdrawn.services.courier.enabled, false);
        assert.equal(withdrawn.services.courier.consentAccepted, false);
        assert.equal((await driverRequest('service-preferences', 'PUT', {acceptsRide:false,acceptsCourier:true,expectedVersion:withdrawn.version})).status, 403);
        const applied = await driverRequest('service-applications','POST',{services:['courier'],vehicleCategory:'car',consentAccepted:true,consentVersion:services.SERVICE_CONSENT_VERSION,expectedVersion:withdrawn.version});
        assert.equal(applied.status, 200);
        const application = await applied.json() as {services:{courier:{consentAccepted:boolean};ride:{status:string}}};
        assert.equal(application.services.courier.consentAccepted, true);
        assert.equal(application.services.ride.status, 'approved');
        for (const service of ['ride','courier']) {
          const live = await fetch(`${origin}/api/admin/live?service=${service}`,{headers});
          assert.equal(live.status,200);
          assert.equal(((await live.json()) as {scope:{service:string}}).scope.service,service);
          const nearby = await fetch(`${origin}/api/location/nearby?latitude=6.456&longitude=3.391&serviceType=${service}`,{headers:driverHeaders});
          assert.equal(nearby.status,200);
          const directory = await fetch(`${origin}/api/admin/drivers?page=1&service=${service}`,{headers});
          assert.equal(directory.status,200);
        }
      } finally {
        await dashboard?.stop();
        server.closeAllConnections();
        await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
        await redis.del(`driver:${partner}:status`);
      }
    });
    await t.test('staff can suspend an inactive unclassified legacy driver without approving missing evidence', async () => {
      const partner = await makePartner(['ride']);
      await db.query('UPDATE users SET is_active=false WHERE id=$1', [partner]);
      await db.query('UPDATE driver_profiles SET vehicle_category=NULL,license_doc_url=NULL WHERE user_id=$1', [partner]);
      await review(partner, { ride: 'suspended' });
      const current = await settings(partner);
      assert.equal(current.vehicleCategory, null);
      assert.equal(current.services.ride.status, 'suspended');
      assert.equal(current.services.ride.enabled, false);
      await assert.rejects(review(partner, { ride: 'approved' }), { code: 'driver_application_incomplete' });
      assert.equal((await settings(partner)).services.ride.status, 'suspended');
      await redis.del(`driver:${partner}:status`);
    });
    await t.test('nearby maps and trip matching use the requested service', async () => {
      const passengers = (await findNearbyDrivers(point.latitude, point.longitude, 5)).map(item => item.driverId);
      const couriers = (await findNearbyDrivers(point.latitude, point.longitude, 5, 'courier')).map(item => item.driverId);
      assert.ok(passengers.includes(legacy) && passengers.includes(rides) && passengers.includes(both));
      assert.ok(!passengers.includes(courierCar) && !passengers.includes(courierBike));
      assert.ok(couriers.includes(courierCar) && couriers.includes(courierBike) && couriers.includes(both));
      assert.ok(!couriers.includes(rides) && !couriers.includes(legacy));
      const rideTrip = await makeTrip('ride');
      const courierTrip = await makeTrip('courier');
      const rideCandidates = await inTransaction(client => findEligibleDrivers(client, rideTrip, point.latitude, point.longitude, 5000));
      const courierCandidates = await inTransaction(client => findEligibleDrivers(client, courierTrip, point.latitude, point.longitude, 5000));
      assert.ok(!rideCandidates.some(item => [courierCar, courierBike].includes(item.driverId)));
      assert.ok(courierCandidates.some(item => item.driverId === courierBike));
    });

    await t.test('a new profile gets no default approval; motorcycles cannot request passenger work', async () => {
      const id = (await db.query("INSERT INTO users(full_name) VALUES('Unapproved fixture') RETURNING id")).rows[0].id as string;
      partners.push(id);
      await db.query('INSERT INTO driver_profiles(user_id) VALUES($1)', [id]);
      const value = await settings(id);
      assert.equal(value.services.ride.status, 'none');
      assert.equal(value.services.ride.enabled, false);
      await assert.rejects(apply(id, ['ride'], 'motorcycle'), { code: 'motorcycle_courier_only' });
      await assert.rejects(preferences(id, true, false), { code: 'service_not_approved' });
    });

    await t.test('all dual-service switch combinations filter supply, and stale writes fail', async () => {
      for (const [ride, courier] of [[true, false], [false, true], [false, false], [true, true]]) {
        await preferences(both, ride, courier);
        assert.equal((await services.eligibleServiceDriverIds([both], 'ride')).has(both), ride);
        assert.equal((await services.eligibleServiceDriverIds([both], 'courier')).has(both), courier);
      }
      await assert.rejects(inTransaction(client => services.setServicePreferences(both, { acceptsRide: true, acceptsCourier: true, expectedVersion: 0 }, client)), { code: 'service_settings_changed' });
      await assert.rejects(preferences(courierCar, true, true), { code: 'service_not_approved' });
    });

    await t.test('second-service review cannot remove the first service', async () => {
      await apply(rides, ['courier'], 'car');
      assert.equal((await settings(rides)).services.ride.enabled, true);
      assert.equal((await services.eligibleServiceDriverIds([rides], 'ride')).has(rides), true);
      await review(rides, { courier: 'rejected' });
      assert.equal((await settings(rides)).services.ride.status, 'approved');
      assert.equal((await settings(rides)).services.courier.status, 'rejected');
      await apply(rides, ['courier'], 'car');
      await review(rides, { courier: 'approved' });
      assert.equal((await settings(rides)).services.courier.enabled, true);
    });

    await t.test('partial approval respects a preference turned off before review', async () => {
      const partner=await makePartner(['ride','courier'],'car',false);
      await preferences(partner,false,false);
      await review(partner,{ride:'approved',courier:'rejected'});
      const value=await settings(partner);
      assert.equal(value.services.ride.status,'approved');
      assert.equal(value.services.ride.enabled,false);
      assert.equal(value.services.courier.status,'rejected');
    });

    await t.test('suspension affects only its service; restoring approval does not turn it on', async () => {
      await review(rides,{courier:'suspended'});
      assert.equal((await services.eligibleServiceDriverIds([rides],'ride')).has(rides),true);
      assert.equal((await services.eligibleServiceDriverIds([rides],'courier')).has(rides),false);
      await review(rides,{courier:'approved'});
      assert.equal((await settings(rides)).services.courier.enabled,false);
    });

    await t.test('driver cannot accept a passenger offer using a courier-only account', async () => {
      const trip = await makeTrip('ride', courierBike);
      await assert.rejects(acceptTrip(courierBike, trip), { code: 'driver_service_unavailable' });
      assert.equal((await db.query('SELECT status FROM trips WHERE id=$1', [trip])).rows[0].status, 'searching');
    });

    await t.test('preference changes invalidate stale offers and recovered offers', async () => {
      const trip = await makeTrip('courier', both);
      await preferences(both, true, false);
      assert.equal(await getCurrentOffer(both), null);
      await assert.rejects(acceptTrip(both, trip), { code: 'driver_service_unavailable' });
      await services.refreshServiceAvailability(both);
      assert.equal((await db.query('SELECT status FROM trip_offers WHERE trip_id=$1', [trip])).rows[0].status, 'rescinded');
      await preferences(both, true, true);
    });

    await t.test('concurrent passenger and courier acceptance produce one active job', async () => {
      const rideTrip = await makeTrip('ride', both);
      const courierTrip = await makeTrip('courier', both);
      const results = await Promise.allSettled([acceptTrip(both, rideTrip), acceptTrip(both, courierTrip)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const active = (await db.query("SELECT id FROM trips WHERE driver_id=$1 AND status='driver_assigned'", [both])).rows;
      assert.equal(active.length, 1);
      await preferences(both, false, false);
      assert.equal((await db.query('SELECT status FROM trips WHERE id=$1', [active[0].id])).rows[0].status, 'driver_assigned');
      await db.query("UPDATE trips SET status='cancelled' WHERE driver_id=$1", [both]);
      await redis.del(`driver:${both}:onTrip`);
      await preferences(both, true, true);
    });

    await t.test('acceptance waits for a preference transaction and reads its committed state', async () => {
      const trip = await makeTrip('courier', both);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const profile = await services.lockServiceProfile(both, client);
        const attempt = acceptTrip(both, trip);
        const rejected = assert.rejects(attempt, { code: 'driver_service_unavailable' });
        await services.setServicePreferences(both, { acceptsRide: true, acceptsCourier: false, expectedVersion: profile.service_settings_version }, client);
        await client.query('COMMIT');
        await rejected;
      } finally { await client.query('ROLLBACK'); client.release(); }
      await preferences(both, true, true);
    });

    await t.test('consent withdrawal retains history and requires explicit re-enrollment', async () => {
      const before = await settings(courierCar);
      await inTransaction(client => services.withdrawServiceConsent(courierCar, 'courier', before.version, client));
      assert.equal((await services.eligibleServiceDriverIds([courierCar], 'courier')).size, 0);
      await assert.rejects(preferences(courierCar, false, true), { code: 'service_not_approved' });
      await assert.rejects(db.query("UPDATE driver_profiles SET service_consent_history='[]' WHERE user_id=$1", [courierCar]), /append_only/);
      await apply(courierCar, ['courier'], 'car');
      await preferences(courierCar, false, true);
      assert.equal((await services.eligibleServiceDriverIds([courierCar], 'courier')).has(courierCar), true);
    });

    await t.test('legacy motorcycle declaration stops passenger work pending staff classification', async () => {
      await apply(legacy,['courier'],'motorcycle');
      assert.equal((await services.eligibleServiceDriverIds([legacy],'ride')).size,0);
      assert.equal((await settings(legacy)).vehicleCategory,null);
      assert.equal((await settings(legacy)).services.courier.status,'pending');
    });

    await t.test('offline, inactive and financially blocked partners are excluded', async () => {
      await redis.del(`driver:${courierBike}:status`);
      assert.equal((await findNearbyDrivers(point.latitude,point.longitude,5,'courier')).some(item=>item.driverId===courierBike),false);
      await saveDriverLocation({driverId:courierBike,...point,timestamp:Date.now()});
      await db.query('UPDATE users SET is_active=false WHERE id=$1',[courierBike]);
      assert.equal((await services.eligibleServiceDriverIds([courierBike],'courier')).size,0);
      await db.query('UPDATE users SET is_active=true WHERE id=$1',[courierBike]);
      const {getOrCreateEarningsAccount}=await import('../payments/ledger.service.js');
      const account=await inTransaction(client=>getOrCreateEarningsAccount(client,courierBike));
      await db.query('UPDATE ledger_accounts SET is_frozen=true WHERE id=$1',[account]);
      assert.equal((await services.eligibleServiceDriverIds([courierBike],'courier')).size,0);
      await db.query('UPDATE ledger_accounts SET is_frozen=false WHERE id=$1',[account]);
    });

    await t.test('dispatch and a settings save complete without deadlock', async () => {
      const trip = await makeTrip('courier');
      const result = await Promise.allSettled([dispatchNext(trip, 0), preferences(both, false, false)]);
      assert.ok(result.every(item => item.status === 'fulfilled'));
      assert.equal((await services.eligibleServiceDriverIds([both], 'courier')).size, 0);
    });
  } finally {
    const { stopTripWorkers } = await import('../trips/tripQueue.js');
    const { stopNotificationWorkers } = await import('../notifications/notificationQueue.js');
    const { stopPaymentWorkers } = await import('../payments/paymentQueue.js');
    await Promise.all([stopTripWorkers(), stopNotificationWorkers(), stopPaymentWorkers()]);
    for (const id of partners) {
      await redis.zrem('drivers:locations', id);
      await redis.del(`driver:${id}:status`, `driver:${id}:location`, `driver:${id}:onTrip`, `driver:offer:${id}`);
      await rm(resolve('.private-uploads/driver-documents', id), { recursive: true, force: true });
    }
    await redis.quit();
    await db.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`); await owner.end();
  }
});
