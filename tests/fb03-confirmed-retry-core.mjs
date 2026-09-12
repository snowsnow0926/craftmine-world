// Read a copied real retained confirmation through Rust, the private router,
// PluginRuntime, factory and world-list projection. Never launches Godot or
// creates synthetic executor receipts. The source profile is read-only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire,register} from 'node:module';import {DatabaseSync,backup} from 'node:sqlite';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldFactory}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const {createGodotPanelCoordinator}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-panel-coordinator.ts');
const {PluginRuntime}=await import('../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts');
assert.ok(process.argv[2]&&process.argv[3],'Usage: node tests/fb03-confirmed-retry-core.mjs READONLY_PROFILE CONFIRMED_WORLD_ID');
const root=path.resolve(import.meta.dirname,'..'),source=path.resolve(process.argv[2]),worldId=process.argv[3],desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const out=fs.mkdtempSync(path.join(root,'test-results/fb03-confirmed-retry-core-')),directory=path.join(out,'domain'),from=path.join(source,'plugins/data/craftmine.world');fs.mkdirSync(directory);
for(const name of ['asset-catalog','content-history','godot-source','godot-builds'])if(fs.existsSync(path.join(from,name)))fs.cpSync(path.join(from,name),path.join(directory,name),{recursive:true,filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))});
const db=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});await backup(db,path.join(directory,'tasks.sqlite'));db.close();
await require('esbuild').build({entryPoints:[path.join(root,'plugins/craftmine-world/host-requests.cjs')],outfile:path.join(out,'host-router.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'domain',setup(build){build.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(root,'plugins/craftmine-world/domain-adapter.mjs')}));}}]});
const {createHostRequests}=createRequire(import.meta.url)(path.join(out,'host-router.cjs')),{CoreClient}=createRequire(import.meta.url)('../plugins/craftmine-world/core-client.cjs');
const core=new CoreClient(path.resolve(process.env.CRAFTMINE_CORE_BINARY??path.join(root,'test-results/cargo-target/debug/craftmine-core.exe')),directory),report={out,source,worldId,scope:'real preserved Core confirmation and actual private runtime/factory/list projection; no new engine execution'};
await core.start();
try {
 const router=createHostRequests(core,{getSettings:async()=>({activeWorldId:worldId})}),runtime=new PluginRuntime({});
 const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){Promise.resolve().then(()=>router(message.payload.method,message.payload.params)).then(value=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value}),error=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:false,error:{code:error.code??'FAILED',message:error.message}}));}}};runtime.loaded.set('craftmine.world',loaded);
 const domain=(method,args)=>runtime.requestCraftmineHost(method,args);
 report.before=await domain('world.read',{id:worldId});report.status=await domain('godotWorld.initStatus',{worldId});
 assert.equal(report.status.status,'confirmed');assert.equal(report.status.playable,true);assert.notEqual(report.status.cancelled,true);
 const factory=createGodotWorldFactory({worldsRoot:path.join(out,'not-materialized'),catalogFile:path.join(out,'absent'),basesRoot:path.join(out,'absent'),domain,materialize:()=>assert.fail('confirmed source must not be recreated')});
 const panel=createGodotPanelCoordinator({host:{instance:null},adapter:{},selection:async()=>worldId,creation:()=>factory,invoke:async channel=>{assert.equal(channel,'world.list');return {worlds:await domain('world.list',{}),activeWorldId:worldId};}});
 report.projected=(await panel.invoke('world.list')).worlds.find(world=>world.id===worldId);
 assert.equal(report.projected.state,'ready');assert.equal(report.projected.creation.progress,100);assert.equal(report.projected.creation.error,null);
 assert.deepEqual(await domain('world.read',{id:worldId}),report.before,'projection preserves complete world and saved progress');
 report.passed=true;
} catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
