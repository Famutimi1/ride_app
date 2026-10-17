import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';

test('reviewed driver material cannot change and valid document versions gate approval',{skip:!process.env.DATABASE_URL},async t=>{
  const schema=`driver_integrity_test_${process.pid}_${Date.now()}`;
  const owner=new Pool({connectionString:process.env.DATABASE_URL});await owner.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
  const{db,inTransaction}=await import('../../shared/config/db.js');
  const driver=await import('../driver/driver.service.js');
  const{reviewAdminApplication}=await import('../driver/admin.service.js');
  const auth=await import('./auth.service.js');
  let userId:string|undefined;
  try{
    for(const name of(await readdir('migrations')).filter(name=>/^\d+_.*\.sql$/.test(name)).sort())await db.query(await readFile(resolve('migrations',name),'utf8'));
    userId=(await db.query("INSERT INTO users(full_name,email) VALUES('Reviewed fixture','driver@example.test') RETURNING id")).rows[0].id;
    const id=userId!;
    const staff=(await db.query("INSERT INTO users(full_name,role) VALUES('Reviewer fixture','super_admin') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO driver_profiles(user_id,status,residential_address,vehicle_make,vehicle_model,vehicle_year,vehicle_color,plate_number) VALUES($1,'approved','Test address','Toyota','Camry',2020,'Silver','OLD-001')",[id]);
    const vehicle={make:'Toyota',model:'Corolla',year:2021,color:'Silver',registrationNumber:'NEW-001'};
    await t.test('active trips block material edits even before approval',async()=>{
      await db.query("UPDATE driver_profiles SET status='pending' WHERE user_id=$1",[id]);
      const rider=(await db.query("INSERT INTO users(full_name) VALUES('Rider fixture') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO trips(rider_id,driver_id,status,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key) VALUES($1,$2,'driver_assigned','cash',6.4,3.4,'Test pickup',6.5,3.5,'Test destination',1000,300,100000,'active-material-fixture')",[rider,id]);
      await assert.rejects(inTransaction(client=>driver.saveVehicleInfo(id,vehicle,client)),{code:'active_trip_prevents_material_changes'});
      await db.query("UPDATE trips SET status='cancelled' WHERE driver_id=$1",[id]);
      await db.query("UPDATE driver_profiles SET status='approved' WHERE user_id=$1",[id]);
    });
    await t.test('onboarding, account identity and resubmission cannot overwrite approved material',async()=>{
      await assert.rejects(inTransaction(client=>driver.saveVehicleInfo(id,vehicle,client)),{code:'approved_driver_material_requires_review'});
      await assert.rejects(inTransaction(client=>driver.savePersonalInfo(id,{fullName:'Replacement',email:'new@example.test',address:'Test address'},client)),{code:'approved_driver_material_requires_review'});
      await assert.rejects(inTransaction(client=>auth.updateProfile(id,{name:'Replacement'},client)),{code:'approved_driver_material_requires_review'});
      await assert.rejects(inTransaction(client=>driver.submitApplication(id,client)),{code:'approved_driver_material_requires_review'});
      await inTransaction(client=>auth.updateProfile(id,{email:'contact@example.test'},client));
      assert.equal((await db.query('SELECT plate_number FROM driver_profiles WHERE user_id=$1',[id])).rows[0].plate_number,'OLD-001');
    });
    await db.query("UPDATE driver_profiles SET status='rejected' WHERE user_id=$1",[id]);
    const file=(bytes:Buffer,mimetype='application/pdf')=>({buffer:bytes,mimetype,size:bytes.length,originalname:'../../unsafe-name.html'}) as Express.Multer.File;
    const valid=file(Buffer.from('%PDF-1.4\n% Disposable document fixture\n'));
    await t.test('spoofed content is rejected and server filenames match detected bytes',async()=>{
      await assert.rejects(inTransaction(client=>driver.saveDocuments(id,{license:[file(Buffer.from('not a PDF'))],vehicleRegistration:[valid],insurance:[valid]},client)),{code:'document_content_type_mismatch'});
      await inTransaction(client=>driver.saveDocuments(id,{license:[valid],vehicleRegistration:[valid],insurance:[valid]},client));
      assert.ok((await readdir(resolve('.private-uploads','driver-documents',id))).every(name=>/^[0-9a-f-]{36}\.pdf$/.test(name)));
    });
    const {submitServiceApplication,SERVICE_CONSENT_VERSION}=await import('../matching/serviceEligibility.js');
    await inTransaction(client=>submitServiceApplication(id,{services:['ride'],vehicleCategory:'car',consentVersion:SERVICE_CONSENT_VERSION,consentAccepted:true,expectedVersion:0},client));
    await inTransaction(client=>driver.submitApplication(id,client));
    await t.test('missing private evidence prevents approval while rejection remains available',async()=>{
      const previous=(await db.query('SELECT license_doc_url FROM driver_profiles WHERE user_id=$1',[id])).rows[0].license_doc_url;
      await db.query('UPDATE driver_profiles SET license_doc_url=$2,updated_at=now() WHERE user_id=$1',[id,`private://driver-documents/${id}/${randomUUID()}.pdf`]);
      const version=(await db.query('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[id])).rows[0].version;
      await assert.rejects(reviewAdminApplication(staff,id,{decision:'approved',expectedVersion:version,reason:'Missing document fixture',requestKey:randomUUID()}),{code:'document_unavailable'});
      assert.equal((await reviewAdminApplication(staff,id,{decision:'rejected',expectedVersion:version,reason:'Required evidence is unavailable',requestKey:randomUUID()})).status,'rejected');
      await db.query("UPDATE driver_profiles SET status='pending',license_doc_url=$2,updated_at=now() WHERE user_id=$1",[id,previous]);
    });
    await t.test('concurrent review and edit cannot both accept different material',async()=>{
      const version=(await db.query('SELECT updated_at::text AS version FROM driver_profiles WHERE user_id=$1',[id])).rows[0].version;
      const result=await Promise.allSettled([reviewAdminApplication(staff,id,{decision:'approved',expectedVersion:version,reason:'Documents inspected in isolated test',requestKey:randomUUID()}),inTransaction(client=>driver.saveVehicleInfo(id,vehicle,client))]);
      assert.equal(result.filter(item=>item.status==='fulfilled').length,1);
      const row=(await db.query('SELECT status,plate_number FROM driver_profiles WHERE user_id=$1',[id])).rows[0];
      if(row.status==='approved')assert.equal(row.plate_number,'OLD-001');else assert.equal(row.plate_number,'NEW-001');
    });
  }finally{
    await db.end();if(userId)await rm(resolve('.private-uploads','driver-documents',userId),{recursive:true,force:true});
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();
  }
});
