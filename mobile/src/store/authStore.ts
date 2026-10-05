import { create } from 'zustand';
import { apiErrorMessage } from '@/lib/apiClient';
import { tokenStore } from '@/lib/secureTokenStore';
import { getMe, googleAuth, logoutSession, requestLogin, requestRegistration, resendOtp, switchActiveRole, verifyLogin, verifyRegistration, type AuthUser, type UserRole } from '@/services/authService';
import { getGoogleIdToken } from '@/services/googleSignIn';
import { getDriverApplicationStatus, submitDriverApplication as apiSubmitDriverApplication } from '@/services/driverService';
import { resetSocket } from '@/services/socket';
import { useWalletStore } from '@/store/walletStore';

interface Session { user: AuthUser }
export type AuthIntent='register'|'login';
export type RegistrationAccountType='rider'|'driver';
export type DriverApplicationStatus='draft'|'pending'|'approved'|'rejected';
export interface DriverApplication {status:DriverApplicationStatus;submittedAt?:number;rejectionReason?:string;personal:{fullName:string;email:string;address:string};vehicle:{make:string;model:string;year:string;color:string;registrationNumber:string};documents:{driverLicence:string;vehicleRegistration:string;insurance:string}}
export type AuthDestination='home'|'driver-onboarding'|'driver-dashboard'|'driver-status';
interface Pending{phone:string;name?:string;intent:AuthIntent;accountType:RegistrationAccountType;phoneVerificationToken?:string}
interface AuthState{session:Session|null;pending:Pending|null;driverApplication:DriverApplication|null;_hasHydrated:boolean;
  hydrate:()=>Promise<void>;requestOtp:(phone:string,options?:{name?:string;intent?:AuthIntent;accountType?:RegistrationAccountType})=>Promise<void>;verifyOtp:(code:string)=>Promise<{destination:AuthDestination}>;signInWithGoogle:()=>Promise<'phone'|AuthDestination>;signInWithGoogleIdToken:(idToken:string)=>Promise<'phone'|AuthDestination>;completeProfile:(input:{name:string;email?:string;role?:UserRole})=>Promise<void>;setRole:(role:UserRole)=>Promise<boolean>;submitDriverApplication:(application:Omit<DriverApplication,'status'|'submittedAt'|'rejectionReason'>)=>Promise<void>;refreshDriverApplication:()=>Promise<void>;restartDriverApplication:()=>void;updateProfile:(input:Partial<Pick<AuthUser,'name'|'email'|'phone'>>)=>void;logout:()=>Promise<void>;setHydrated:()=>void}
const blankApplication=(user?:AuthUser|null):DriverApplication=>({status:'draft',personal:{fullName:user?.name??'',email:user?.email??'',address:''},vehicle:{make:'',model:'',year:'',color:'',registrationNumber:''},documents:{driverLicence:'',vehicleRegistration:'',insurance:''}});
function applicationFromStatus(status:'none'|'pending'|'approved'|'rejected',user:AuthUser,rejectionReason?:string){const application=blankApplication(user);application.status=status==='none'?'draft':status;application.rejectionReason=rejectionReason;return application;}

export const useAuthStore=create<AuthState>((set,get)=>({session:null,pending:null,driverApplication:null,_hasHydrated:false,
  hydrate:async()=>{try{if(!await tokenStore.getAccessToken())return set({_hasHydrated:true});const data=await getMe();const user={...data.user,role:data.activeRole} as AuthUser;set({session:{user},driverApplication:applicationFromStatus(data.driverStatus,user),_hasHydrated:true});}catch{await tokenStore.clear();set({session:null,driverApplication:null,_hasHydrated:true});}},
  requestOtp:async(phone,options)=>{try{const previous=get().pending;if(!options&&previous){await resendOtp(phone,previous.intent==='register'?'registration':'login');return;}const intent=options?.intent??'login',accountType=options?.accountType??'rider';if(intent==='register')await requestRegistration({fullName:options?.name??'',phone,accountType});else await requestLogin(phone);set({pending:{phone,name:options?.name,intent,accountType,phoneVerificationToken:previous?.phoneVerificationToken}});}catch(error){throw new Error(apiErrorMessage(error));}},
  verifyOtp:async(code)=>{const pending=get().pending;if(!pending)throw new Error('No phone number to verify. Start again.');try{const data=pending.intent==='register'?await verifyRegistration({fullName:pending.name??'',phone:pending.phone,code,accountType:pending.accountType,phoneVerificationToken:pending.phoneVerificationToken}):await verifyLogin(pending.phone,code);await tokenStore.setTokens(data.tokens);const user={...data.user,role:data.activeRole} as AuthUser;const application=applicationFromStatus(data.driverStatus,user);set({session:{user},pending:null,driverApplication:application});const destination:AuthDestination=data.accountType==='driver'&&data.driverStatus==='none'?'driver-onboarding':data.activeRole==='driver'&&data.driverStatus==='approved'?'driver-dashboard':data.driverStatus==='pending'||data.driverStatus==='rejected'?'driver-status':'home';return{destination};}catch(error){throw new Error(apiErrorMessage(error));}},
  signInWithGoogle:async()=>get().signInWithGoogleIdToken(await getGoogleIdToken()),
  signInWithGoogleIdToken:async(idToken)=>{try{const result=await googleAuth(idToken);if('needsPhoneVerification' in result){set({pending:{phone:'',name:result.user.name,intent:'register',accountType:'rider',phoneVerificationToken:result.phoneVerificationToken}});return'phone';}await tokenStore.setTokens(result.tokens);const user={...result.user,role:result.activeRole} as AuthUser;set({session:{user},driverApplication:applicationFromStatus(result.driverStatus,user)});return result.activeRole==='driver'&&result.driverStatus==='approved'?'driver-dashboard':result.driverStatus==='pending'||result.driverStatus==='rejected'?'driver-status':'home';}catch(error){throw new Error(apiErrorMessage(error));}},
  completeProfile:async({name,email})=>{const session=get().session;if(session)set({session:{user:{...session.user,name,email}}});},
  setRole:async(role)=>{try{const data=await switchActiveRole(role);const session=get().session;if(session)set({session:{user:{...session.user,role:data.activeRole}}});return true;}catch{return false;}},
  submitDriverApplication:async(application)=>{try{const {data}=await apiSubmitDriverApplication();set({driverApplication:{...application,status:'pending',submittedAt:new Date(data.submittedAt??Date.now()).getTime()}});}catch(error){throw new Error(apiErrorMessage(error));}},
  refreshDriverApplication:async()=>{const user=get().session?.user;if(!user)return;const data=await getDriverApplicationStatus();const current=get().driverApplication??blankApplication(user);set({driverApplication:{...current,status:data.status==='none'?'draft':data.status,rejectionReason:data.rejection_reason,submittedAt:data.submitted_at?new Date(data.submitted_at).getTime():current.submittedAt}});},
  restartDriverApplication:()=>set({driverApplication:blankApplication(get().session?.user)}),
  updateProfile:(input)=>{const session=get().session;if(session)set({session:{user:{...session.user,...input}}});},
  logout:async()=>{const refresh=await tokenStore.getRefreshToken();set({session:null,pending:null,driverApplication:null});useWalletStore.getState().reset();resetSocket();await logoutSession(refresh);await tokenStore.clear();},
  setHydrated:()=>set({_hasHydrated:true}),
}));
export const useIsSignedIn=()=>useAuthStore(s=>s.session!==null);
