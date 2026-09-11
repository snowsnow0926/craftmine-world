// Capability inventory and gap-classification tests.
// No engine, no Rust binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {buildInventory,classifyGap,capabilityReport,capabilityState,HOST_METHODS,UNREACHABLE_METHODS,GAP_CATEGORIES}=
  require(path.join(root,'plugins/craftmine-world/godot-capability.cjs'));
const {GODOT_METHODS,LOCAL_TOOLS}=require(path.join(root,'plugins/craftmine-world/godot-routing.cjs'));
const manifest=require(path.join(root,'plugins/craftmine-world/manifest.json'));

const HANDSHAKE={format:'craftmine.core/1',godotProjects:true,godotExecution:false,godotBuildJobs:true,
  godotExecutorGate:true,verificationJobs:true,playerApplications:true,advisoryReviews:true,sessionDrafts:true,
  publishesWorlds:true,agentPublishesWorlds:false};

test('the inventory reflects the real manifest and broker routing',()=>{
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:HANDSHAKE});
  assert.equal(inventory.format,'craftmine.godot-capability/1');
  const godot=inventory.tools.filter(tool=>tool.name.startsWith('godot_'));
  assert.equal(godot.length,20,godot.map(tool=>tool.name).join(','));
  assert.ok(godot.every(tool=>tool.wired===true),'every advertised Godot tool must be routed');
  const build=godot.find(tool=>tool.name==='godot_build_start');
  assert.equal(build.hostMethod,'godotBuild.start');
  assert.equal(build.reachable,true);
  assert.equal(build.owner,'S1');
  const docs=godot.find(tool=>tool.name==='godot_docs');
  assert.equal(docs.local,true);
  assert.equal(docs.reachable,true);
  assert.equal(docs.hostMethod,null);
});

test('a disabled capability flag is reported as disabled, never as available',()=>{
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,
    handshake:{...HANDSHAKE,godotBuildJobs:false}});
  const build=inventory.tools.find(tool=>tool.name==='godot_build_start');
  assert.equal(build.reachable,false);
  assert.equal(build.blockedBy,'CAPABILITY_DISABLED');
  const unknown=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:{}});
  assert.equal(unknown.tools.find(tool=>tool.name==='godot_build_start').reachable,null);
  assert.match(unknown.note,/never reported as available/);
  assert.equal(capabilityState('godotBuild.start',{}).reason,'CAPABILITY_FLAG_UNKNOWN');
});

test('host methods with no agent tool are listed with their owner',()=>{
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:HANDSHAKE});
  const prepare=inventory.unreachableMethods.find(entry=>entry.method==='godotApplication.prepare');
  assert.equal(prepare.owner,'S1');
  assert.equal(prepare.kind,'write');
  assert.equal(prepare.reason,'NO_AGENT_TOOL_ROUTES_THIS_METHOD');
  // Reachability of an unreachable method is always false; the capability flag
  // is reported separately so it cannot be read as an available ability.
  assert.equal(prepare.reachable,false);
  assert.equal(prepare.capabilityEnabled,true);
  assert.ok(UNREACHABLE_METHODS.includes('backup.export'));
  assert.equal(inventory.unreachableMethods.find(entry=>entry.method==='backup.export').owner,'S4');
  assert.ok(inventory.unreachableMethods.every(entry=>entry.reachable===false));
  // Every declared owner must be a real subsystem owner, not a guess.
  for(const [method,entry] of Object.entries(HOST_METHODS))assert.ok(entry.owner&&entry.capability,method);
});

test('pre-existing world tools are reported as wired, not as unwired',()=>{
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:HANDSHAKE});
  for(const name of ['project_inspect','capabilities_read','resource_read','workspace_patch','verification_submit',
    'verification_read','verification_cancel','library_search','library_read','library_install','memory_search',
    'memory_propose','requirements_read']){
    const tool=inventory.tools.find(entry=>entry.name===name);
    assert.equal(tool.wired,true,`${name} must be wired`);
    assert.equal(tool.reachable,true,`${name} must be reachable with a healthy handshake`);
  }
  assert.equal(inventory.tools.filter(tool=>tool.wired===false).length,0);
});

test('a plugin tool follows the capability flag it depends on',()=>{
  const disabled=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,
    handshake:{...HANDSHAKE,godotProjects:false}});
  const query=disabled.tools.find(tool=>tool.name==='godot_project_query');
  assert.equal(query.reachable,false);
  assert.equal(query.blockedBy,'CAPABILITY_DISABLED');
  assert.equal(disabled.tools.find(tool=>tool.name==='godot_docs').reachable,true,'docs need no flag');
});

