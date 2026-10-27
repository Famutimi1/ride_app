import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
dotenv.config({quiet:true});
function ipv4(value:string|undefined,name:string){
  if(!value||isIP(value)!==4)throw new Error(`${name} must be an IPv4 address.`);
  return value;
}
async function main(){
  const outputIndex=process.argv.indexOf('--output');
  if(outputIndex<0||!process.argv[outputIndex+1])throw new Error('Use --output /secure/location/turnserver.conf. Existing files are never overwritten.');
  const realm=process.env.TURN_REALM??'';
  if(!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(realm))throw new Error('TURN_REALM must be your TURN DNS hostname.');
  const address=ipv4(process.env.TURN_PUBLIC_IPV4,'TURN_PUBLIC_IPV4');
  const relay=ipv4(process.env.TURN_RELAY_IPV4??address,'TURN_RELAY_IPV4');
  const secret=process.env.TURN_SHARED_SECRET??'';
  if(!/^[a-zA-Z0-9_-]{32,256}$/.test(secret))throw new Error('TURN_SHARED_SECRET must be a 32–256 character random URL-safe secret shared with the backend.');
  const privatePeers=[['0.0.0.0','0.255.255.255'],['10.0.0.0','10.255.255.255'],['100.64.0.0','100.127.255.255'],['127.0.0.0','127.255.255.255'],['169.254.0.0','169.254.255.255'],['172.16.0.0','172.31.255.255'],['192.168.0.0','192.168.255.255'],['::','::1'],['fc00::','fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],['fe80::','febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff']];
  const text=[`realm=${realm}`,`server-name=${realm}`,'listening-port=3478','tls-listening-port=443',`relay-ip=${relay}`,`external-ip=${address}/${relay}`,
    'min-port=49160','max-port=49359','fingerprint','use-auth-secret',`static-auth-secret=${secret}`,
    'cert=/run/turn/tls/fullchain.pem','pkey=/run/turn/tls/privkey.pem','no-cli','no-multicast-peers','no-tcp-relay',
    'total-quota=200','user-quota=4','max-bps=64000','bps-capacity=12500000','userdb=/tmp/turndb','log-file=stdout','simple-log',
    ...privatePeers.map(([from,to])=>`denied-peer-ip=${from}-${to}`),''].join('\n');
  await writeFile(resolve(process.argv[outputIndex+1]),text,{mode:0o600,flag:'wx'});
  console.info('Created the protected TURN configuration. Match file ownership to TURN_UID/TURN_GID and verify relay/TLS connectivity before enabling calls.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'TURN configuration could not be prepared.');process.exitCode=1;});
