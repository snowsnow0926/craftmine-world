// Host build identity: covers native source, compiled bridge and official lock.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function walk(directory,prefix){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  if(entry.isSymbolicLink())throw Error('BROKER_SOURCE_LINK_DENIED');
  const relative=prefix+'/'+entry.name;
  return entry.isDirectory()?walk(path.join(directory,entry.name),relative):entry.name.endsWith('.rs')?[relative]:[];
});}
const files=['../godot/sandbox/Cargo.toml','../godot/sandbox/Cargo.lock','../godot/shared/windows-export.cfg',
  'bridge/driver.py','toolchain.lock.json',...walk(path.join(here,'../godot/sandbox/src'),'../godot/sandbox/src')];
const records=files.map(relative=>({path:relative,sha256:sha256(fs.readFileSync(path.join(here,relative)))})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const [binary,...rest]=process.argv.slice(2);
if(!binary)throw Error('usage: broker-identity.mjs <broker.exe> [--write path]');
const lock=JSON.parse(fs.readFileSync(path.join(here,'toolchain.lock.json'),'utf8'));
const identity={format:'craftmine.blender-broker-identity/1',profile:process.env.CRAFTMINE_BROKER_PROFILE??'debug',
  protocolVersion:1,policyVersion:'craftmine.windows.lpac-registry.v1',recoveryPolicyVersion:'craftmine.windows.recovery-journal.v1',
  sourceCommit:process.env.CRAFTMINE_BROKER_SOURCE_COMMIT??null,sourceDigest:sha256(JSON.stringify(records)),sourceFiles:records,
  sha256:sha256(fs.readFileSync(binary)),bytes:fs.statSync(binary).size,runtimeVersion:lock.runtimeVersion,
  runtimeInventoryDigest:sha256(JSON.stringify(lock.files)),builtFrom:path.resolve(binary),recordedAt:new Date().toISOString()};
const text=JSON.stringify(identity,null,2)+'\n';const i=rest.indexOf('--write');
if(i>=0){if(!rest[i+1])throw Error('--write requires path');fs.writeFileSync(rest[i+1],text);}else process.stdout.write(text);
