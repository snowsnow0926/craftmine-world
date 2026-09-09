// Main-process asset preview. The plugin sends managed identities, never OS paths or bytes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runPreviewInWorker} from './preview-worker.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES=64*1024*1024;
export function createAssetPreviewHost({resolveBody,runPreview=runPreviewInWorker}) {
  if(typeof resolveBody!=='function')throw Error('ASSET_BODY_RESOLVER_REQUIRED');
  const active=new Map(),cancelled=new Set();let disposed=false;
  function identity(input){
    if(!input||Object.keys(input).some(k=>!['jobId','assetId','version','path','settingsHash','engineVersion','attempt','claimId'].includes(k))||typeof input.jobId!=='string'||!input.jobId||input.jobId.length>240||typeof input.assetId!=='string'||!Number.isSafeInteger(input.version)||input.version<1||typeof input.path!=='string'||!Number.isSafeInteger(input.attempt)||input.attempt<1||typeof input.claimId!=='string'||!input.claimId)throw Error('INVALID_ASSET_PREVIEW_REQUEST');
    return JSON.stringify(input);
  }
  return {
    preview(input){
      if(disposed)throw Error('ASSET_PREVIEW_HOST_DISPOSED');
      const binding=identity(input),existing=active.get(input.jobId);
      if(existing){if(existing.binding!==binding)throw Error('ASSET_PREVIEW_JOB_CONFLICT');return existing.promise;}
      if(active.size>=8)throw Error('ASSET_PREVIEW_BUSY');
      const controller=new AbortController();
      if(cancelled.has(input.jobId))controller.abort();
      const entry={binding,controller};active.set(input.jobId,entry);
      entry.promise=(async()=>{
        if(controller.signal.aborted)return {status:'cancelled',detail:'PREVIEW_CANCELLED',facts:{}};
        const body=await resolveBody({assetId:input.assetId,version:input.version,path:input.path});
        if(typeof body?.blobPath!=='string'||!path.isAbsolute(body.blobPath)||!Number.isSafeInteger(body.bytes)||body.bytes<0||body.bytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(body.sha256))throw Error('INVALID_ASSET_BODY_HANDLE');
        // Refuse links in every existing component of the trusted resolver's path.
        let part=path.parse(body.blobPath).root;
        for(const name of body.blobPath.slice(part.length).split(path.sep)){part=path.join(part,name);if((await fs.lstat(part)).isSymbolicLink())throw Error('ASSET_BODY_LINK_REFUSED');}
        const handle=await fs.open(body.blobPath,'r');let bytes;
        try {const stat=await handle.stat();if(!stat.isFile()||stat.size!==body.bytes)throw Error('CORRUPT_ASSET_BODY');const buffer=Buffer.alloc(body.bytes+1);let offset=0;while(offset<buffer.length){const read=await handle.read(buffer,offset,buffer.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}bytes=buffer.subarray(0,offset);}finally{await handle.close();}
        if(bytes.length!==body.bytes||sha(bytes)!==body.sha256)throw Error('CORRUPT_ASSET_BODY');
        if(controller.signal.aborted)return {status:'cancelled',detail:'PREVIEW_CANCELLED',facts:{}};
        return await runPreview({...input,bytes,mediaType:body.mediaType,contentHash:body.contentHash??body.sha256},{timeoutMs:20000,signal:controller.signal});
      })().finally(()=>{if(active.get(input.jobId)===entry)active.delete(input.jobId);});
      return entry.promise;
    },
    async cancel(input){
      if(!input||Object.keys(input).some(k=>k!=='jobId')||typeof input.jobId!=='string'||!input.jobId||input.jobId.length>240)throw Error('INVALID_ASSET_PREVIEW_JOB');
      cancelled.add(input.jobId);if(cancelled.size>256)cancelled.delete(cancelled.values().next().value);
      const entry=active.get(input.jobId);entry?.controller.abort();
      return {jobId:input.jobId,cancelled:!!entry};
    },
    async dispose(){disposed=true;for(const entry of active.values())entry.controller.abort();await Promise.allSettled([...active.values()].map(e=>e.promise));cancelled.clear();},
  };
}
