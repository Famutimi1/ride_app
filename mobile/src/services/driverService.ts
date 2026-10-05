import { apiClient } from '@/lib/apiClient';
export interface PickedDocument{name:string;uri:string;mimeType?:string|null;file?:Blob}
export const savePersonalInfo=(input:{fullName:string;email:string;address:string})=>apiClient.post('/driver/onboarding/personal-info',input);
export const saveVehicleInfo=(input:{make:string;model:string;year:string;color:string;registrationNumber:string})=>apiClient.post('/driver/onboarding/vehicle-info',input);
export async function uploadDriverDocuments(files:{license:PickedDocument;vehicleRegistration:PickedDocument;insurance:PickedDocument}){const body=new FormData();for(const [key,file] of Object.entries(files))body.append(key,file.file??({uri:file.uri,name:file.name,type:file.mimeType??'application/octet-stream'} as unknown as Blob),file.name);return apiClient.post('/driver/onboarding/documents',body,{headers:{'Content-Type':'multipart/form-data'}});}
export const submitDriverApplication=()=>apiClient.post('/driver/onboarding/submit');
export const getDriverApplicationStatus=()=>apiClient.get('/driver/application/status').then(r=>r.data as {status:'none'|'pending'|'approved'|'rejected';rejection_reason?:string;submitted_at?:string});
