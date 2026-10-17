import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

test('compiled migrations serialize, required workers gate readiness, and SIGTERM drains the backend', {skip:!process.env.DATABASE_URL||!process.env.REDIS_URL,timeout:30000},async()=>{
  const schema=`runtime_test_${process.pid}_${Date.now()}`;
  const owner=new Pool({connectionString:process.env.DATABASE_URL});
  await owner.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);
  const prefix=`runtime-${process.pid}-${Date.now()}`;
  const environment={...process.env,DATABASE_URL:url.toString(),TRIP_QUEUE_PREFIX:prefix,NODE_ENV:'test',ENABLE_ADMIN_MONEY_ACTIONS:'false'};
  const run=(script:string,env:NodeJS.ProcessEnv=environment)=>{
    const child=spawn(process.execPath,[script],{env,stdio:'pipe'});
    let output='';child.stdout.on('data',part=>output+=String(part));child.stderr.on('data',part=>output+=String(part));
    const exit=new Promise<number>((done,reject)=>{child.once('error',reject);child.once('exit',code=>done(code??1));});
    return {child,exit,output:()=>output};
  };
  let server:ChildProcess|undefined;
  let redis:Redis|undefined;
  let queue:Queue|undefined;
  try {
    const migrations=[run('dist/shared/config/migrate.js'),run('dist/shared/config/migrate.js')];
    assert.deepEqual(await Promise.all(migrations.map(item=>item.exit)),[0,0],migrations.map(item=>item.output()).join('\n'));
    const pool=new Pool({connectionString:url.toString()});
    try{const expected=(await readdir('migrations')).filter(name=>/^\d+_.*\.sql$/.test(name)).sort();const applied=(await pool.query<{filename:string}>('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(row=>row.filename);assert.deepEqual(applied,expected);}finally{await pool.end();}
    const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));
    const port=(reservation.address() as AddressInfo).port;await new Promise<void>(done=>reservation.close(()=>done()));
    const started=run('dist/index.js',{...environment,PORT:String(port)});server=started.child;
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){
      if(server.exitCode!==null)assert.fail(started.output());
      try{if((await fetch(base+'/api/health/ready')).status===200){ready=true;break;}}catch{}
      await new Promise(done=>setTimeout(done,50));
    }
    assert.equal(ready,true,started.output());
    assert.deepEqual(await (await fetch(base+'/api/health/live')).json(),{status:'alive'});
    redis=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:null});
    queue=new Queue('trip-dispatch',{connection:redis,prefix});
    await queue.pause();
    assert.equal((await fetch(base+'/api/health/ready')).status,503,'paused required queue is unready');
    assert.equal((await fetch(base+'/api/health/live')).status,200,'provider/worker readiness is separate from liveness');
    await queue.resume();
    assert.equal((await fetch(base+'/api/health/ready')).status,200);
    server.kill('SIGTERM');
    assert.equal(await started.exit,0,started.output());
    server=undefined;
    const failed=run('dist/index.js',{...environment,PORT:String(port),REDIS_URL:''});
    server=failed.child;
    assert.equal(await failed.exit,1,'missing required Redis cannot produce a ready HTTP server');
    server=undefined;
  } finally {
    if(server?.exitCode===null)server.kill('SIGKILL');
    await queue?.close();await redis?.quit();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();
  }
});
