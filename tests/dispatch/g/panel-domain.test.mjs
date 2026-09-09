import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {compileScene,upgradeScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';
import {sourceFixture} from '../c/fixtures/applied-source.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(new URL('../../../vendor/pi-desktop/packages/agent-runtime/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {createCraftminePanelGateway}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const compiledRequire=createRequire(import.meta.url);
const {CoreClient}=compiledRequire(path.join(root,'desktop/build/craftmine.world/core-client.cjs'));
const {createHostRequests}=compiledRequire(path.join(root,'desktop/build/craftmine.world/host-requests.cjs'));
const {createWorkbenchService}=compiledRequire(path.join(root,'desktop/build/craftmine.world/workbench-service.cjs'));
const {createLibraryService,createMemoryService,emptyWorld}=compiledRequire(path.join(root,'desktop/build/craftmine.world/domain.cjs'));

test('actual Rust panel integration preserves draft identity, exact receipts and bound context after world switches',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'craftmine-g-panel-'));
  await writeFile(path.join(directory,'TEST_PROFILE'),'Independent G Rust domain test; host and evidence are explicit fixtures.');
  const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN||path.join(root,'desktop/build/rust-target/debug/craftmine-core.exe'),directory);
  t.after(()=>core.stop());await core.start();
  const call=(method,params)=>core.call(method,params),library=createLibraryService({call}),memory=createMemoryService({call});
  let selectedWorld='source-world',sessionId=null,sequence=0;const active=new Map(),queued=[];
  const verifications={enqueue:job=>queued.push(job)};
  const workbench=createWorkbenchService(core,{library,memory,verifications,getSettings:async()=>({activeWorldId:selectedWorld})});
  const domain=createHostRequests(core,{workbench,getSettings:async()=>({activeWorldId:selectedWorld})});
  const panel=createCraftminePanelGateway({viewingSession:()=>sessionId,session:async id=>({id,providerId:'fixture',modelId:'fixture'}),activeTurn:id=>active.get(id),domain,
    begin:async session=>{const turn='action-'+(++sequence);active.set(session.id,turn);return turn;},
    end:async(id,status)=>{await core.call('workspace.endTurn',{sessionId:id,turnId:active.get(id),status});active.delete(id);},
    resume:async()=>{throw Error('No model in this explicit host fixture');},stop:async()=>{},backup:async()=>{throw Error('No file picker in this domain fixture');},diagnostics:async()=>({})});
  const empty=upgradeScene({format:'craftmine.scene/1',title:'Fixture',night:false,objects:[]});
  const source=upgradeScene({...empty,format:'craftmine.scene/1',objects:[{id:'oak-tree',name:'树',position:{x:0,y:6,z:0},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:3,z:1},material:'wood'}]}]});
  const compile=scene=>{const result=compileScene(scene);return {...result,behaviors:result.behaviors||[],id:'v-'+result.hash.slice(0,20)};};
  const sourceContext={projectId:'fixture-project',sessionId:'fixture-source',turnId:'fixture-turn'};
  await sourceFixture({context:sourceContext,empty,source,build:compile,INITIAL_SNAPSHOT})(call);
  await call('workspace.endTurn',{sessionId:sourceContext.sessionId,turnId:sourceContext.turnId,status:'completed'});
  assert.ok((await panel('workbench.capabilities',{worldId:selectedWorld})).channels.includes('task.recoverable'));
  assert.equal((await panel('task.current',{worldId:selectedWorld})).context,null);
  const capture=await panel('library.capture',{worldId:selectedWorld,operationId:'capture-panel-tree',kind:'object',resourceId:'oak-tree',tags:[]});
  await call('world.create',{id:'target',title:'Target',world:emptyWorld('Target')});selectedWorld='target';sessionId='native-session-fixture';
  const args={worldId:selectedWorld,operationId:'install-panel-tree',ref:capture.ref,revision:0};
  await assert.rejects(panel('library.install',{...args,context:sourceContext}),/HOST_IDENTITY/);
  const installed=await panel('library.install',args);assert.equal(installed.receipt.revision,1);assert.equal(queued.length,1);assert.equal(active.size,0);
  const replay=await panel('library.install',args);assert.equal(replay.replayed,true);assert.equal(sequence,1);
  await assert.rejects(panel('library.install',{...args,position:{x:7,y:6,z:0}}),/REPLAY_MISMATCH/);
  const current=(await panel('task.current',{worldId:selectedWorld})).context;
  assert.equal(current.status,'finished');assert.equal(current.draft.revision,1);
  selectedWorld='source-world';
  const context=Object.fromEntries(['projectId','sessionId','turnId'].map(key=>[key,current.binding[key]]));
  assert.equal((await domain('task.context',{context})).world.id,'target');
  assert.equal((await workbench.validatedContext(context)).selection,null);
  await assert.rejects(panel('memory.search',{worldId:'target'}),/SELECTED_WORLD_CHANGED/);
});
