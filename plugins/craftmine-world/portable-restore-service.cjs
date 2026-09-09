// Trusted native backup bridge. No renderer paths or authored code enter here.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(Error(code),{code,errorCode:code});
const POINTER='.craftmine-active-data.json';
const FORMAT='craftmine.restored-data/1';
async function ordinary(target,missing=false) {
  const absolute=path.resolve(target),parsed=path.parse(absolute);
  let cursor=parsed.root;
  for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    const stat=await fs.lstat(cursor).catch(error=>{if(missing&&error.code==='ENOENT')return null;throw error;});
    if(!stat)continue;
    if(stat.isSymbolicLink())throw fail('BACKUP_LINK_DENIED');
  }
  return absolute;
}
async function readJSON(target) {
  await ordinary(target);
  const stat=await fs.lstat(target);if(!stat.isFile()||stat.size>64*1024)throw fail('BACKUP_MARKER_INVALID');
  return JSON.parse(await fs.readFile(target,'utf8'));
}
async function optionalJSON(target) {try{return await readJSON(target);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function writeJSON(target,value) {
  await ordinary(target,true);const temp=target+'.tmp-'+randomUUID();
  const handle=await fs.open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,target);
}
function layout(rootDirectory,operationId) {
  const root=path.resolve(rootDirectory),owner=digest(process.platform==='win32'?root.toLowerCase():root).slice(0,12),operation=digest(operationId).slice(0,16);
  const container=path.join(path.dirname(root),'.craftmine-restored',owner,operation);
  return {root,container,target:path.join(container,'data'),record:path.join(container,'activation.json'),pointer:path.join(root,POINTER)};
}
async function resolveActiveDirectory(rootDirectory) {
  const root=await ordinary(rootDirectory,true),pointer=await optionalJSON(path.join(root,POINTER));
  if(!pointer)return root;
  if(pointer.format!==FORMAT||typeof pointer.operationId!=='string'||!/^[a-f0-9]{64}$/.test(pointer.archiveHash))throw fail('BACKUP_POINTER_INVALID');
  const expected=layout(root,pointer.operationId);
  if(pointer.relativeDirectory!==path.relative(root,expected.target))throw fail('BACKUP_POINTER_INVALID');
  const record=await readJSON(expected.record);
  if(record.format!==FORMAT||record.rootDirectory!==root||record.request?.operationId!==pointer.operationId||record.request?.archiveHash!==pointer.archiveHash||record.target!==expected.target||record.receipt?.status!=='completed'||record.receipt?.archiveHash!==pointer.archiveHash)throw fail('BACKUP_MARKER_INVALID');
  await ordinary(expected.target);
  if(!(await fs.stat(expected.target)).isDirectory())throw fail('BACKUP_TARGET_INVALID');
  return expected.target;
}
async function verifyActiveCore(rootDirectory,directory,call) {
  const record=await readJSON(path.join(path.dirname(directory),'activation.json'));
  if(record.format!==FORMAT||typeof record.request?.operationId!=='string')throw fail('BACKUP_MARKER_INVALID');
  const expected=layout(rootDirectory,record.request.operationId);
  if(record.rootDirectory!==path.resolve(rootDirectory)||expected.target!==directory||record.target!==directory||record.receipt?.status!=='completed'||record.receipt.archiveHash!==record.request.archiveHash)throw fail('BACKUP_MARKER_INVALID');
  const proof=await call('backup.restoreProof',{operationId:record.request.operationId,archiveHash:record.request.archiveHash});
  if(proof.verified!==true||proof.operationId!==record.request.operationId||proof.archiveHash!==record.request.archiveHash||proof.domainHash!==record.receipt.domainHash)throw fail('BACKUP_RESTORE_PROOF_INVALID');
  return proof;
}
function createPortableRestoreService({core,rootDirectory}) {
  if(!core?.exclusive||!path.isAbsolute(rootDirectory))throw fail('BACKUP_HOST_REQUIRED');
  return {
    async restore(input) {
      if(!input||Object.keys(input).some(key=>!['operationId','archivePath','archiveHash','expectedCurrentHash'].includes(key))||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId)||!path.isAbsolute(input.archivePath||'')||!['archiveHash','expectedCurrentHash'].every(key=>/^[a-f0-9]{64}$/.test(input[key])))throw fail('INVALID_PARAMS');
      const request={...input,archivePath:await ordinary(input.archivePath)};
      const locations=layout(rootDirectory,request.operationId);
      await ordinary(locations.container,true);
      await fs.mkdir(locations.container,{recursive:true});
      let record=await optionalJSON(locations.record);
      const requestHash=digest(JSON.stringify(request));
      if(record&&(record.requestHash!==requestHash||record.rootDirectory!==locations.root))throw fail('BACKUP_OPERATION_CONFLICT');
      return core.exclusive(async rpc=>{
        const oldDirectory=rpc.directory();
        if(oldDirectory===locations.target&&record?.receipt?.status==='completed')return {id:request.operationId,status:'completed',activated:true,currentHash:(await rpc.call('backup.status',{})).currentHash,archiveHash:request.archiveHash,rebuildRequired:record.receipt.rebuildRequired??[],modelReplay:false};
        const current=await rpc.call('backup.status',{});
        if(current.currentHash!==request.expectedCurrentHash)throw fail('BACKUP_CURRENT_HASH_CONFLICT');
        const verified=await rpc.call('backup.verifyPortable',{archivePath:request.archivePath});
        if(verified.valid!==true||verified.archiveHash!==request.archiveHash)throw fail('BACKUP_FILE_CHANGED');
        if(!record) {record={format:FORMAT,rootDirectory:locations.root,request,requestHash,target:locations.target,previousDirectory:oldDirectory};await writeJSON(locations.record,record);}
        if(!record.receipt) {
          const receipt=await rpc.call('backup.restorePortable',{operationId:request.operationId,archivePath:request.archivePath,targetDirectory:locations.target});
          if(receipt.status!=='completed'||receipt.archiveHash!==request.archiveHash||typeof receipt.targetDirectory!=='string'||await fs.realpath(receipt.targetDirectory)!==await fs.realpath(locations.target))throw fail('BACKUP_RESTORE_RECEIPT_INVALID');
          record.receipt=receipt;await writeJSON(locations.record,record);
        }
        const oldPointer=await optionalJSON(locations.pointer);
        try {
          await rpc.switchDirectory(locations.target);
          const status=await verifyActiveCore(rootDirectory,locations.target,rpc.call);
          // Publish only after the restored core actually opened and proved its state.
          await writeJSON(locations.pointer,{format:FORMAT,operationId:request.operationId,archiveHash:request.archiveHash,relativeDirectory:path.relative(locations.root,locations.target)});
          return {id:request.operationId,status:'completed',activated:true,currentHash:status.currentHash,archiveHash:request.archiveHash,rebuildRequired:record.receipt.rebuildRequired??[],modelReplay:false};
        } catch(error) {
          try {
            if(oldPointer)await writeJSON(locations.pointer,oldPointer);
            else await fs.unlink(locations.pointer).catch(e=>{if(e.code!=='ENOENT')throw e;});
            await rpc.switchDirectory(oldDirectory);
          } catch(rollbackError) {throw Object.assign(new AggregateError([error,rollbackError],'BACKUP_ACTIVATION_ROLLBACK_FAILED',{cause:error}),{code:'BACKUP_ACTIVATION_ROLLBACK_FAILED'});}
          throw error;
        }
      });
    },
  };
}
module.exports={createPortableRestoreService,resolveActiveDirectory,verifyActiveCore};
