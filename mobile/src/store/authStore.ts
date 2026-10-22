import { create } from 'zustand';
import { Alert } from 'react-native';
import { apiErrorMessage, isSessionRejected } from '@/lib/apiClient';
import { tokenStore } from '@/lib/secureTokenStore';
import { getMe, googleAuth, logoutSession, requestLogin, requestRegistration, resendOtp, saveProfile, confirmPhoneChange, switchActiveRole, verifyLogin, verifyRegistration, type AuthUser, type UserRole } from '@/services/authService';
import { getGoogleIdToken } from '@/services/googleSignIn';
import { getDriverServiceSettings, updateDriverServicePreferences, withdrawDriverServiceConsent as apiWithdrawDriverServiceConsent, type DriverService, type DriverServiceSettings, type DriverApplicationResponse, getDriverApplicationStatus, submitDriverApplication as apiSubmitDriverApplication } from '@/services/driverService';
import { resetSocket } from '@/services/socket';
import { useWalletStore } from '@/store/walletStore';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { useCourierDraftStore } from '@/store/courierDraftStore';
import { stopAllDriverLocationUpdates } from '@/services/locationService';
import { currentDeviceRegistrationId, revokeCurrentDevice } from '@/services/notificationService';
import { useNotificationStore } from '@/store/notificationStore';

interface Session { user: AuthUser }
export type AuthIntent='register'|'login';
export type RegistrationAccountType='rider'|'driver';
export type DriverApplicationStatus='draft'|'pending'|'approved'|'rejected';
export interface DriverApplication {status:DriverApplicationStatus;submittedAt?:number;rejectionReason?:string;personal:{fullName:string;email:string;address:string};vehicle:{make:string;model:string;year:string;color:string;registrationNumber:string};documents:{driverLicence:string;vehicleRegistration:string;insurance:string}}
export type AuthDestination='home'|'driver-onboarding'|'driver-dashboard'|'driver-status';
interface Pending{phone:string;name?:string;email?:string;intent:AuthIntent;accountType:RegistrationAccountType;phoneVerificationToken?:string}
interface AuthState{driverServices:DriverServiceSettings|null;refreshDriverServices:()=>Promise<void>;saveDriverServicePreferences:(ride:boolean,courier:boolean)=>Promise<void>;withdrawDriverServiceConsent:(service:DriverService)=>Promise<void>;session:Session|null;pending:Pending|null;driverApplication:DriverApplication|null;_hasHydrated:boolean;_sessionError:string|null;
  hydrate:()=>Promise<void>;requestOtp:(phone:string,options?:{name?:string;email?:string;intent?:AuthIntent;accountType?:RegistrationAccountType})=>Promise<void>;verifyOtp:(code:string)=>Promise<{destination:AuthDestination}>;signInWithGoogle:()=>Promise<'phone'|AuthDestination>;signInWithGoogleIdToken:(idToken:string)=>Promise<'phone'|AuthDestination>;completeProfile:(input:{name:string;email?:string;role?:UserRole})=>Promise<void>;setRole:(role:UserRole)=>Promise<boolean>;submitDriverApplication:(application:Omit<DriverApplication,'status'|'submittedAt'|'rejectionReason'>)=>Promise<void>;refreshDriverApplication:()=>Promise<DriverApplicationResponse | undefined>;restartDriverApplication:()=>void;updateProfile:(input:Partial<Pick<AuthUser,'name'|'email'>>)=>Promise<void>;changePhone:(challenge:string,code:string)=>Promise<void>;logout:()=>Promise<void>;setHydrated:()=>void}
const blankApplication=(user?:AuthUser|null):DriverApplication=>({status:'draft',personal:{fullName:user?.name??'',email:user?.email??'',address:''},vehicle:{make:'',model:'',year:'',color:'',registrationNumber:''},documents:{driverLicence:'',vehicleRegistration:'',insurance:''}});
function applicationFromStatus(status:'none'|'pending'|'approved'|'rejected',user:AuthUser,rejectionReason?:string){const application=blankApplication(user);application.status=status==='none'?'draft':status;application.rejectionReason=rejectionReason;return application;}

let sessionGeneration = 0;
let roleSwitchInFlight = false;

