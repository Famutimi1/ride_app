import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import { getServiceSettings, lockServiceProfile, setServicePreferences } from '../matching/serviceEligibility';
import { queueApplicationSubmitted, resolveWelcomeEmail } from '../notifications/email.service';
import { isAppAccountRole } from '../auth/auth.types';

/** All material write paths share the same user -> profile locking order. */
export async function assertDriverMaterialEditable(userId:string,client:PoolClient) {
  const user=(await client.query<{role:string}>('SELECT role FROM users WHERE id=$1 AND is_active=true FOR UPDATE',[userId])).rows[0];
  if(!user)throw new ApiError(401,'account_inactive');
  const profile=(await client.query<{status:string}>('SELECT status FROM driver_profiles WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
  if((await client.query("SELECT 1 FROM trips WHERE (driver_id=$1 OR rider_id=$1) AND status IN ('driver_assigned','driver_arrived','in_progress','returning') LIMIT 1",[userId])).rowCount)throw new ApiError(409,'active_trip_prevents_material_changes');
  if(profile?.status==='approved')throw new ApiError(409,'approved_driver_material_requires_review');
  return {...user,profileStatus:profile?.status??null};
}

export function documentContentType(bytes:Buffer) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return null;
}

export async function savePersonalInfo(userId: string, input: Record<string, unknown>, client: PoolClient) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_personal_info');
  const fullName = String(input.fullName ?? '').trim(); const email = String(input.email ?? '').trim().toLowerCase(); const address = String(input.address ?? '').trim();
  if (fullName.length < 2 || fullName.length>120 || email.length>160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || address.length < 5 || address.length>1000) throw new ApiError(400, 'invalid_personal_info');
  const user=await assertDriverMaterialEditable(userId,client);
  if(!isAppAccountRole(user.role))throw new ApiError(403,'driver_account_required');
  // Staff can enroll as drivers without changing their staff sign-in identity.
  if(user.role!=='user') {
    const current=(await client.query<{email:string|null}>('SELECT email FROM users WHERE id=$1',[userId])).rows[0];
    if(email!==current?.email?.trim().toLowerCase())throw new ApiError(403,'staff_email_requires_admin');
  }
  await client.query('UPDATE users SET full_name=$1,email=$2,updated_at=now() WHERE id=$3', [fullName, email, userId]);
  await resolveWelcomeEmail(client,userId,email);
  const { rows } = await client.query(`INSERT INTO driver_profiles (user_id,status,residential_address) VALUES ($1,'none',$2) ON CONFLICT (user_id) DO UPDATE SET residential_address=$2,updated_at=now() RETURNING *`, [userId, address]);
  return rows[0];
}

export async function saveVehicleInfo(userId: string, input: Record<string, unknown>, client: PoolClient) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_vehicle_info');
  const make=String(input.make??'').trim(), model=String(input.model??'').trim(), color=String(input.color??'').trim(), plate=String(input.registrationNumber??'').trim().toUpperCase(), year=Number(input.year);
  if (!make || make.length>60 || !model || model.length>60 || !color || color.length>30 || !plate || plate.length>20 || !Number.isInteger(year) || year < 1990 || year > new Date().getFullYear()+1) throw new ApiError(400, 'invalid_vehicle_info');
  await assertDriverMaterialEditable(userId,client);
  const { rows } = await client.query(`UPDATE driver_profiles SET vehicle_make=$1,vehicle_model=$2,vehicle_year=$3,vehicle_color=$4,plate_number=$5,updated_at=now() WHERE user_id=$6 RETURNING *`, [make,model,year,color,plate,userId]);
  if (!rows[0]) throw new ApiError(409, 'personal_info_required'); return rows[0];
}

async function storePrivateDocument(userId: string, file: Express.Multer.File) {
  if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw new ApiError(400, 'invalid_document_type');
  if (file.size > 8 * 1024 * 1024 || file.buffer.length>8*1024*1024) throw new ApiError(413, 'document_too_large');
  const contentType=documentContentType(file.buffer);
  if(!contentType||contentType!==file.mimetype)throw new ApiError(415,'document_content_type_mismatch');
  const directory = resolve(process.cwd(), '.private-uploads', 'driver-documents', userId); await mkdir(directory, { recursive: true });
  const extension=contentType==='image/png'?'.png':contentType==='image/jpeg'?'.jpg':contentType==='image/webp'?'.webp':'.pdf';
  const name = `${randomUUID()}${extension}`; await writeFile(resolve(directory, name), file.buffer, { mode: 0o600,flag:'wx' });
  return `private://driver-documents/${userId}/${name}`;
}

