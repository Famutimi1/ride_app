import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EmailPayload, EmailTemplate } from '../src/modules/notifications/email.types';

interface Design {file:string;label:string;group:string;description:string;template:EmailTemplate;payload?:Partial<EmailPayload>}
const designs:Design[]=[
  {file:'welcome_rider',label:'Rider welcome',group:'Welcome',description:'A warm introduction after rider registration.',template:'welcome_rider'},
  {file:'welcome_driver',label:'Driver welcome',group:'Welcome',description:'Registration confirmation and application next steps.',template:'welcome_driver'},
  {file:'admin_rider_signup',label:'New rider alert',group:'Admin',description:'Notify administrators when a rider completes registration.',template:'admin_signup',payload:{accountType:'rider',dashboardPath:'/admin/riders/00000000-0000-4000-8000-000000000000'}},
  {file:'admin_signup',label:'New driver alert',group:'Admin',description:'A new driver signup, before application approval.',template:'admin_signup',payload:{accountType:'driver',dashboardPath:'/admin/drivers/00000000-0000-4000-8000-000000000000'}},
  {file:'application_received',label:'Application received',group:'Driver applications',description:'Reassure the applicant that their submission was received.',template:'application_received'},
  {file:'admin_application',label:'Application review alert',group:'Admin',description:'Direct administrators to an application ready for review.',template:'admin_application',payload:{dashboardPath:'/admin/applications/00000000-0000-4000-8000-000000000000'}},
  {file:'application_approved',label:'Application approved',group:'Driver applications',description:'Celebrate approval and explain which services are available.',template:'application_reviewed',payload:{services:[{name:'Passenger rides',status:'approved'},{name:'Courier deliveries',status:'approved'}]}},
  {file:'application_rejected',label:'Application needs attention',group:'Driver applications',description:'A clear decision and a route to next steps without private staff notes.',template:'application_reviewed',payload:{services:[{name:'Passenger rides',status:'rejected'},{name:'Courier deliveries',status:'rejected'}]}},
  {file:'application_reviewed',label:'Mixed service decision',group:'Driver applications',description:'Show independent decisions when one service is still pending.',template:'application_reviewed',payload:{services:[{name:'Passenger rides',status:'approved'},{name:'Courier deliveries',status:'pending'}]}},
  {file:'application_suspended',label:'Service suspended',group:'Driver applications',description:'Explain service availability with explicit labels and meaningful colors.',template:'application_reviewed',payload:{services:[{name:'Passenger rides',status:'suspended'},{name:'Courier deliveries',status:'approved'}]}},
  {file:'activity_update',label:'Wallet update',group:'Account activity',description:'A brief confirmation with financial details kept inside the app.',template:'activity_update',payload:{heading:'Your Rakky Ride top-up is confirmed',message:'Your top-up has been confirmed. Open your wallet in the app for the amount and receipt.',appPath:'/account/payment',reference:'PREVIEW-ONLY-001'}},
  {file:'trip_receipt_ready',label:'Trip receipt ready',group:'Account activity',description:'Guide the customer to their completed trip receipt.',template:'activity_update',payload:{heading:'Your Rakky Ride trip receipt is ready',message:'Your trip has been completed. Open Rakky Ride for the final fare, payment method and receipt.',appPath:'/account/trips'}},
  {file:'support_update',label:'Support case update',group:'Account activity',description:'A private support notification with a clear route back to the app.',template:'activity_update',payload:{heading:'Your Rakky Ride support case has an update',message:'Your support case was received or updated. Open support in the app to review the current status.',appPath:'/account/support'}},
  {file:'test',label:'Delivery test',group:'Admin',description:'An administrative test for checking the sending configuration.',template:'test',payload:{dashboardPath:'/admin/emails'}},
];