export const useAuthStore=create<AuthState>((set,get)=>({driverServices:null,session:null,pending:null,driverApplication:null,_hasHydrated:false,_sessionError:null,
  hydrate: async () => {
    const generation = sessionGeneration;
    try {
      if (!await tokenStore.getAccessToken()) {
        if (generation === sessionGeneration) set({ session: null, driverServices:null, driverApplication: null, _hasHydrated: true, _sessionError: null });
        return;
      }
      const data = await getMe();
      if (generation !== sessionGeneration) return;
      const user = { ...data.user, role: data.activeRole } as AuthUser;
      set({ session: { user }, ...(get().session?.user.id===user.id?{}:{driverServices:null}), driverApplication: applicationFromStatus(data.driverStatus, user), _hasHydrated: true, _sessionError: null });
    } catch (error) {
      if (generation !== sessionGeneration) return;
      if (isSessionRejected(error)) {
        await get().logout();
        set({ _hasHydrated: true, _sessionError: null });
      } else {
        set({ _hasHydrated: true, _sessionError: 'We could not reconnect to your account. Your saved login is kept. Check your connection and retry.' });
      }
    }
  },
  requestOtp:async(phone,options)=>{try{const previous=get().pending;if(!options&&previous){await resendOtp(phone,previous.intent==='register'?'registration':'login');return;}const intent=options?.intent??'login',accountType=options?.accountType??'rider';if(intent==='register')await requestRegistration({fullName:options?.name??'',phone,accountType});else await requestLogin(phone);set({pending:{phone,name:options?.name,email:options?.email??previous?.email,intent,accountType,phoneVerificationToken:previous?.phoneVerificationToken}});}catch(error){throw new Error(apiErrorMessage(error));}},
  verifyOtp:async(code)=>{const pending=get().pending;if(!pending)throw new Error('No phone number to verify. Start again.');try{const data=pending.intent==='register'?await verifyRegistration({fullName:pending.name??'',phone:pending.phone,code,email:pending.email,accountType:pending.accountType,phoneVerificationToken:pending.phoneVerificationToken}):await verifyLogin(pending.phone,code);sessionGeneration += 1;await tokenStore.setTokens(data.tokens);const user={...data.user,role:data.activeRole} as AuthUser;const application=applicationFromStatus(data.driverStatus,user);set({session:{user},driverServices:null,pending:null,driverApplication:application,_sessionError:null});const destination:AuthDestination=data.accountType==='driver'&&data.driverStatus==='none'?'driver-onboarding':data.activeRole==='driver'&&data.driverStatus==='approved'?'driver-dashboard':data.driverStatus==='pending'||data.driverStatus==='rejected'?'driver-status':'home';return{destination};}catch(error){throw new Error(apiErrorMessage(error));}},
  signInWithGoogle:async()=>get().signInWithGoogleIdToken(await getGoogleIdToken()),
  signInWithGoogleIdToken:async(idToken)=>{try{const result=await googleAuth(idToken);if('needsPhoneVerification' in result){set({pending:{phone:'',name:result.user.name,email:result.user.email??undefined,intent:'register',accountType:'rider',phoneVerificationToken:result.phoneVerificationToken}});return'phone';}sessionGeneration += 1;await tokenStore.setTokens(result.tokens);const user={...result.user,role:result.activeRole} as AuthUser;set({session:{user},driverServices:null,driverApplication:applicationFromStatus(result.driverStatus,user),_sessionError:null});return result.activeRole==='driver'&&result.driverStatus==='approved'?'driver-dashboard':result.driverStatus==='pending'||result.driverStatus==='rejected'?'driver-status':'home';}catch(error){throw new Error(apiErrorMessage(error));}},
  completeProfile:async({name,email})=>get().updateProfile({name,...(email === undefined ? {} : {email})}),
  setRole: async (role) => {
    if (!get().session || roleSwitchInFlight) return false;
    roleSwitchInFlight = true;
    const generation = sessionGeneration;
    try {
      const data = await switchActiveRole(role);
      const session = get().session;
      if (!session || generation !== sessionGeneration) return false;
      if (session.user.role === 'driver' && data.activeRole !== 'driver') await stopAllDriverLocationUpdates();
      if (generation !== sessionGeneration) return false;
      if (data.activeRole !== session.user.role) sessionGeneration += 1;
      useTripStore.getState().clear();
      useMapStore.getState().clearTripMap();
      set({ session: { user: { ...session.user, role: data.activeRole } } });
      return true;
    } catch (error) {
      Alert.alert('Could not switch mode', apiErrorMessage(error));
      return false;
    } finally { roleSwitchInFlight = false; }
  },
  submitDriverApplication:async(application)=>{try{const {data}=await apiSubmitDriverApplication();set({driverApplication:{...application,status:'pending',submittedAt:new Date(data.submittedAt??Date.now()).getTime()}});}catch(error){throw new Error(apiErrorMessage(error));}},
  refreshDriverServices:async()=>{
    const generation=sessionGeneration,userId=get().session?.user.id;if(!userId)return;
    const data=await getDriverServiceSettings();
    if(generation!==sessionGeneration||get().session?.user.id!==userId)return;
    if(data.version>=(get().driverServices?.version??-1))set({driverServices:data});
  },
  saveDriverServicePreferences:async(ride,courier)=>{
    const generation=sessionGeneration,userId=get().session?.user.id,current=get().driverServices;
    if(!userId||!current)throw new Error('Load service settings before saving.');
    try{
      const data=await updateDriverServicePreferences({acceptsRide:ride,acceptsCourier:courier,expectedVersion:current.version});
      if(generation!==sessionGeneration||get().session?.user.id!==userId)return;
      if(data.version>=(get().driverServices?.version??-1))set({driverServices:data});
    }catch(error){await get().refreshDriverServices().catch(()=>{});throw error;}
  },
  withdrawDriverServiceConsent:async(service)=>{
    const generation=sessionGeneration,userId=get().session?.user.id,current=get().driverServices;
    if(!userId||!current)throw new Error('Load service settings before withdrawing consent.');
    try {
      const data=await apiWithdrawDriverServiceConsent(service,current.version);
      if(generation!==sessionGeneration||get().session?.user.id!==userId)return;
      if(data.version>=(get().driverServices?.version??-1))set({driverServices:data});
    } catch(error) {await get().refreshDriverServices().catch(()=>{});throw error;}
  },
  refreshDriverApplication:async()=>{
    const generation=sessionGeneration,user=get().session?.user;if(!user)return;
    const data=await getDriverApplicationStatus();
    if(generation!==sessionGeneration||get().session?.user.id!==user.id)return;
    const current=get().driverApplication??blankApplication(user);
    set({driverApplication:{...current,status:data.status==='none'?'draft':data.status,rejectionReason:data.rejection_reason,submittedAt:data.submitted_at?new Date(data.submitted_at).getTime():current.submittedAt}});
    if(data.serviceSettings.version>=(get().driverServices?.version??-1))set({driverServices:data.serviceSettings});
    return data;
  },
  restartDriverApplication:()=>set({driverApplication:blankApplication(get().session?.user)}),
  updateProfile: async (input) => {
    const generation = sessionGeneration;
    const userId = get().session?.user.id;
    if (!userId) throw new Error('Sign in to update your profile.');
    try {
      const data = await saveProfile(input);
      if (generation !== sessionGeneration || get().session?.user.id !== userId) throw new Error('Your session changed. Sign in and check your profile.');
      set({ session: { user: { ...data.user, role: data.activeRole } } });
    } catch (error) { throw new Error(apiErrorMessage(error)); }
  },
  changePhone: async (challenge, code) => {
    const generation = sessionGeneration;
    const userId = get().session?.user.id;
    if (!userId) throw new Error('Sign in to change your phone number.');
    try {
      const data = await confirmPhoneChange(challenge, code);
      if (generation !== sessionGeneration || get().session?.user.id !== userId) throw new Error('Your session changed. Sign in and check your phone number.');
      set({ session: { user: { ...data.user, role: data.activeRole } } });
    } catch (error) { throw new Error(apiErrorMessage(error)); }
  },
  logout: async () => {
    sessionGeneration += 1;
    const refresh = await tokenStore.getRefreshToken();
    const deviceId = await currentDeviceRegistrationId();
    // Send revocation while this account's access token is still available.
    const revocation = Promise.all([logoutSession(refresh,deviceId),revokeCurrentDevice().catch(()=>undefined)]);
    set({ session: null, driverServices:null, pending: null, driverApplication: null, _sessionError: null });
    useTripStore.getState().clear();
    useCourierDraftStore.getState().clearDraft();
    useMapStore.getState().clearUserLocation();
    useWalletStore.getState().reset();
    useNotificationStore.getState().reset();
    resetSocket();
    await Promise.all([tokenStore.clear(), stopAllDriverLocationUpdates().catch(() => undefined)]);
    await revocation;
  },
  setHydrated:()=>set({_hasHydrated:true}),
}));
// Clear the previous mode synchronously, before a screen can render its notifications.
useAuthStore.subscribe((state, previous) => {
  const user = state.session?.user;
  const before = previous.session?.user;
  if (user?.id !== before?.id || user?.role !== before?.role) {
    useTripStore.getState().clear();
    useCourierDraftStore.getState().clearDraft();
    useMapStore.getState().clearTripMap();
    useWalletStore.getState().reset();
  }
  useNotificationStore.getState().setContext(user?.id ?? null, user?.role ?? 'rider');
});
export const useIsSignedIn=()=>useAuthStore(s=>s.session!==null);
