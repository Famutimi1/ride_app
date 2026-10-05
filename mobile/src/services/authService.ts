import { apiClient } from '@/lib/apiClient';

export type UserRole='rider'|'driver';
export type DriverStatus='none'|'pending'|'approved'|'rejected';
export interface AuthUser{id:string;phone:string|null;name:string;email?:string|null;avatarUrl?:string|null;role:UserRole;platformRole?:'user'|'admin'|'super_admin'}
export interface AuthResponse{tokens:{accessToken:string;refreshToken:string};user:Omit<AuthUser,'role'>;activeRole:UserRole;driverStatus:DriverStatus;accountType?:UserRole}
export const requestRegistration=(input:{fullName:string;phone:string;accountType:UserRole})=>apiClient.post('/auth/register/initiate',input).then(r=>r.data);
export const requestLogin=(phone:string)=>apiClient.post('/auth/login/initiate',{phone}).then(r=>r.data);
export const resendOtp=(phone:string,purpose:'registration'|'login')=>apiClient.post('/auth/otp/resend',{phone,purpose}).then(r=>r.data);
export const verifyRegistration=(input:{fullName:string;phone:string;code:string;accountType:UserRole;phoneVerificationToken?:string})=>apiClient.post<AuthResponse>('/auth/register/verify',input).then(r=>r.data);
export const verifyLogin=(phone:string,code:string)=>apiClient.post<AuthResponse>('/auth/login/verify',{phone,code}).then(r=>r.data);
export const getMe=()=>apiClient.get<Omit<AuthResponse,'tokens'>>('/auth/me').then(r=>r.data);
export const switchActiveRole=(role:UserRole)=>apiClient.patch<{activeRole:UserRole}>('/auth/active-role',{role}).then(r=>r.data);
export const logoutSession=(refreshToken:string|null)=>apiClient.post('/auth/logout',{refreshToken}).catch(()=>undefined);
export const googleAuth=(idToken:string)=>apiClient.post('/auth/google',{idToken}).then(r=>r.data as AuthResponse|{needsPhoneVerification:true;phoneVerificationToken:string;user:Omit<AuthUser,'role'>});
