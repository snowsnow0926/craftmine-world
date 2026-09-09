// Model-facing bindings for the fixed asset library (R6) and creation packages
// (R4). Every method name below is taken from the delivered interface documents,
// not invented. When the core has not registered a method yet, the call returns
// a precise dependency gap instead of fabricated content.
//
// Read-only retrieval is exposed to the model. Install, upgrade, variant and
// restore are PROPOSALS: they name the real host method, carry a host-bound
// OperationContext, and never apply anything.
'use strict';
const {validateChangeIntent,CHANGE_INTENTS}=require('./godot-history.cjs');

const LIBRARY_FORMAT='craftmine.godot-library/1';
const ASSET_METHODS={search:'asset.search',read:'asset.read',versions:'asset.versions'};
const PACKAGE_METHODS={check:'package.check',read:'package.read',list:'package.list'};
const PACKAGE_WRITE_METHODS={install:'package.install',register:'package.register',upgrade:'package.upgrade',
  restore:'package.restore'};
const OWNERS={asset:'R6',package:'R4'};
const ASSET_SCOPES=['current-world','local-library','import-source'];
const ASSET_KINDS=['raw','object','creation','world-template'];
const ASSET_MEDIA_KINDS=['image','model','audio','package','other'];
const HASH=/^[a-f0-9]{64}$/;

function fail(code){ throw Object.assign(Error(code),{errorCode:code}); }
function isPlain(value){ return value!==null&&typeof value==='object'&&!Array.isArray(value); }
function boundedString(value,max){ if(typeof value!=='string'||!value.trim()||value.length>max)fail('INVALID_TEXT');return value; }

// An exact immutable version. `latest` is never a valid reference.
function validateAssetRef(ref){
  if(!isPlain(ref))fail('INVALID_ASSET_REF');
  const keys=Object.keys(ref).sort();
  if(keys.join(',')!=='assetId,contentHash,version')fail('INVALID_ASSET_REF_FIELDS');
  const assetId=boundedString(ref.assetId,128);
  if(assetId==='latest'||assetId==='*')fail('ASSET_REF_MUST_NOT_BE_LATEST');
  if(!Number.isSafeInteger(ref.version)||ref.version<1)fail('INVALID_ASSET_VERSION');
  if(typeof ref.contentHash!=='string'||!HASH.test(ref.contentHash))fail('INVALID_ASSET_CONTENT_HASH');
  return {assetId,version:ref.version,contentHash:ref.contentHash};
}

function validateTarget(target){
  if(!isPlain(target))fail('INVALID_PACKAGE_TARGET');
  const out={};
  for(const key of ['base','baseVersion','engine','stateFormat']){
    if(target[key]===undefined)continue;
    out[key]=boundedString(target[key],120);
  }
  if(!out.base||!out.engine)fail('PACKAGE_TARGET_REQUIRES_BASE_AND_ENGINE');
  return out;
}