async function main(){
  // Preview-only fixture links. This script never sends email or changes .env.
  Object.assign(process.env,{EMAIL_ENABLED:'false',EMAIL_DASHBOARD_URL:'https://dashboard.example.test',EMAIL_REPLY_TO:'support@example.test',EMAIL_LOGO_URL:''});
  const {renderEmail,escapeEmailHtml:e}=await import('../src/modules/notifications/emailTemplates.js');
  const {default:brand}=await import('../src/modules/notifications/emailBrand.generated.json',{with:{type:'json'}});
  const c=brand.colors;
  const directories=[resolve('../email-templates'),resolve('docs/email-previews')];
  const catalogue=designs.map(design=>{
    const payload:EmailPayload={name:'Ada',userId:'00000000-0000-4000-8000-000000000000',accountType:'rider',occurredAt:'2026-10-17T09:00:00+01:00',...design.payload};
    const email=renderEmail(design.template,payload);
    return {...design,subject:email.subject,email};
  });
  const nav=[...new Set(designs.map(design=>design.group))].map(group=>`<section><h2>${e(group)}</h2>${catalogue.filter(design=>design.group===group).map(design=>`<button class="design" data-design="${design.file}" type="button"><span>${e(design.label)}</span><small>${e(design.template.replaceAll('_',' '))}</small></button>`).join('')}</section>`).join('');
  const controls=`
const designs=JSON.parse(document.getElementById('design-data').textContent);
const frame=document.getElementById('email-frame');
function selectDesign(id){
  const item=designs.find(item=>item.file===id)||designs[0];
  document.querySelectorAll('[data-design]').forEach(button=>button.setAttribute('aria-current',String(button.dataset.design===item.file)));
  frame.src=item.file+'.html';frame.title=item.label+' HTML email';
  document.getElementById('design-title').textContent=item.label;
  document.getElementById('design-description').textContent=item.description;
  document.getElementById('subject').textContent=item.subject;
  document.getElementById('html-link').href=item.file+'.html';
  document.getElementById('text-link').href=item.file+'.txt';
  document.getElementById('file-name').textContent=item.file+'.html';
}
document.querySelectorAll('[data-design]').forEach(button=>button.addEventListener('click',()=>{location.hash=button.dataset.design;}));
window.addEventListener('hashchange',()=>selectDesign(location.hash.slice(1)));
document.querySelectorAll('[data-width]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-width]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  document.getElementById('preview').dataset.mode=button.dataset.width;
}));
selectDesign(location.hash.slice(1));`;
  const index=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rakky Ride · Email design library</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:${c.text};background:${c.surfaceMuted}}button,a{font:inherit}a{color:${c.primary}}button{cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid ${c.primary};outline-offset:3px}header{padding:18px 28px;border-bottom:1px solid ${c.border};display:flex;align-items:center;justify-content:space-between;gap:20px;background:${c.surface}}.brand{display:flex;align-items:center;gap:10px}.brand img{width:58px;height:58px}.brand strong{display:block;font-size:18px;color:${c.primary}}.brand small{display:block;margin-top:5px;font-size:12px;color:${c.textMuted}}.pill{font-size:12px;border:1px solid ${c.border};border-radius:99px;padding:8px 12px;color:${c.textMuted}}.layout{display:grid;grid-template-columns:258px minmax(0,1fr);min-height:calc(100vh - 95px)}aside{padding:26px 16px;border-right:1px solid ${c.border};background:${c.surface}}aside h2{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${c.textMuted};margin:0 12px 10px}aside section+section{margin-top:24px}.design{display:block;width:100%;text-align:left;padding:12px;border:0;border-radius:8px;background:transparent;color:${c.text};margin-bottom:4px}.design span{display:block;font-weight:600;font-size:13px}.design small{display:block;font-size:10px;margin-top:5px;color:${c.textMuted}}.design:hover{background:${c.surfaceMuted}}.design[aria-current=true]{background:${c.primarySoft};color:${c.primary}}main{min-width:0;padding:30px 36px}.eyebrow{margin:0 0 10px;color:${c.primary};font-weight:bold;font-size:10px;letter-spacing:1.8px}h1{margin:0 0 10px;font-size:28px;letter-spacing:-.6px}.intro{color:${c.textMuted};font-size:13px;line-height:1.7;margin:0;max-width:650px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;padding:22px 0 18px}.tabs{display:flex;padding:4px;background:${c.border};border-radius:8px;gap:3px}.tabs button{border:0;background:transparent;border-radius:6px;font-size:12px;padding:8px 12px;color:${c.textMuted}}.tabs button[aria-pressed=true]{background:${c.surface};color:${c.text};font-weight:bold}.actions{display:flex;gap:16px;font-size:12px}.subject{display:flex;gap:12px;align-items:baseline;background:${c.surface};border:1px solid ${c.border};border-radius:10px 10px 0 0;padding:15px 20px;line-height:1.5;font-size:13px}.subject span{color:${c.textMuted};font-size:11px;flex-shrink:0}.stage{padding:24px;background:${c.border};border:1px solid ${c.border};border-top:0;border-radius:0 0 10px 10px}.preview{width:100%;max-width:660px;margin:auto;transition:max-width .15s}.preview[data-mode=mobile]{max-width:375px}iframe{width:100%;height:1100px;display:block;border:0;background:${c.surfaceMuted};border-radius:8px}.footnote{color:${c.textMuted};font-size:11px;line-height:1.8;margin:16px 0}.editing{margin-top:26px;padding-top:22px;border-top:1px solid ${c.border}}.editing h2{font-size:14px;margin:0 0 8px}.editing p{font-size:12px;line-height:1.8;color:${c.textMuted};margin:0}.editing code{font-size:11px;overflow-wrap:anywhere}
