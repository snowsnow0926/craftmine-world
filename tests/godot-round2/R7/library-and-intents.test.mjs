// Asset-library and creation-package binding tests.
// No engine, no Rust binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {createLibraryBinding,validateAssetRef,validateTarget,ASSET_METHODS,PACKAGE_METHODS,
  PACKAGE_WRITE_METHODS}=require(path.join(root,'plugins/craftmine-world/godot-library.cjs'));

const HASH='a'.repeat(64);
const CONTEXT={projectId:'project',sessionId:'session',turnId:'turn'};
const REF={assetId:'door-kit',version:2,contentHash:HASH};

function binding(handlers={}){
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});
    if(Object.hasOwn(handlers,method))return handlers[method];
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});}};
  return {calls,library:createLibraryBinding({core,context:CONTEXT,worldId:'alpha'})};
}

test('method names come from the delivered R6/R4 interfaces',()=>{
  assert.deepEqual(ASSET_METHODS,{search:'asset.search',read:'asset.read',versions:'asset.versions'});
  assert.deepEqual(PACKAGE_METHODS,{check:'package.check',read:'package.read',list:'package.list'});
  assert.deepEqual(PACKAGE_WRITE_METHODS,{install:'package.install',register:'package.register',
    upgrade:'package.upgrade',restore:'package.restore'});
});

test('an asset reference is exact and never latest',()=>{
  assert.deepEqual(validateAssetRef(REF),REF);
  assert.throws(()=>validateAssetRef({...REF,extra:1}),/INVALID_ASSET_REF_FIELDS/);
  assert.throws(()=>validateAssetRef({assetId:'latest',version:1,contentHash:HASH}),/ASSET_REF_MUST_NOT_BE_LATEST/);
  assert.throws(()=>validateAssetRef({assetId:'x',version:0,contentHash:HASH}),/INVALID_ASSET_VERSION/);
  assert.throws(()=>validateAssetRef({assetId:'x',version:1,contentHash:'nope'}),/INVALID_ASSET_CONTENT_HASH/);
});

test('a package target requires a base and an engine',()=>{
  assert.deepEqual(validateTarget({base:'top-down',engine:'4.7.2-stable'}),
    {base:'top-down',engine:'4.7.2-stable'});
  assert.throws(()=>validateTarget({base:'top-down'}),/PACKAGE_TARGET_REQUIRES_BASE_AND_ENGINE/);
});

test('asset search binds the world scope host-side and validates the vocabulary',()=>{
  const {calls,library}=binding();
  library.assetSearch({scope:'current-world',query:'door',kind:'object',mediaKind:'model',limit:5});
  const call=calls[0];
  assert.equal(call.method,'asset.search');
  assert.equal(call.params.worldId,'alpha');
  assert.equal(call.params.scope,'current-world');
  assert.equal(call.params.limit,5);
  assert.throws(()=>library.assetSearch({scope:'everything'}),/INVALID_ASSET_SCOPE/);
  assert.throws(()=>library.assetSearch({scope:'local-library',kind:'nope'}),/INVALID_ASSET_KIND/);
  assert.throws(()=>library.assetSearch({scope:'local-library',mediaKind:'nope'}),/INVALID_ASSET_MEDIA_KIND/);
});

test('a local-library search is not pointed at the bound world',()=>{
  const {calls,library}=binding();
  library.assetSearch({scope:'local-library',query:'door'});
  assert.ok(!('worldId' in calls[0].params),'a global search must not claim a world scope');
});

test('omitted search scope uses the local library without weakening explicit scope checks',async()=>{
  const {calls,library}=binding({'asset.search':{items:[]}});
  await library.assetSearch({query:'dog',mediaKind:'model',limit:12});
  assert.deepEqual(calls[0],{method:'asset.search',params:{scope:'local-library',offset:0,limit:12,query:'dog',mediaKind:'model'}});
  for(const scope of [null,'',false,'everything'])assert.throws(()=>library.assetSearch({scope}),/INVALID_ASSET_SCOPE/);
  assert.equal(calls.length,1);
});