function createLibraryBinding({core,context,worldId,methods={}}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  if(typeof worldId!=='string'||!worldId)throw Error('WORLD_ID_REQUIRED');
  const asset={...ASSET_METHODS,...(methods.asset||{})};
  const pkg={...PACKAGE_METHODS,...(methods.package||{})};
  const writes={...PACKAGE_WRITE_METHODS,...(methods.write||{})};

  // A registered method is called; an unregistered one is reported, never faked.
  async function probe(group,key,params,owner){
    const method=(group==='asset'?asset:pkg)[key];
    try { return {format:LIBRARY_FORMAT,group,method,available:true,result:await core.call(method,params)}; }
    catch(error){
      if(error?.errorCode==='UNKNOWN_METHOD')return {format:LIBRARY_FORMAT,group,method,available:false,
        reason:'DEPENDENCY_NOT_WIRED',requiredHostMethod:method,owner,
        nextStep:'The '+owner+' adapter must register '+method+' in main.rs before this capability is usable.'};
      throw error;
    }
  }

  function proposal(kind,method,params,extra){
    return {format:LIBRARY_FORMAT,proposal:kind,method,params,applies:false,requiresPlayerAction:true,
      owner:OWNERS[method.startsWith('asset.')?'asset':'package'],
      note:'The model proposes; the host performs the write under its own identity.',...extra};
  }

  return {
    assetSearch(args={}){
      if(!ASSET_SCOPES.includes(args.scope))fail('INVALID_ASSET_SCOPE');
      if(args.kind!==undefined&&!ASSET_KINDS.includes(args.kind))fail('INVALID_ASSET_KIND');
      if(args.mediaKind!==undefined&&!ASSET_MEDIA_KINDS.includes(args.mediaKind))fail('INVALID_ASSET_MEDIA_KIND');
      const params={scope:args.scope,offset:args.offset??0,limit:args.limit??20};
      // The world scope is host-bound; the model cannot point it at another world.
      if(args.scope==='current-world')params.worldId=worldId;
      for(const key of ['query','kind','mediaKind','tags','favoritesOnly','latestOnly'])if(args[key]!==undefined)params[key]=args[key];
      return probe('asset','search',params,OWNERS.asset);
    },
    assetRead(args={}){
      return probe('asset','read',{assetId:boundedString(args.assetId,128),version:args.version},OWNERS.asset);
    },
    assetVersions(args={}){
      return probe('asset','versions',{assetId:boundedString(args.assetId,128),offset:args.offset??0,
        limit:args.limit??20},OWNERS.asset);
    },
    packageCheck(args={}){
      return probe('package','check',{ref:validateAssetRef(args.ref),target:validateTarget(args.target)},OWNERS.package);
    },
    packageRead(args={}){
      return probe('package','read',{instanceId:boundedString(args.instanceId,120)},OWNERS.package);
    },
    packageList(args={}){
      return probe('package','list',{worldId,offset:args.offset??0,limit:args.limit??20,...(args.status?{status:args.status}:{})},OWNERS.package);
    },
    // Proposals only. Each names the real host method and its exact arguments.
    proposeInstall({ref,mode='initial',sourceInstanceId,position,operationId}={}){
      const fixedRef=validateAssetRef(ref);
      if(mode!=='initial'&&mode!=='copy')fail('INVALID_INSTALL_MODE');
      if(mode==='copy'&&!sourceInstanceId)fail('COPY_MODE_REQUIRES_SOURCE_INSTANCE');
      const params={operationId:operationId||'proposal-install',ref:fixedRef,worldId,mode,
        ...(sourceInstanceId?{sourceInstanceId}:{}),...(position?{position}:{})};
      return proposal('install',writes.install,params,{mode});
    },
    proposeVariant({ref,name,operationId}={}){
      const fixedRef=validateAssetRef(ref);
      return proposal('variant',writes.register,{operationId:operationId||'proposal-variant',ref:fixedRef,
        name:boundedString(name,240)}, {note:'A variant gets a new asset id and does not inherit instance progress.'});
    },
    proposeUpgrade({ref,instanceId,operationId}={}){
      return proposal('upgrade',writes.upgrade,{operationId:operationId||'proposal-upgrade',
        instanceId:boundedString(instanceId,120),toRef:validateAssetRef(ref)},
      {note:'Each selected instance is checked separately; a pass for one instance does not transfer to another.'});
    },
    proposeRestoreContent({instanceId,operationId}={}){
      return proposal('restore-content',writes.restore,{operationId:operationId||'proposal-restore-content',
        instanceId:boundedString(instanceId,120)},
      {note:'Restores an uninstalled package instance; world progress is untouched.'});
    },
    proposeRestoreSave({progressRef,operationId}={}){
      return proposal('restore-save','backup.restore',{operationId:operationId||'proposal-restore-save',
        progressRef:progressRef??null},
      {owner:'R5',note:'Restoring confirmed world progress is a player action over a verified backup; the model only proposes it.'});
    },
    // One entry point for the five natural-language change intents. The scope is
    // validated first, so "only this one" cannot silently become "all selected".
    proposeChange({intent,ref,selection,target,instanceId,name,progressRef,operationId}={}){
      // For `instance-only` the bound world is the one and only install target;
      // it is host-bound, not a model-chosen scope.
      const scoped=intent==='instance-only'?(selection??[worldId]):selection;
      const change=validateChangeIntent({intent,selection:scoped,target});
      if(intent==='instance-only')return {...this.proposeInstall({ref,operationId}),change};
      if(intent==='variant')return {...this.proposeVariant({ref,name:target?.name,operationId}),change};
      if(intent==='upgrade-selected')return {...proposal('upgrade-selected',writes.upgrade,
        {operationId:operationId||'proposal-upgrade-selected',
          targets:change.instances.map(one=>({instanceId:one,toRef:validateAssetRef(ref)}))},
        {owner:OWNERS.package,note:change.note}),change};
      if(intent==='restore-content')return {...this.proposeRestoreContent({instanceId:instanceId??change.instances[0],operationId}),change};
      return {...this.proposeRestoreSave({progressRef,operationId}),change};
    }
  };
}

module.exports={LIBRARY_FORMAT,ASSET_METHODS,PACKAGE_METHODS,PACKAGE_WRITE_METHODS,OWNERS,ASSET_SCOPES,
  ASSET_KINDS,ASSET_MEDIA_KINDS,CHANGE_INTENTS,validateAssetRef,validateTarget,createLibraryBinding};
