import { env } from '../../config/env';
import type { EmailPayload, EmailTemplate } from './email.types';
import brand from './emailBrand.generated.json';

const appDestinations=new Set(['/home','/driver-onboarding','/driver-status','/driver-dashboard','/account/trips','/account/driver-trips','/account/payment','/account/driver-wallet','/account/support']);

/** HTTPS links survive mail clients; the public dashboard page opens the native app. */
export function emailAppLink(path='/home',dashboardUrl=env.EMAIL_DASHBOARD_URL):string|null {
  if(!dashboardUrl)return null;
  const link=new URL('/open-app',dashboardUrl);
  link.searchParams.set('path',appDestinations.has(path)?path:'/home');
  return link.toString();
}

export function escapeEmailHtml(value:string):string {
  return value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
}

export function renderEmail(template:EmailTemplate,payload:EmailPayload):{subject:string;text:string;html:string} {
  const firstName=payload.name.trim().split(/\s+/)[0]||'there';
  let subject:string;
  let paragraphs:string[];
  switch(template){
    case 'welcome_rider':
      subject=`Welcome to Rakky Ride, ${firstName}`;
      paragraphs=[`Hi ${firstName}, your Rakky Ride account is ready.`, 'Choose a pickup and destination in the app to book your first ride. You can manage your trips and find support from your account.'];
      break;
    case 'welcome_driver':
      subject='Welcome to Rakky Ride — complete your driver application';
      paragraphs=[`Hi ${firstName}, your account has been created.`, 'To apply to drive, complete your personal and vehicle details, upload your licence, vehicle registration and insurance, choose your services, and submit your application in the app.', 'Registration does not grant driver approval. We will email you when your application is reviewed.'];
      break;
    case 'admin_signup':
      subject=`New ${payload.accountType==='driver'?'driver':'rider'} signup: ${payload.name}`;
      paragraphs=[`${payload.name} completed registration as a ${payload.accountType??'rider'}.`, `Account: ${payload.userId}`, `Registered: ${new Date(payload.occurredAt!).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})} (Lagos)`, 'A driver signup is not an approved driver application.'];
      break;
    case 'application_received':
      subject='We received your driver application';
      paragraphs=[`Hi ${firstName}, we received your Rakky Ride driver application.`, 'Our team will review your submitted details and documents. Check your application status in the app; we will notify you when a decision is available.'];
      break;
    case 'admin_application':
      subject=`Driver application ready for review: ${payload.name}`;
      paragraphs=[`${payload.name} submitted a driver application.`, `Account: ${payload.userId}`, 'Open the dashboard to review the documents and requested services.'];
      break;
    case 'application_reviewed': {
      const services=payload.services??[];
      const allApproved=services.length>0&&services.every(service=>service.status==='approved');
      subject=allApproved?'Your Rakky Ride driver application is approved':'An update on your Rakky Ride driver application';
      paragraphs=[`Hi ${firstName}, your driver services have been reviewed.`, ...services.map(service=>`${service.name}: ${service.status.replaceAll('_',' ')}.`),
        services.some(service=>service.status==='approved')?'Open your driver dashboard to see your approved services. Choose which requests to receive; restoring approval does not automatically switch requests on.':'Open your application in Rakky Ride to review the decision and available next steps.',
        'Only approved and enabled services can receive new requests. Contact support in the app if you need help.'];
      break;
    }
    case 'activity_update':
      subject=payload.heading??'Your Rakky Ride account has an update';
      paragraphs=[`Hi ${firstName},`,payload.message??'Open Rakky Ride to review your latest account activity.',...(payload.reference?[`Reference: ${payload.reference}`]:[]), 'For your privacy, financial details, private messages and documents are available only inside your authenticated app.'];
      break;
    case 'test':
      subject='Rakky Ride email delivery test';
      paragraphs=['This is an administrative delivery test from Rakky Ride.','Receiving this email confirms the sending configuration works for this mailbox.'];
      break;
  }
  subject=subject.replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,240);
  const admin=template==='admin_signup'||template==='admin_application'||template==='test';
  const dashboardLink=env.EMAIL_DASHBOARD_URL?new URL(payload.dashboardPath??'/admin/emails',env.EMAIL_DASHBOARD_URL).toString():null;
  const appPath=payload.appPath??(template==='welcome_driver'?'/driver-onboarding':template==='application_received'?'/driver-status':template==='application_reviewed'?(payload.services?.some(service=>service.status==='approved')?'/driver-dashboard':'/driver-status'):'/home');
  const appLink=emailAppLink(appPath);
  const actionLink=admin?dashboardLink:appLink;
  const actionLabel=admin?(template==='admin_application'?'Review application':template==='test'?'View email dashboard':'View account'):template==='welcome_driver'?'Complete your application':template==='welcome_rider'?'Book your first ride':template==='application_received'?'View application status':template==='application_reviewed'?'View your driver services':'Open Rakky Ride';
  const supportLink=env.EMAIL_REPLY_TO?`mailto:${env.EMAIL_REPLY_TO}`:emailAppLink('/account/support');
  const logo=env.EMAIL_LOGO_URL||(env.EMAIL_DASHBOARD_URL?new URL('/brand/rakky-ride-logo.png',env.EMAIL_DASHBOARD_URL).toString():'/brand/rakky-ride-logo.png');
  const c=brand.colors;
  const e=escapeEmailHtml;
  const approved=template==='application_reviewed'&&payload.services?.some(service=>service.status==='approved');
  const label=admin?'ADMIN NOTIFICATION':template.startsWith('welcome')?'WELCOME TO RAKKY RIDE':template==='application_received'?'APPLICATION RECEIVED':approved?'DRIVER APPLICATION UPDATE':'YOUR RAKKY RIDE ACCOUNT';
  const title=template==='welcome_rider'?'Your next ride starts here.':template==='welcome_driver'?'Your journey as a driver starts here.':template==='application_received'?'Application received.':template==='application_reviewed'?(payload.services?.every(service=>service.status==='approved')?'You’re approved.':'Your service review is ready.'):subject;
  const serviceRows=payload.services?.map(service=>{
    const tone=service.status==='approved'?'success':service.status==='pending'?'warning':'danger';
    return `<tr><td style="padding:14px 16px;border-bottom:1px solid ${c.border};font-size:14px;">${e(service.name)}</td><td align="right" style="padding:14px 16px;border-bottom:1px solid ${c.border};font-size:13px;font-weight:bold;color:${c[tone]};">${e(service.status.toUpperCase())}</td></tr>`;
  }).join('')??'';
  const displayParagraphs=payload.services?paragraphs.filter(paragraph=>!payload.services!.some(service=>paragraph===`${service.name}: ${service.status.replaceAll('_',' ')}.`)):paragraphs;
  const text=[...paragraphs,...(actionLink?[`${actionLabel}: ${actionLink}`]:[]),...(supportLink?[`Need help? ${supportLink}`]:[]),'Rakky Ride · Lagos, Nigeria','This is an automatic account notification.'].join('\n\n');
  // Tables, inline styles, system fonts and a real PNG work across Gmail,
  // Outlook and mobile clients. The text brand remains visible if images are blocked.
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background-color:${c.surfaceMuted};font-family:Arial,Helvetica,sans-serif;color:${c.text};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(paragraphs[0])}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${c.surfaceMuted};"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:${c.surface};border:1px solid ${c.border};border-radius:16px;">
<tr><td style="height:6px;background-color:${c.primary};border-radius:16px 16px 0 0;font-size:1px;line-height:6px;">&nbsp;</td></tr>
<tr><td style="padding:20px 28px;border-bottom:1px solid ${c.border};"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="${e(logo)}" alt="Rakky Ride logo" width="76" height="76" style="display:block;border:0;"></td><td style="padding-left:8px;"><strong style="font-size:20px;color:${c.primary};">Rakky Ride</strong><br><span style="font-size:12px;color:${c.textMuted};">Your journey, made simple.</span></td></tr></table></td></tr>
<tr><td style="padding:32px 28px 12px;"><p style="margin:0 0 12px;font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${c.primary};">${label}</p><h1 style="margin:0 0 24px;font-size:28px;line-height:1.25;color:${c.text};">${e(title)}</h1>
${displayParagraphs.map(paragraph=>`<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:${c.textMuted};">${e(paragraph)}</p>`).join('')}
${serviceRows?`<table width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background-color:${c.surfaceMuted};border:1px solid ${c.border};border-radius:8px;">${serviceRows}</table>`:''}
${actionLink?`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 16px;"><tr><td style="background-color:${c.primary};border-radius:8px;"><a href="${e(actionLink)}" style="display:inline-block;padding:15px 22px;font-size:14px;font-weight:bold;color:${c.textInverse};text-decoration:none;">${e(actionLabel)} &rarr;</a></td></tr></table><p style="font-size:11px;line-height:1.6;color:${c.textMuted};word-break:break-all;">If the button does not work, open:<br><a href="${e(actionLink)}" style="color:${c.primary};">${e(actionLink)}</a></p>`:''}
</td></tr><tr><td style="padding:20px 28px 28px;border-top:1px solid ${c.border};"><p style="margin:0;font-size:13px;line-height:1.6;color:${c.textMuted};">Need a hand? ${supportLink?`<a href="${e(supportLink)}" style="color:${c.primary};font-weight:bold;">Contact support</a>`:'Find support in the Rakky Ride app.'}</p></td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;"><tr><td align="center" style="padding:20px;font-size:11px;line-height:1.8;color:${c.textMuted};">Rakky Ride &middot; Lagos, Nigeria<br>This is an automatic account notification.<br>You received this because of account activity on Rakky Ride.</td></tr></table>
</td></tr></table></body></html>`;
  return {subject,text,html};
}