test('an old core without history flags is unknown, not permanently unwired',()=>{
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:HANDSHAKE});
  const history=inventory.tools.find(tool=>tool.name==='godot_history');
  assert.equal(history.wired,true);
  assert.equal(history.reachable,null);
  assert.equal(history.blockedBy,'CAPABILITY_FLAG_UNKNOWN');
});

test('a gap without evidence is undetermined, never a guess',()=>{
  const none=classifyGap({request:'add a minimap'});
  assert.equal(none.category,'undetermined');
  assert.ok(none.neededEvidence.length>=4);
  const unknownKind=classifyGap({request:'x',evidence:[{kind:'made-up',source:'nowhere'}]});
  assert.equal(unknownKind.category,'undetermined');
  const partial=classifyGap({request:'x',evidence:[{kind:'missing-host-method'}]});
  assert.equal(partial.category,'undetermined','evidence without a source is not evidence');
});

test('each of the six gap categories is reachable from real evidence kinds',()=>{
  const cases={
    'already-available-unread':{kind:'project-contains-feature',source:'godot_project_query mode=find'},
    'state-or-interface-missing':{kind:'missing-host-method',source:'hello handshake lacks the flag'},
    'developable-with-ordinary-script':{kind:'engine-api-supports',source:'godot_docs readDoc characterbody3d'},
    'needs-reusable-component':{kind:'needs-shared-component',source:'two worlds would duplicate the same node tree'},
    'target-platform-unsupported':{kind:'web-target-restriction',source:'godot_docs readDoc web-export-limits'},
    'needs-core-or-host-change':{kind:'requires-host-change',source:'sandbox denies process access'}
  };
  for(const [category,evidence] of Object.entries(cases)){
    const result=classifyGap({request:'r',evidence:[evidence]});
    assert.equal(result.category,category,JSON.stringify(evidence));
    assert.equal(result.categoryLabel,GAP_CATEGORIES[category].label);
    assert.ok(result.nextStep.length>0);
  }
});

test('a hard limitation outranks an ordinary-script route',()=>{
  const result=classifyGap({request:'r',evidence:[
    {kind:'engine-api-supports',source:'docs'},
    {kind:'requires-engine-change',source:'renderer change'}]});
  assert.equal(result.category,'needs-core-or-host-change');
});

test('the capability report bundles tools, gaps and limits without inflating them',()=>{
  const report=capabilityReport({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:HANDSHAKE,
    gaps:[{request:'add a minimap',evidence:[{kind:'ordinary-gdscript-sufficient',source:'Control + Camera2D'}]}],
    limits:{available:false,reason:'BUDGET_PROVIDER_NOT_WIRED'}});
  assert.equal(report.toolCount,report.tools.length);
  assert.equal(report.gapClassifications.length,1);
  assert.equal(report.gapClassifications[0].category,'developable-with-ordinary-script');
  assert.equal(report.limits.reason,'BUDGET_PROVIDER_NOT_WIRED');
  assert.ok(report.guidance.some(line=>/do not claim a capability outside it/.test(line)));
});


