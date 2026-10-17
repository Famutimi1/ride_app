import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Builds the real dashboard, then exercises it against disposable API/database state.
// No SMS, operational accounts, or provider writes are used.
const dashboard = resolve(process.env.RAKKY_DASHBOARD_TEST_ROOT ?? '../../rakkydashboard');
async function run(cwd:string,args:string[],env:NodeJS.ProcessEnv=process.env) {
  const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit'});
  const forward=()=>child.kill('SIGTERM');
  process.once('SIGINT',forward);process.once('SIGTERM',forward);
  try {
    const code=await new Promise<number>((done,reject)=>{child.once('error',reject);child.once('exit',value=>done(value??1));});
    if(code!==0)throw new Error(`Connection verification exited with status ${code}.`);
  }finally{process.removeListener('SIGINT',forward);process.removeListener('SIGTERM',forward);}
}
async function main(){
  await run(dashboard,[resolve(dashboard,'node_modules/next/dist/bin/next'),'build']);
  await run(process.cwd(),[resolve('node_modules/tsx/dist/cli.mjs'),'scripts/test-isolated.ts','src/modules/auth/driverServices.integration.test.ts','src/modules/auth/socket.integration.test.ts'],{...process.env,RAKKY_DASHBOARD_TEST_ROOT:dashboard});
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Connection verification failed.');process.exitCode=1;});
