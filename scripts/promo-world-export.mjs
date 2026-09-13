#!/usr/bin/env node
// Operator-only portable export using the existing Rust archive protocol.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readState,acquireLock} from './lib/codex-world-session.mjs';
import {CodexWorldHost} from './lib/codex-world-host.mjs';

export async function main(args=process.argv.slice(2)){
  if(args.length!==2||!args.every(path.isAbsolute))throw Error('Usage: promo-world-export.mjs ABS_PROFILE ABS_NEW_ARCHIVE.craftmine');
  const [data,archivePath]=args;
  try{await fs.stat(archivePath);throw Error('ARCHIVE_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const state=readState(data),unlock=acquireLock(data);
  const host=new CodexWorldHost({state,data});
  try{
    await host.start({engines:false});
    if(JSON.stringify(await host.sourceIdentity())!==JSON.stringify(state.sourceIdentity))throw Error('SOURCE_IDENTITY_CHANGED');
    const before=await host.core.call('world.read',{id:state.worldId});
    await fs.mkdir(path.dirname(archivePath),{recursive:true});
    const receipt=await host.core.call('backup.exportPortable',{operationId:'promo-export-'+randomUUID(),archivePath},120000);
    if(receipt.status!=='completed'||receipt.credentialsIncluded!==false)throw Error('PORTABLE_EXPORT_UNCONFIRMED');
    const verification=await host.core.call('backup.verifyPortable',{archivePath},120000);
    if(verification.valid!==true||verification.credentialsIncluded!==false)throw Error('PORTABLE_VERIFICATION_FAILED');
    const after=await host.core.call('world.read',{id:state.worldId});
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('EXPORT_CHANGED_WORLD');
    const bytes=await fs.readFile(archivePath);
    const report={format:'craftmine.promo-portable-export/1',createdAt:new Date().toISOString(),worldId:state.worldId,
      scope:'Rust portable archive: native world/source/progress, without account credentials or Codex transport login. Rebuildable Godot exports are excluded; imported worlds require normal rebuild/application.',
      sourceIdentity:state.sourceIdentity,worldUnchanged:true,world:before,receipt,verification,
      archive:{path:archivePath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
    await fs.writeFile(archivePath+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:archivePath+'.json',archive:report.archive,verification}));
    return report;
  }finally{try{await host.stop();}finally{unlock();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