const FULL={...HANDSHAKE,contentHistory:true,assetCatalog:true,creationPackages:true};
const BOUND={worldId:'alpha',repository:{registered:true}};
function modes(name,{handshake=FULL,executionContext=BOUND,methodOverrides={}}={}){
 return buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake,executionContext,methodOverrides})
  .tools.find(tool=>tool.name===name).modes;
}
test('actual modes distinguish read routes from player-only proposals',()=>{
 for(const name of ['godot_history','asset_library','package_library']){
  const entries=modes(name);
  const schema=manifest.contributes.agentTools.find(tool=>tool.name===name).schema;
  assert.deepEqual(entries.map(entry=>entry.mode).sort(),schema.properties.mode.enum.slice().sort());
  assert.ok(entries.every(entry=>entry.reachable===true));
  for(const entry of entries){
   if(entry.kind==='proposal'){assert.equal(entry.hostMethod,entry.mode==='propose-source-install'?'asset.read':null);assert.equal(entry.applies,false);assert.equal(entry.requiresPlayerAction,true);}
   else assert.equal(HOST_METHODS[entry.hostMethod].capability,entry.needs.at(-1));
  }
 }
});
test('dedicated flags override old generic flags and missing flags remain unknown',()=>{
 for(const [name,flag] of [['asset_library','assetCatalog'],['package_library','creationPackages'],['godot_history','contentHistory']]){
  for(const value of [false,undefined]){
   const entries=modes(name,{handshake:{...FULL,[flag]:value}});
   assert.ok(entries.filter(entry=>entry.kind==='read').every(entry=>entry.reachable===(value===false?false:null)));
   assert.ok(entries.filter(entry=>entry.kind==='proposal').every(entry=>entry.applies===false));
  }
 }
 assert.equal(modes('asset_library',{handshake:{...FULL,sessionDrafts:undefined,assetCatalog:false}})[0].reachable,false);
});
test('unbound sessions, unmigrated worlds and unavailable git are distinct from wiring',()=>{
 assert.ok(modes('asset_library',{executionContext:{}}).every(entry=>entry.reachable===null&&entry.blockedBy==='WORLD_BINDING_UNRESOLVED'));
 const legacy=modes('godot_history',{executionContext:{worldId:'alpha',repository:{registered:false}}});
 assert.equal(legacy.find(entry=>entry.mode==='history').reachable,false);
 assert.equal(legacy.find(entry=>entry.mode==='operation').reachable,true);
 assert.equal(legacy.find(entry=>entry.mode==='checkpoint').applies,false);
 assert.equal(modes('godot_history',{executionContext:{worldId:'alpha',repository:{registered:null,reason:'CONTENT_STATUS_UNAVAILABLE'}}})[0].reachable,null);
});
test('host method overrides are shown but cannot inherit unverified availability',()=>{
 const entry=modes('godot_history',{methodOverrides:{historyMethods:{history:'custom.history'}}})[0];
 assert.equal(entry.hostMethod,'custom.history');assert.equal(entry.reachable,null);assert.equal(entry.blockedBy,'CUSTOM_METHOD_UNVERIFIED');
 const asset=modes('asset_library',{methodOverrides:{libraryMethods:{asset:{read:'custom.read'}}}}).find(entry=>entry.mode==='read');
 assert.equal(asset.hostMethod,'custom.read');assert.equal(asset.reachable,null);
});
test('capability context uses durable session identity and never opens a workspace',async()=>{
 const {readCapabilityContext}=require(path.join(root,'plugins/craftmine-world/godot-capability.cjs'));
 const calls=[];
 const core={call:async(method,params)=>{calls.push({method,params});if(method==='task.context')return {world:{id:'bound-world'}};
  if(method==='content.status'){assert.equal(params.worldId,'bound-world');return {registered:false};}throw Error('unexpected write');}};
 assert.deepEqual(await readCapabilityContext(core,{sessionId:'s'},FULL),{worldId:'bound-world',repository:{registered:false}});
 assert.deepEqual(calls.map(call=>call.method),['task.context','content.status']);
 assert.equal((await readCapabilityContext({call:async()=>{throw Error('missing');}},{},FULL)).worldId,null);
});

test('execution mode contracts cover real schema modes and honor disabled or unknown registration',()=>{
 const wired={wired:[{key:'executorEnqueue'}]};
 const executor={source:'live-executor',status:{available:true,buildAvailable:true,checkAvailable:true}};
 for(const flag of [true,false,undefined]){
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,
   handshake:{...HANDSHAKE,godotBuildJobs:flag},services:wired,executor});
  for(const name of ['godot_build_start','godot_jobs']){
   const tool=inventory.tools.find(tool=>tool.name===name);
   const schema=manifest.contributes.agentTools.find(tool=>tool.name===name).schema;
   assert.deepEqual(tool.modes.map(entry=>entry.mode).sort(),schema.properties.mode.enum.slice().sort());
   for(const entry of tool.modes.filter(entry=>entry.execution)){
    assert.equal(entry.reachable,flag===undefined?null:flag);
    assert.equal(entry.execution.available,flag===undefined?null:flag);
   }
  }
 }
});

test('contract digest is canonical, responds to schema/routing edits and excludes live readings',()=>{
 const args={manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:HANDSHAKE};
 const digest=buildInventory(args).contract;
 assert.equal(digest.algorithm,'sha256');assert.match(digest.digest,/^[a-f0-9]{64}$/);
 const reversed=Object.fromEntries(Object.entries(GODOT_METHODS).reverse());
 assert.deepEqual(buildInventory({...args,routing:reversed}).contract,digest);
 const changed=structuredClone(manifest);changed.contributes.agentTools[0].schema.description='changed contract';
 assert.notEqual(buildInventory({...args,manifest:changed}).contract.digest,digest.digest);
 assert.notEqual(buildInventory({...args,routing:{...GODOT_METHODS,godot_build_start:'different.start'}}).contract.digest,digest.digest);
 assert.equal(buildInventory({...args,handshake:{},executor:{source:'core-registration'}}).contract.digest,digest.digest);
 for(const entry of buildInventory(args).unreachableMethods){
  assert.equal(entry.exposure,'host-only');assert.equal(entry.intentional,true);assert.equal(entry.agentExposureDefect,false);
 }
});
