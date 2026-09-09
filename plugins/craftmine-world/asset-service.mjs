import {createHash} from 'node:crypto';
// Asset library service for the craftmine.world plugin.
//
// Forwards asset.* channels to the trusted core process and runs preview
// decoding through an injected worker runner. It never opens a window,
// requests pointer lock, sends input or plays audio.
//
// Cache identity and execution identity are separate. The cache key is derived
// from content hash + previewer + engine + settings; the attempt is a claim the
// core issues per run. Every begin, decode, cancel and retry is bound to that
// claim, so a retry can never replay the previous attempt's result and a late
// worker result can never overwrite a cancel or a newer attempt.
const FORWARDED = [
  'asset.search',
  'asset.read',
  'asset.versions',
  'asset.usage',
  'asset.annotate',
  'asset.scan',
  'asset.import',
  'asset.previewRead',
  'asset.probe',
  'asset.mapLegacy',
  'asset.resolveLegacy',
  'asset.recordUsage',
  'asset.recordCheck',
];

export const SERVICE_OWNER = 'craftmine.world/asset-service';

function requireText(value, key) {
  const text = value?.[key];
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`${key.toUpperCase()}_REQUIRED`);
  return text;
}

function requireVersion(value) {
  const version = value?.version;
  if (!Number.isInteger(version) || version < 1) throw new Error('VERSION_REQUIRED');
  return version;
}

function channelFor(method) {
  if (!FORWARDED.includes(method)) throw new Error(`UNSUPPORTED_ASSET_CHANNEL: ${method}`);
  return method;
}

function requireClaim(begun) {
  const claim = begun?.claim;
  if (!claim || typeof claim.claimId !== 'string' || claim.claimId === '') {
    throw new Error('PREVIEW_CLAIM_REQUIRED');
  }
  if (!Number.isInteger(claim.attempt) || claim.attempt < 1) {
    throw new Error('PREVIEW_CLAIM_REQUIRED');
  }
  return claim;
}

export function createAssetService({call,runPreview,readFile,cancelPreview,owner=SERVICE_OWNER}) {
  if(typeof call!=='function'||typeof runPreview!=='function')throw Error('ASSET_SERVICE_DEPENDENCIES_REQUIRED');
  const running=new Map();
  const keyOf=args=>JSON.stringify([args.assetId,args.version,args.path??null,args.settingsHash??'default',args.engineVersion??'unknown']);
  const forward=method=>args=>call(channelFor(method),args??{});
  const api={search:forward('asset.search'),read:forward('asset.read'),versions:forward('asset.versions'),usage:forward('asset.usage'),annotate:forward('asset.annotate'),scan:forward('asset.scan'),importAsset:forward('asset.import'),previewRead:forward('asset.previewRead'),probe:forward('asset.probe'),resolveLegacy:forward('asset.resolveLegacy'),recordUsage:forward('asset.recordUsage'),recordCheck:forward('asset.recordCheck')};
  async function finish(entry,evidence,cancel=false) {
    return call('asset.previewFinish',{operationId:(cancel?'preview-cancel-':'preview-')+entry.jobId,assetId:entry.assetId,version:entry.version,settingsHash:entry.settingsHash,claimId:entry.claim.claimId,attempt:entry.claim.attempt,status:evidence.status,detail:evidence.detail??'',facts:evidence.facts??{}});
  }
  api.preview=async args=>{
    const assetId=requireText(args,'assetId'),version=requireVersion(args),key=keyOf(args);
    if(running.has(key))return running.get(key).promise;
    const entry={assetId,version,controller:new AbortController()};running.set(key,entry);
    entry.promise=(async()=>{
      let begun;
      try {
        const record=await call('asset.read',{assetId,version});
        const files=record?.version_?.files??[];
        const file=args.path?files.find(f=>f.path===args.path):files[0];
        if(!file)throw Error('ASSET_FILE_NOT_FOUND');
        entry.settingsHash=createHash('sha256').update(JSON.stringify([file.path,file.sha256,args.settingsHash??'default',args.engineVersion??'unknown'])).digest('hex');
        begun=await call('asset.previewBegin',{assetId,version,settingsHash:entry.settingsHash,owner,force:args.force===true});
        if(begun.cached&&begun.preview?.status!=='pending')return {...begun.preview,cached:true,applied:true,stale:false};
        entry.claim=requireClaim(begun);entry.jobId=begun.cacheKey+'-a'+entry.claim.attempt+'-'+entry.claim.claimId;
        const request={jobId:entry.jobId,assetId,version,path:file.path,settingsHash:entry.settingsHash,engineVersion:args.engineVersion??'unknown',attempt:entry.claim.attempt,claimId:entry.claim.claimId};
        let evidence;
        if(entry.controller.signal.aborted)evidence={status:'cancelled',detail:'PREVIEW_CANCELLED',facts:{}};
        else {
          // Legacy in-process tests can provide a byte reader; production sends
          // only a resource identity and the host resolves its managed body.
          if(readFile){const body=await call('asset.bodyPath',{assetId,version,path:file.path});request.bytes=await readFile(body.blobPath);request.mediaType=file.mediaType;request.contentHash=record.version_.contentHash;}
          evidence=await runPreview(request,{timeoutMs:begun.timeoutMs,signal:entry.controller.signal});
        }
        const receipt=await finish(entry,evidence);
        return {...evidence,cached:false,retried:begun.retried===true,applied:receipt?.applied!==false,stale:receipt?.applied===false,reason:receipt?.reason,attempt:entry.claim.attempt};
      } catch(error) {
        if(entry.claim){const evidence={status:entry.controller.signal.aborted?'cancelled':'failed',detail:String(error.message??error).slice(0,200),facts:{}};await finish(entry,evidence);return {...evidence,applied:true,stale:false};}
        throw error;
      } finally{if(running.get(key)===entry)running.delete(key);}
    })();return entry.promise;
  };
  api.cancel=async args=>{
    const entry=running.get(keyOf(args));
    if(!entry)return {cancelled:false,applied:false,reason:'NO_ACTIVE_ATTEMPT'};
    const closing=entry.claim?finish(entry,{status:'cancelled',detail:args.detail??'PREVIEW_CANCELLED',facts:{abortSignalled:true}},true):null;
    entry.controller.abort();
    if(entry.jobId&&cancelPreview)await cancelPreview({jobId:entry.jobId});
    if(closing){const result=await closing;return {...result,cancelled:result?.applied!==false,abortSignalled:true};}
    return {cancelled:true,applied:false,abortSignalled:true};
  };
  return api;
}