test('a missing library adapter names the exact method and owner',async()=>{
  const {library}=binding();
  const search=await library.assetSearch({scope:'local-library'});
  assert.equal(search.available,false);
  assert.equal(search.reason,'DEPENDENCY_NOT_WIRED');
  assert.equal(search.requiredHostMethod,'asset.search');
  assert.equal(search.owner,'R6');
  const check=await library.packageCheck({ref:REF,target:{base:'top-down',engine:'4.7.2-stable'}});
  assert.equal(check.requiredHostMethod,'package.check');
  assert.equal(check.owner,'R4');
  const list=await library.packageList({});
  assert.equal(list.requiredHostMethod,'package.list');
  assert.equal(list.requiredHostMethod.startsWith('package.'),true);
});

test('a registered adapter is called with the exact arguments',async()=>{
  const {calls,library}=binding({'asset.read':{assetId:'door-kit',version:2,state:{indexed:true}}});
  const read=await library.assetRead({assetId:'door-kit',version:2});
  assert.equal(read.available,true);
  assert.deepEqual(calls[0],{method:'asset.read',params:{assetId:'door-kit',version:2}});
});

test('install, variant, upgrade and restore are proposals that never apply',()=>{
  const {calls,library}=binding();
  const install=library.proposeInstall({ref:REF});
  assert.equal(install.method,'package.install');
  assert.equal(install.params.worldId,'alpha');
  assert.equal(install.params.mode,'initial');
  assert.equal(install.applies,false);
  assert.equal(install.requiresPlayerAction,true);

  const copy=library.proposeInstall({ref:REF,mode:'copy',sourceInstanceId:'ins-1'});
  assert.equal(copy.params.sourceInstanceId,'ins-1');
  assert.throws(()=>library.proposeInstall({ref:REF,mode:'copy'}),/COPY_MODE_REQUIRES_SOURCE_INSTANCE/);
  assert.throws(()=>library.proposeInstall({ref:REF,mode:'magic'}),/INVALID_INSTALL_MODE/);

  const variant=library.proposeVariant({ref:REF,name:'door-hard'});
  assert.equal(variant.method,'package.register');
  assert.equal(variant.params.name,'door-hard');
  assert.equal(variant.createsVariant,undefined);

  const upgrade=library.proposeUpgrade({ref:REF,instanceId:'ins-1'});
  assert.equal(upgrade.method,'package.upgrade');
  assert.deepEqual(upgrade.params.toRef,REF);

  const content=library.proposeRestoreContent({instanceId:'ins-1'});
  assert.equal(content.method,'package.restore');
  const save=library.proposeRestoreSave({progressRef:{revision:7,contentHash:'b'.repeat(64)}});
  assert.equal(save.method,'backup.restore');
  assert.equal(save.owner,'R5');
  assert.deepEqual(calls,[],'a proposal must not reach the host');
});

test('every proposal records the host-bound world',()=>{
  const {library}=binding();
  for(const proposal of [
    library.proposeInstall({ref:REF}),
    library.proposeVariant({ref:REF,name:'v2'}),
    library.proposeUpgrade({ref:REF,instanceId:'ins-1'}),
    library.proposeRestoreContent({instanceId:'ins-1'}),
    library.proposeRestoreSave({progressRef:{revision:1,contentHash:'b'.repeat(64)}}),
    library.proposeChange({intent:'upgrade-selected',ref:REF,selection:['ins-1','ins-2']})
  ])assert.equal(proposal.params.worldId,'alpha','a proposal must name the bound world');
});

test('the five change intents dispatch to distinct proposals',()=>{
  const {library}=binding();
  assert.equal(library.proposeChange({intent:'instance-only',ref:REF}).proposal,'install');
  assert.equal(library.proposeChange({intent:'variant',ref:REF,target:{name:'v2'}}).proposal,'variant');
  const upgrade=library.proposeChange({intent:'upgrade-selected',ref:REF,selection:['ins-1','ins-2']});
  assert.equal(upgrade.proposal,'upgrade-selected');
  assert.equal(upgrade.params.targets.length,2);
  assert.equal(library.proposeChange({intent:'restore-content',selection:['ins-1']}).proposal,'restore-content');
  assert.equal(library.proposeChange({intent:'restore-save'}).proposal,'restore-save');
  assert.throws(()=>library.proposeChange({intent:'upgrade-selected',ref:REF,selection:[]}),/UPGRADE_SELECTED_REQUIRES_SELECTION/);
  assert.throws(()=>library.proposeChange({intent:'instance-only',ref:REF,selection:['a','b']}),/INSTANCE_ONLY_REQUIRES_EXACTLY_ONE_INSTANCE/);
});
