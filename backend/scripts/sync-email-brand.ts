import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Generated assets consume the canonical palette; email has no independent UI palette.
async function main(){
  const source=resolve('../mobile/src/constants/colors.ts');
  const {lightColors}=await import(pathToFileURL(source).href) as {lightColors:Record<string,string>};
  await writeFile(resolve('src/modules/notifications/emailBrand.generated.json'),JSON.stringify({source:'mobile/src/constants/colors.ts',sha256:createHash('sha256').update(await readFile(source)).digest('hex'),colors:lightColors},null,2)+'\n');
  console.info('Email brand tokens synchronized from the canonical mobile palette.');
}
void main().catch(()=>{console.error('Email brand synchronization failed.');process.exitCode=1;});
