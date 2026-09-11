// Modern asset-catalog ZIPs are not legacy craftmine_library packages.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {validateAssetRef}=require('./godot-library.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const MAX_ZIP=5*1024*1024;
const check=(yes,code)=>{if(!yes)throw Error(code);};
const exact=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),'SOURCE_LIBRARY_INVALID_PARAMS');
const id=value=>check(typeof value==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(value),'SOURCE_LIBRARY_INVALID_PROPOSAL');
async function atomic(file,value){const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,file);}

function createSourceLibraryService({call,directory,installSource,ensureBuiltin=async()=>{}}){
  check(typeof call==='function'&&path.isAbsolute(directory)&&typeof installSource==='function','SOURCE_LIBRARY_HOST_REQUIRED');
  const pending=new Map();
  async function readArchive(ref){
    await ensureBuiltin();
    ref=validateAssetRef(ref);
    const record=await call('asset.read',{assetId:ref.assetId,version:ref.version});
    const version=record.version_;
    check(version?.assetId===ref.assetId&&version.version===ref.version&&version.contentHash===ref.contentHash,'SOURCE_LIBRARY_ASSET_CHANGED');
    check(version.mediaKind==='package'&&version.files?.length===1,'SOURCE_LIBRARY_NOT_SOURCE_PACKAGE');
    const file=version.files[0];check(file.mediaType==='application/x-godot-package'&&file.bytes<=MAX_ZIP,'SOURCE_LIBRARY_NOT_SOURCE_PACKAGE');
    const body=await call('asset.bodyPath',{assetId:ref.assetId,version:ref.version,path:file.path});
    check(body.sha256===file.sha256&&body.bytes===file.bytes&&body.mediaType===file.mediaType&&path.isAbsolute(body.blobPath),'SOURCE_LIBRARY_BODY_MISMATCH');
    const stat=await fs.lstat(body.blobPath);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.bytes,'SOURCE_LIBRARY_BODY_MISMATCH');
    const bytes=await fs.readFile(body.blobPath);check(bytes.length===file.bytes&&hash(bytes)===file.sha256,'SOURCE_LIBRARY_BODY_MISMATCH');
    const {unpackStaticPackage}=await import('./package-zip.mjs');
    const archive=unpackStaticPackage(bytes,{maxEntryBytes:4*1024*1024,maxTotalBytes:6*1024*1024,maxCompressedBytes:6*1024*1024,maxEntries:1024});
    return {bytes,archive,record};
  }
  function describe(ref,{archive,record}){
    return {format:'craftmine.source-library/1',archiveRef:ref,archiveSha256:archive.archiveSha256,
      rootRef:archive.packageJson.root,displayName:record.version_.displayName,source:record.version_.source,
      placement:{status:'template-default',capturedPlayerTargetUsed:false,note:'Installation uses the component template placement. This proposal does not implement a player request to place here. Use actual installed instance identities and normal source editing for later placement.'},
      resources:archive.resources.map(({manifest})=>({ref:{assetId:manifest.content.assetId,version:manifest.content.version,contentHash:manifest.contentHash},
        kind:manifest.content.kind,entry:manifest.content.entry,interfaces:manifest.content.interfaces,compatibility:manifest.content.compatibility,state:manifest.content.state,licenses:manifest.content.licenses,
        files:manifest.content.files})),verifiedScope:'archive-integrity-only',applied:false,
      note:'Archive validity is not target compatibility, runtime success or visual verification. Installing still requires a player action, source checks and candidate adoption.'};
  }
  const projection=p=>({proposalId:p.proposalId,worldId:p.worldId,archiveRef:p.ref,archiveSha256:p.archiveSha256,displayName:p.displayName,source:p.source,...(p.position?{position:p.position}:{}),applied:false,requiresPlayerAction:true,method:'installSourceProposal',status:p.result?.status??'proposed'});
  async function load(proposalId){id(proposalId);return JSON.parse(await fs.readFile(path.join(directory,proposalId+'.json'),'utf8'));}
  return {
    async tool(args,context,worldId,toolCallId){
      exact(args,['mode','query','offset','limit','ref','position']);
      if(args.position!==undefined){exact(args.position,['x','y','z']);check(args.mode==='propose'&&['x','y','z'].every(key=>Number.isFinite(args.position[key])&&Math.abs(args.position[key])<=80),'SOURCE_LIBRARY_INVALID_POSITION');}
      if(args.mode==='search'){
        await ensureBuiltin();
        check(args.query===undefined||typeof args.query==='string'&&args.query.length<=120,'SOURCE_LIBRARY_INVALID_PARAMS');
        const offset=args.offset??0,limit=args.limit??20;check(Number.isSafeInteger(offset)&&offset>=0&&offset<=4096&&Number.isSafeInteger(limit)&&limit>=1&&limit<=24,'SOURCE_LIBRARY_INVALID_PARAMS');
        return {format:'craftmine.source-library/1',namespace:'asset-catalog-source-zip',result:await call('asset.search',{scope:'local-library',mediaKind:'package',query:args.query??'',offset,limit}),note:'Use read with the exact catalog AssetRef; this is not the legacy package_library store.'};
      }
      check(['read','propose'].includes(args.mode),'SOURCE_LIBRARY_INVALID_MODE');
      const ref=validateAssetRef(args.ref),archive=await readArchive(ref),summary=describe(ref,archive);
      if(args.mode==='read')return summary;
      if(args.position)check(archive.archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall).length===1,'SOURCE_LIBRARY_POSITION_REQUIRES_SINGLE_INSTANCE');
      if(args.position)summary.placement={status:'explicit-position',position:{...args.position},capturedPlayerTargetUsed:false};
      check(typeof toolCallId==='string'&&toolCallId.length>0,'SOURCE_LIBRARY_INVOCATION_REQUIRED');
      const source=await call('godotProject.index',{context,worldId,offset:0,limit:1});
      check(source.worldId===worldId&&Number.isSafeInteger(source.revision)&&/^[a-f0-9]{64}$/.test(source.manifestHash),'SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
      const proposalId='source-'+hash(JSON.stringify([context,toolCallId])).slice(0,48);
      await fs.mkdir(directory,{recursive:true});
      const proposal={format:'craftmine.source-proposal/1',proposalId,context,worldId,ref,archiveSha256:archive.archive.archiveSha256,displayName:summary.displayName,
        source:{revision:source.revision,manifestHash:source.manifestHash},...(args.position?{position:{x:args.position.x,y:args.position.y,z:args.position.z}}:{})};
      try{const prior=await load(proposalId);check(JSON.stringify({...prior,result:undefined})===JSON.stringify(proposal),'SOURCE_LIBRARY_PROPOSAL_CONFLICT');return {...summary,proposal:projection(prior)};}
      catch(error){if(error.code!=='ENOENT')throw error;}
      await atomic(path.join(directory,proposalId+'.json'),proposal);
      return {...summary,proposal:projection(proposal)};
    },
    async proposals(args){exact(args,['worldId']);check(typeof args.worldId==='string','SOURCE_LIBRARY_INVALID_PARAMS');await fs.mkdir(directory,{recursive:true});const names=await fs.readdir(directory),items=[];
      for(const name of names.filter(n=>/^source-[a-f0-9]{48}\.json$/.test(n)).slice(-256)){const p=await load(name.slice(0,-5));if(p.worldId===args.worldId&&!p.result)items.push(projection(p));}
      return {worldId:args.worldId,items,format:'craftmine.source-proposals/1'};
    },
    async installProposal(args){
      exact(args,['worldId','proposalId']);id(args.proposalId);
      const proposal=await load(args.proposalId);check(proposal.worldId===args.worldId,'SOURCE_LIBRARY_WORLD_MISMATCH');
      if(proposal.result)return proposal.result;
      if(pending.has(args.proposalId))return pending.get(args.proposalId);
      const run=(async()=>{
        const archive=await readArchive(proposal.ref);check(archive.archive.archiveSha256===proposal.archiveSha256,'SOURCE_LIBRARY_ASSET_CHANGED');
        const result=await installSource({worldId:proposal.worldId,operationId:proposal.proposalId,archiveBase64:archive.bytes.toString('base64'),expectedSource:proposal.source,...(proposal.position?{position:proposal.position}:{})});
        check(result.worldId===proposal.worldId&&result.applied===false&&result.archiveSha256===proposal.archiveSha256,'SOURCE_LIBRARY_INSTALL_RECEIPT_INVALID');
        proposal.result=result;await atomic(path.join(directory,proposal.proposalId+'.json'),proposal);return result;
      })().finally(()=>pending.delete(args.proposalId));pending.set(args.proposalId,run);return run;
    },
  };
}
module.exports={createSourceLibraryService};
