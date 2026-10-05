import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';

export async function savePersonalInfo(userId: string, input: Record<string, unknown>, client: PoolClient) {
  const fullName = String(input.fullName ?? '').trim(); const email = String(input.email ?? '').trim().toLowerCase(); const address = String(input.address ?? '').trim();
  if (fullName.length < 2 || !email.includes('@') || address.length < 5) throw new ApiError(400, 'invalid_personal_info');
  await client.query('UPDATE users SET full_name=$1,email=$2,updated_at=now() WHERE id=$3', [fullName, email, userId]);
  const { rows } = await client.query(`INSERT INTO driver_profiles (user_id,status,residential_address) VALUES ($1,'none',$2) ON CONFLICT (user_id) DO UPDATE SET residential_address=$2,updated_at=now() RETURNING *`, [userId, address]);
  return rows[0];
}

export async function saveVehicleInfo(userId: string, input: Record<string, unknown>, client: PoolClient) {
  const make=String(input.make??'').trim(), model=String(input.model??'').trim(), color=String(input.color??'').trim(), plate=String(input.registrationNumber??'').trim().toUpperCase(), year=Number(input.year);
  if (!make || !model || !color || !plate || !Number.isInteger(year) || year < 1990 || year > new Date().getFullYear()+1) throw new ApiError(400, 'invalid_vehicle_info');
  const { rows } = await client.query(`UPDATE driver_profiles SET vehicle_make=$1,vehicle_model=$2,vehicle_year=$3,vehicle_color=$4,plate_number=$5,updated_at=now() WHERE user_id=$6 RETURNING *`, [make,model,year,color,plate,userId]);
  if (!rows[0]) throw new ApiError(409, 'personal_info_required'); return rows[0];
}

async function storePrivateDocument(userId: string, file: Express.Multer.File) {
  if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw new ApiError(400, 'invalid_document_type');
  if (file.size > 8 * 1024 * 1024) throw new ApiError(413, 'document_too_large');
  const directory = resolve(process.cwd(), '.private-uploads', 'driver-documents', userId); await mkdir(directory, { recursive: true });
  const name = `${randomUUID()}${extname(file.originalname).toLowerCase()}`; await writeFile(resolve(directory, name), file.buffer, { mode: 0o600 });
  return `private://driver-documents/${userId}/${name}`;
}

export async function saveDocuments(userId: string, files: Record<string, Express.Multer.File[]>, client: PoolClient) {
  const license=files.license?.[0], registration=files.vehicleRegistration?.[0], insurance=files.insurance?.[0];
  if (!license || !registration || !insurance) throw new ApiError(400, 'all_documents_required');
  const urls = await Promise.all([storePrivateDocument(userId,license),storePrivateDocument(userId,registration),storePrivateDocument(userId,insurance)]);
  const { rows } = await client.query(`UPDATE driver_profiles SET license_doc_url=$1,vehicle_reg_doc_url=$2,insurance_doc_url=$3,updated_at=now() WHERE user_id=$4 RETURNING *`, [...urls,userId]);
  if (!rows[0]) throw new ApiError(409, 'personal_info_required'); return { documentsUploaded: true };
}

export async function submitApplication(userId: string, client: PoolClient) {
  const { rows } = await client.query(`UPDATE driver_profiles SET status='pending',submitted_at=now(),rejection_reason=NULL,updated_at=now() WHERE user_id=$1 AND residential_address IS NOT NULL AND vehicle_make IS NOT NULL AND license_doc_url IS NOT NULL RETURNING *`, [userId]);
  if (!rows[0]) throw new ApiError(409, 'driver_application_incomplete'); return { status: 'pending', submittedAt: rows[0].submitted_at };
}

export async function applicationStatus(userId: string, client: PoolClient) {
  const { rows } = await client.query('SELECT status,rejection_reason,submitted_at,reviewed_at FROM driver_profiles WHERE user_id=$1', [userId]);
  return rows[0] ?? { status: 'none', rejection_reason: null, submitted_at: null, reviewed_at: null };
}
