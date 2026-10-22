import { apiClient } from '@/lib/apiClient';
export interface PickedDocument{name:string;uri:string;mimeType?:string|null;file?:Blob}
export const savePersonalInfo=(input:{fullName:string;email:string;address:string})=>apiClient.post('/driver/onboarding/personal-info',input);
export const saveVehicleInfo=(input:{make:string;model:string;year:string;color:string;registrationNumber:string})=>apiClient.post('/driver/onboarding/vehicle-info',input);
export async function uploadDriverDocuments(files:{license:PickedDocument;vehicleRegistration:PickedDocument;insurance:PickedDocument}){const body=new FormData();for(const [key,file] of Object.entries(files))body.append(key,file.file??({uri:file.uri,name:file.name,type:file.mimeType??'application/octet-stream'} as unknown as Blob),file.name);return apiClient.post('/driver/onboarding/documents',body,{headers:{'Content-Type':'multipart/form-data'}});}
export const submitDriverApplication=()=>apiClient.post('/driver/onboarding/submit');
export interface DriverVehicle {
  make:string|null;model:string|null;year:number|null;color:string|null;registrationNumber:string|null;
}
export interface DriverApplicationResponse {
  status:'none'|'pending'|'approved'|'rejected';rejection_reason?:string;submitted_at?:string;reviewed_at?:string;
  vehicle:DriverVehicle|null;
  documents:{kind:'license'|'registration'|'insurance';available:boolean}[];
  serviceSettings:DriverServiceSettings;
}
export const getDriverApplicationStatus=()=>apiClient.get<DriverApplicationResponse>('/driver/application/status').then(r=>r.data);
export const getCourierPreference=()=>apiClient.get<{acceptsCourier:boolean}>('/driver/courier-preference').then(r=>r.data);
export const setCourierPreference=(acceptsCourier:boolean)=>apiClient.put<{acceptsCourier:boolean}>('/driver/courier-preference',{acceptsCourier}).then(r=>r.data);

export type DriverService = 'ride'|'courier';
export type DriverServiceStatus = 'none'|'pending'|'approved'|'rejected'|'suspended';
export interface DriverServiceSettings {
  version:number;
  vehicleCategory:'car'|'motorcycle'|null;
  vehicle?:DriverVehicle|null;
  requestedVehicleCategory?:'car'|'motorcycle'|null;
  vehicleReviewRequired?:boolean;
  services:Record<DriverService,{status:DriverServiceStatus;enabled:boolean;consentAccepted:boolean;review:{reason?:string}|null}>;
  consent:{version:string;descriptions:Record<DriverService,string>};
}
export const getDriverServiceSettings=()=>apiClient.get<DriverServiceSettings>('/driver/service-settings').then(r=>r.data);
export const updateDriverServicePreferences=(input:{acceptsRide:boolean;acceptsCourier:boolean;expectedVersion:number})=>apiClient.put<DriverServiceSettings>('/driver/service-preferences',input).then(r=>r.data);
export const applyForDriverServices=(input:{services:DriverService[];vehicleCategory:'car'|'motorcycle';consentVersion:string;consentAccepted:true;expectedVersion:number})=>apiClient.post<DriverServiceSettings>('/driver/service-applications',input).then(r=>r.data);
export const withdrawDriverServiceConsent=(service:DriverService,expectedVersion:number)=>apiClient.post<DriverServiceSettings>('/driver/service-consent/withdraw',{service,expectedVersion}).then(r=>r.data);
