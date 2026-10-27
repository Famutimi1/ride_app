import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => unknown); props: Props }
const localRequire = createRequire(resolve('package.json'));
const ts = localRequire('typescript') as typeof import('typescript');
const jsx = (type: Element['type'], props: Props): Element => ({type,props});
function load<T>(file: string, mocks: Props = {}, globals: Props = {}): T {
  const exports: Props = {};
  const {outputText} = ts.transpileModule(readFileSync(resolve('src',file),'utf8'), {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
  runInNewContext(outputText,{exports,Error,Promise,setTimeout,clearTimeout,...globals,require:(name:string)=>{
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name in mocks)return mocks[name];
    if(name==='zustand')return localRequire(name);
    throw new Error(`Unexpected dependency ${name}`);
  }});
  return exports as T;
}
const policy=load<typeof import('../src/utils/userMessage')>('utils/userMessage.ts');
const {userErrorMessage,safeMessage,UserFacingError,DEFAULT_ERROR_MESSAGE}=policy;
const api=(status:number,error:unknown,details:Props={})=>({isAxiosError:true,response:{status,data:{error,...details}}});
for(const secret of ['duplicate key value violates unique constraint users_phone_key','relation "users" does not exist','SELECT password FROM users','{"error":"database is down"}','new_unknown_code','<html>Bad gateway</html>']){
  test(`untrusted server failure is hidden: ${secret.slice(0,25)}`,()=>{
    assert.equal(userErrorMessage(api(500,secret)),'The service is temporarily unavailable. Please try again shortly.');
    assert.equal(userErrorMessage(api(400,secret)),DEFAULT_ERROR_MESSAGE);
    assert.equal(userErrorMessage(new Error(secret)),DEFAULT_ERROR_MESSAGE);
  });
}
test('specific actionable errors survive while unknown codes never become labels',()=>{
  assert.match(userErrorMessage(api(400,'otp_invalid')),/code isn’t correct/);
  assert.match(userErrorMessage(api(409,'insufficient_funds')),/Top up/);
  assert.match(userErrorMessage(api(409,'driver_account_required')),/driver registration/);
  assert.match(userErrorMessage(api(409,'invalid_delivery_code')),/recipient/);
  assert.equal(userErrorMessage(api(400,'postgres_new_code')),DEFAULT_ERROR_MESSAGE);
});
test('network, timeout, unauthenticated and rate-limited requests have recovery copy',()=>{
  assert.match(userErrorMessage({isAxiosError:true,code:'ERR_NETWORK'}),/internet connection/);
  assert.match(userErrorMessage({code:'ECONNABORTED'}),/Check the latest status/);
  assert.match(userErrorMessage(api(401,'unknown')),/sign in again/);
  assert.match(userErrorMessage(api(429,'unknown')),/Wait a moment/);
});
test('OTP cooldown validates and bounds untrusted duration',()=>{
  assert.match(userErrorMessage(api(429,'otp_cooldown',{retryAfterSeconds:24.2})),/25 seconds/);
  for(const duration of [NaN,Infinity,'SQLSTATE 23505',{}])assert.match(userErrorMessage(api(429,'otp_cooldown',{retryAfterSeconds:duration})),/60 seconds/);
  assert.match(userErrorMessage(api(429,'otp_cooldown',{retryAfterSeconds:-5})),/1 seconds/);
});
test('public copy survives catch boundaries but SQL in view props is rejected',()=>{
  assert.equal(userErrorMessage(new UserFacingError('Choose a photo smaller than 5 MB.')),'Choose a photo smaller than 5 MB.');
  assert.equal(safeMessage('column driver_id does not exist'),DEFAULT_ERROR_MESSAGE);
  assert.equal(safeMessage('{"error":"private"}'),DEFAULT_ERROR_MESSAGE);
  assert.equal(safeMessage('internal_server_error'),DEFAULT_ERROR_MESSAGE);
});
const feedbackModule=load<typeof import('../src/store/feedbackStore')>('store/feedbackStore.ts',{'@/utils/userMessage':policy});
const {feedback,useFeedbackStore,closeConfirmation,dismissToast,clearFeedback}=feedbackModule;
test('confirmation only resolves positively after an explicit confirmation',async()=>{
  const decision=feedback.confirm({title:'Cancel ride?',message:'Your driver will be notified.',cancelLabel:'Keep ride'});
  assert.ok(useFeedbackStore.getState().dialog);
  const duplicate=await feedback.confirm({title:'Duplicate',message:'Should not replace the first decision.'});
  assert.equal(duplicate,false);
  closeConfirmation(false);
  assert.equal(await decision,false);
  const confirmed=feedback.confirm({title:'Cancel ride?',message:'Your driver will be notified.'});
  closeConfirmation(true);
  assert.equal(await confirmed,true);
});
test('old toast timers cannot dismiss a newer message; account cleanup cancels pending decisions',async()=>{
  feedback.success('Saved.');const old=useFeedbackStore.getState().toast!.id;
  feedback.error('Please try again.');dismissToast(old);
  assert.equal(useFeedbackStore.getState().toast?.message,'Please try again.');
  const pending=feedback.confirm({title:'Log out?',message:'Please confirm.'});
  clearFeedback();assert.equal(await pending,false);
  assert.equal(useFeedbackStore.getState().toast,null);
});
function nodes(root:unknown):Element[]{
  if(Array.isArray(root))return root.flatMap(nodes);
  if(!root||typeof root!=='object'||!('props' in root))return [];
  const node=root as Element;
  if(typeof node.type==='function')return nodes(node.type(node.props));
  return [node,...nodes(node.props.children)];
}
const componentMocks={
  'react-native':{View:'View',Pressable:'Pressable',StyleSheet:{create:(value:unknown)=>value}},
  '@/constants/theme':{useTheme:()=>({colors:{danger:'error',dangerSoft:'error-bg',success:'success',successSoft:'success-bg'}})},
  '@/utils/userMessage':policy,'./Text':{Text:'Text'},'./RideIcon':{RideIcon:'Icon'},
};
const {AppMessage}=load<{AppMessage:(props:Props)=>Element}>('components/common/AppMessage.tsx',componentMocks);
test('inline errors announce themselves, retain their retry action and sanitize old props',()=>{
  let retried=false;
  const tree=AppMessage({message:'SELECT password FROM users',actionLabel:'Try again',onAction:()=>{retried=true;}});
  const all=nodes(tree);
  assert.equal(tree.props.accessibilityRole,'alert');
  assert.ok(all.find(node=>node.type==='Text'&&node.props.children===DEFAULT_ERROR_MESSAGE));
  const action=all.find(node=>node.type==='Pressable')!;
  (action.props.onPress as ()=>void)();assert.equal(retried,true);
  assert.equal((AppMessage({message:'Saved.',tone:'success'})).props.accessibilityLiveRegion,'polite');
  assert.equal(AppMessage({message:null}),null);
});
test('fetch errors hide HTML/non-JSON responses and network details',async()=>{
  let status=502;
  const {apiRequest}=load<{apiRequest:(path:string)=>Promise<unknown>}>('services/api.ts',{
    '@/utils/userMessage':policy,'expo-constants':{default:{expoConfig:{}}},'react-native':{Platform:{OS:'web'}},
  },{process:{env:{}},URL,AbortSignal,fetch:async()=>({ok:false,status,json:async()=>{throw new Error('<html>proxy error</html>');}})});
  await assert.rejects(apiRequest('/maps'),error=>error instanceof UserFacingError&&!error.message.includes('html'));
  status=400;
  await assert.rejects(apiRequest('/maps'),error=>error instanceof UserFacingError&&error.message===DEFAULT_ERROR_MESSAGE);
});
