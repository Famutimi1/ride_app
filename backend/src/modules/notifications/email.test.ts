import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { emailAppLink,renderEmail } from './emailTemplates';
import { env } from '../../config/env';
import { verifyEmailWebhook } from './emailWebhook';
import { emailCanRetry, emailRetryWindowMs } from './emailQueue';
import { normalizedEmail } from './email.service';
import brand from './emailBrand.generated.json';
import { emailControlKey } from './emailSettings.service';

test('email tokens are synchronized with the single canonical palette',()=>{
  const source=readFileSync(resolve('../mobile/src/constants/colors.ts'));
  assert.equal(brand.sha256,createHash('sha256').update(source).digest('hex'),'Run npm run sync:email-brand after changing the canonical palette');
  const email=renderEmail('welcome_rider',{name:'Ada'});
  assert.ok(email.html.includes(brand.colors.primary));assert.ok(email.html.includes(brand.colors.textInverse));
  assert.ok(email.html.includes('Rakky Ride logo'));assert.ok(email.text.includes('Ada'));
});

test('templates escape customer content, strip subject controls and accurately describe service decisions',()=>{
  const email=renderEmail('welcome_rider',{name:'<script>alert("test")</script>\r\nBcc: private'});
  assert.ok(!email.html.includes('<script>'));assert.ok(!/[\r\n]/.test(email.subject));
  const mixed=renderEmail('application_reviewed',{name:'Ada',services:[{name:'Passenger rides',status:'approved'},{name:'Courier deliveries',status:'rejected'}]});
  assert.ok(mixed.text.includes('Passenger rides: approved'));assert.ok(mixed.text.includes('Courier deliveries: rejected'));
  assert.notEqual(mixed.subject,'Your Rakky Ride driver application is approved');
  const approved=renderEmail('application_reviewed',{name:'Ada',services:[{name:'Passenger rides',status:'approved'}]});
  assert.equal(approved.subject,'Your Rakky Ride driver application is approved');
});

test('customer links use the public native-app handoff and reject arbitrary destinations',()=>{
  const origin='https://dashboard.example.test';
  assert.equal(emailAppLink('/home',''),null);
  for(const path of ['/home','/driver-onboarding','/driver-status','/driver-dashboard','/account/trips','/account/driver-trips','/account/payment','/account/driver-wallet','/account/support']){
    const link=new URL(emailAppLink(path,origin)!);
    assert.equal(link.origin,origin);
    assert.equal(link.pathname,'/open-app');assert.equal(link.searchParams.get('path'),path);
  }
  for(const path of ['https://evil.test','//evil.test','/admin','/account/support?token=private'])assert.equal(new URL(emailAppLink(path,origin)!).searchParams.get('path'),'/home');
  if(!env.EMAIL_DASHBOARD_URL)return;
  const rider=renderEmail('welcome_rider',{name:'Ada'});
  assert.ok(rider.text.includes(emailAppLink('/home')!));
  const driver=renderEmail('welcome_driver',{name:'Ada'});
  assert.ok(driver.text.includes(emailAppLink('/driver-onboarding')!));
  const admin=renderEmail('admin_application',{name:'Ada',dashboardPath:'/admin/applications/fixture'});
  assert.ok(admin.text.includes(new URL('/admin/applications/fixture',env.EMAIL_DASHBOARD_URL).toString()));
});

test('webhook verification matches the official Svix manual-verification vector',()=>{
  const payload=Buffer.from('{"event_type":"ping","data":{"success":true}}');
  const headers={id:'msg_loFOjxBNrRLzqYUf',timestamp:'1731705121',signature:'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='};
  const secret='whsec_plJ3nmyCDGBKInavdOK15jsl';
  assert.doesNotThrow(()=>verifyEmailWebhook(payload,headers,secret,1731705121000));
  assert.throws(()=>verifyEmailWebhook(Buffer.from('changed'),headers,secret,1731705121000));
  assert.throws(()=>verifyEmailWebhook(payload,headers,secret,1731705121000+301000));
  assert.throws(()=>verifyEmailWebhook(payload,headers,secret,1731705121000-301000));
  assert.doesNotThrow(()=>verifyEmailWebhook(payload,{...headers,signature:`v2,unknown v1,invalid ${headers.signature}`},secret,1731705121000));
});

test('retry eligibility never includes accepted, delivered, suppressed or uncertain outcomes',()=>{
  const now=Date.now();
  assert.equal(emailCanRetry({status:'failed',retryable:true,first_attempt_at:new Date(now-1000)},now),true);
  assert.equal(emailCanRetry({status:'failed',retryable:true,first_attempt_at:new Date(now-emailRetryWindowMs)},now),false);
  for(const status of ['accepted','delivered','bounced','complained','suppressed','uncertain','sending'] as const)assert.equal(emailCanRetry({status,retryable:true,first_attempt_at:null}),false);
  assert.equal(emailCanRetry({status:'failed',retryable:false,first_attempt_at:null}),false);
});

test('contact email is optional, normalized and rejects malformed/header-injection values',()=>{
  assert.equal(normalizedEmail(undefined),null);assert.equal(normalizedEmail(' ADA@example.test '),'ada@example.test');
  for(const value of ['invalid','a@example.test\r\nBcc:x@example.test','<a>@example.test',42,'a'.repeat(170)+'@example.test'])assert.throws(()=>normalizedEmail(value));
});

test('email controls distinguish approvals, mixed outcomes, support, receipts and financial updates',()=>{
  assert.equal(emailControlKey('application_reviewed',{name:'Ada',services:[{name:'Ride',status:'approved'}]}),'driver_approved');
  assert.equal(emailControlKey('application_reviewed',{name:'Ada',services:[{name:'Ride',status:'rejected'}]}),'driver_rejected');
  assert.equal(emailControlKey('application_reviewed',{name:'Ada',services:[{name:'Ride',status:'approved'},{name:'Courier',status:'suspended'}]}),'driver_service_updates');
  for(const [appPath,key] of [['/account/support','support_updates'],['/account/trips','trip_receipts'],['/account/driver-trips','trip_receipts'],['/account/driver-wallet','withdrawal_updates'],['/account/payment','wallet_updates']])assert.equal(emailControlKey('activity_update',{name:'Ada',appPath}),key);
});