@media(max-width:900px){header{padding:14px 18px}.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid ${c.border};padding:12px;display:flex;gap:14px;overflow:auto}aside section{display:flex;gap:6px;flex-shrink:0}aside h2{display:none}aside section+section{margin-top:0}.design{width:178px;margin:0}.design small{white-space:nowrap}main{padding:24px 16px}.stage{padding:8px}.subject{padding:12px}.pill{font-size:10px}.brand strong{font-size:16px}h1{font-size:24px}}@media(prefers-reduced-motion:reduce){.preview{transition:none}}
</style></head><body>
<header><div class="brand"><img src="assets/rakky-ride-logo.png" alt="Rakky Ride"><div><strong>Rakky Ride</strong><small>Email design library</small></div></div><span class="pill">${catalogue.length} designs · HTML + plain text</span></header>
<div class="layout"><aside aria-label="Email designs">${nav}</aside><main>
<p class="eyebrow">TRANSACTIONAL EMAIL</p><h1 id="design-title">Rider welcome</h1><p class="intro" id="design-description">A warm introduction after rider registration.</p>
<div class="toolbar"><div class="tabs" role="group" aria-label="Preview width"><button data-width="desktop" aria-pressed="true" type="button">Desktop</button><button data-width="mobile" aria-pressed="false" type="button">Mobile · 375px</button></div><div class="actions"><a id="html-link" href="welcome_rider.html" target="_blank" rel="noopener">Open HTML design ↗</a><a id="text-link" href="welcome_rider.txt" target="_blank" rel="noopener">Plain-text fallback</a></div></div>
<div class="subject"><span>Subject</span><strong id="subject">Welcome to Rakky Ride, Ada</strong></div><div class="stage"><div id="preview" class="preview" data-mode="desktop"><iframe id="email-frame" src="welcome_rider.html" title="Rider welcome HTML email" sandbox=""></iframe></div></div>
<p class="footnote">Reviewing <strong id="file-name">welcome_rider.html</strong> · Uses sample customer data and example.test links. No email is sent. Email links are disabled inside this preview.</p>
<div class="editing"><h2>Change a design later</h2><p>Each design has a readable .html file and a matching .txt fallback in this folder. See <a href="README.md">README.md</a> for the editing guide. Live emails are generated from <code>backend/src/modules/notifications/emailTemplates.ts</code>; after changing that source, run <code>cd backend &amp;&amp; npm run preview:emails</code> to refresh this library.</p></div>
</main></div><script id="design-data" type="application/json">${JSON.stringify(catalogue.map(({email:_email,...item})=>item)).replaceAll('<','\\u003c')}</script><script>${controls}</script></body></html>`;
  const readme=`# Rakky Ride email templates

Open **index.html** in a browser to review the HTML designs. Choose a design in the sidebar and switch between Desktop and Mobile previews. Use **Open HTML design** to see the complete email by itself. Plain-text fallback is the alternate version used by mail clients that cannot show HTML.

## Folder contents

- index.html — visual review gallery.
- *.html — readable HTML review copies: welcomes, admin signup alerts, application receipt, approval, rejection, mixed decisions, suspension, account updates and delivery test.
- *.txt — matching plain-text alternatives.
- assets/rakky-ride-logo.png — unchanged canonical brand logo, shared by all previews.

## Changing emails that the app sends

1. Edit text, layout, buttons or logo placement in **../backend/src/modules/notifications/emailTemplates.ts**.
2. Colors come from **../mobile/src/constants/colors.ts**. After changing that palette, run **npm run sync:email-brand** from backend.
3. Run **npm run preview:emails** from backend to regenerate this folder, then review index.html again.
4. Run **npm run typecheck** from backend and restart/rebuild the backend when deploying changed templates.

You can edit the HTML files here to try a design or annotate a proposed change. Those local edits are review drafts: they do not change live emails, and regenerating the library replaces them. Copy an edited draft to a different filename before regenerating, or ask for its changes to be incorporated into the live template source.

## Links and sending

This gallery works offline and uses the canonical local PNG. Preview buttons use example.test fixture URLs. Production customer buttons use the dashboard's public **/open-app** page, which launches the installed native app. Set **EMAIL_DASHBOARD_URL** in **../backend/.env**; a separate EMAIL_APP_URL is no longer required. The field guide is **../backend/.env.example**. Optional published store links are configured in the separate dashboard's .env.example. No credentials are stored here and opening a preview never sends an email.

See **../docs/features/email-system.md** for configuration and recovery instructions.
`;
  for(const directory of directories){
    await mkdir(resolve(directory,'assets'),{recursive:true});
    await copyFile(resolve('../mobile/assets/images/brand/rakky-ride-logo.png'),resolve(directory,'assets/rakky-ride-logo.png'));
    for(const design of catalogue){
      const html=design.email.html.replace('https://dashboard.example.test/brand/rakky-ride-logo.png','assets/rakky-ride-logo.png').replace(/></g,'>\n<');
      await writeFile(resolve(directory,`${design.file}.html`),html+'\n');
      await writeFile(resolve(directory,`${design.file}.txt`),design.email.text+'\n');
    }
    await writeFile(resolve(directory,'index.html'),index+'\n');
    await writeFile(resolve(directory,'README.md'),directory===directories[0]?readme:'# Email preview compatibility folder\n\nThe main review library and editing guide are in ../../../email-templates/. Open index.html here for the same gallery. Regenerate from backend with npm run preview:emails.\n');
  }
  console.info(`Saved ${catalogue.length} HTML designs and plain-text fallbacks in email-templates/ (and the existing backend preview folder).`);
}
void main().catch(()=>{console.error('Email preview generation failed.');process.exitCode=1;});