export async function saveDocuments(userId: string, files: Record<string, Express.Multer.File[]>, client: PoolClient) {
  const license=files?.license?.[0], registration=files?.vehicleRegistration?.[0], insurance=files?.insurance?.[0];
  if (!license || !registration || !insurance) throw new ApiError(400, 'all_documents_required');
  const editable=await assertDriverMaterialEditable(userId,client);
  if(editable.profileStatus===null)throw new ApiError(409,'personal_info_required');
  // Validate all three before writing any of them.
  for(const file of [license,registration,insurance]){
    if(file.buffer.length>8*1024*1024)throw new ApiError(413,'document_too_large');
    if(!documentContentType(file.buffer)||documentContentType(file.buffer)!==file.mimetype)throw new ApiError(415,'document_content_type_mismatch');
  }
  const urls = await Promise.all([storePrivateDocument(userId,license),storePrivateDocument(userId,registration),storePrivateDocument(userId,insurance)]);
  const { rows } = await client.query(`UPDATE driver_profiles SET license_doc_url=$1,vehicle_reg_doc_url=$2,insurance_doc_url=$3,updated_at=now() WHERE user_id=$4 RETURNING *`, [...urls,userId]);
  if (!rows[0]) throw new ApiError(409, 'personal_info_required'); return { documentsUploaded: true };
}

export async function submitApplication(userId: string, client: PoolClient) {
  await assertDriverMaterialEditable(userId,client);
  const profile=await lockServiceProfile(userId,client);
  if(profile.ride_service_status!=='pending'&&profile.courier_service_status!=='pending')throw new ApiError(409,'choose_driver_services');
  const { rows } = await client.query(`UPDATE driver_profiles SET status='pending',submitted_at=now(),rejection_reason=NULL,updated_at=now() WHERE user_id=$1 AND residential_address IS NOT NULL AND vehicle_make IS NOT NULL AND license_doc_url IS NOT NULL RETURNING *`, [userId]);
  if (!rows[0]) throw new ApiError(409, 'driver_application_incomplete');
  await queueApplicationSubmitted(client,userId,`services-${profile.service_settings_version}`);
  return { status: 'pending', submittedAt: rows[0].submitted_at };
}

export async function applicationStatus(userId: string, client: PoolClient) {
  const { rows } = await client.query<{
    status: 'none'|'pending'|'approved'|'rejected'; rejection_reason: string|null;
    submitted_at: Date|null; reviewed_at: Date|null;
    vehicle: {make:string|null;model:string|null;year:number|null;color:string|null;registrationNumber:string|null}|null;
    documents: Array<{kind:'license'|'registration'|'insurance';available:boolean}>;
  }>(`SELECT status,rejection_reason,submitted_at,reviewed_at,
    CASE WHEN vehicle_make IS NOT NULL THEN json_build_object('make',vehicle_make,'model',vehicle_model,'year',vehicle_year,'color',vehicle_color,'registrationNumber',plate_number) ELSE NULL END AS vehicle,
    json_build_array(json_build_object('kind','license','available',license_doc_url IS NOT NULL),
      json_build_object('kind','registration','available',vehicle_reg_doc_url IS NOT NULL),
      json_build_object('kind','insurance','available',insurance_doc_url IS NOT NULL)) AS documents
    FROM driver_profiles WHERE user_id=$1`, [userId]);
  return { ...(rows[0] ?? { status: 'none', rejection_reason: null, submitted_at: null, reviewed_at: null, vehicle:null,documents:[] }), serviceSettings: await getServiceSettings(userId,client) };
}

export async function courierPreference(userId: string, client: PoolClient) {
  const { rows } = await client.query<{ accepts_courier: boolean }>("SELECT accepts_courier FROM driver_profiles WHERE user_id=$1 AND status='approved'", [userId]);
  if (!rows[0]) throw new ApiError(403, 'approved_driver_required');
  return { acceptsCourier: rows[0].accepts_courier };
}

export async function setCourierPreference(userId: string, value: unknown, client: PoolClient) {
  if (typeof value !== 'boolean') throw new ApiError(400, 'invalid_courier_preference');
  const profile=await lockServiceProfile(userId,client);
  const current=await getServiceSettings(userId,client);
  const result=await setServicePreferences(userId,{acceptsRide:current.services.ride.enabled,acceptsCourier:value,expectedVersion:profile.service_settings_version},client);
  return {acceptsCourier:result.services.courier.enabled};
}
