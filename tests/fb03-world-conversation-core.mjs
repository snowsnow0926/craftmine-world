// Existing host session rows -> actual plugin gate/router/workbench -> copied
// Rust domain. No engine, model, turn creation, source patch or selection write.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';import {createRequire,register} from 'node:module';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {readWorldConversation}=await import('../vendor/pi-desktop/apps/desktop/electron/main/world-conversation.ts');
const {PluginRuntime}=await import('../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts');
const repo=path.resolve(import.meta.dirname,'..'),source=path.resolve(process.argv[2]),worldId=process.argv[3],expectedSession=process.argv[4];
assert.ok(source&&worldId&&expectedSession,'Pass a read-only profile, world and expected real session');
const require=createRequire(import.meta.url),desktopRequire=createRequire(path.join(repo,'vendor/pi-desktop/apps/desktop/package.json'));
const out=fs.mkdtempSync(path.join(repo,'test-results/fb03-world-conversation-')),domain=path.join(out,'domain');fs.mkdirSync(domain);
const from=path.join(source,'plugins/data/craftmine.world');
for(const name of ['content-history','godot-source','godot-builds','asset-catalog','settings.json'])if(fs.existsSync(path.join(from,name)))fs.cpSync(path.join(from,name),path.join(domain,name),{recursive:true,filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))});
const sourceDb=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});await backup(sourceDb,path.join(domain,'tasks.sqlite'));sourceDb.close();
const hostDb=new DatabaseSync(path.join(source,'pi.sqlite'),{readOnly:true});
const sessions=hostDb.prepare('SELECT s.id,p.path AS projectPath,s.updated_at AS updatedAt FROM sessions s LEFT JOIN projects p ON p.id=s.project_id').all();hostDb.close();
await desktopRequire('esbuild').build({entryPoints:[path.join(repo,'plugins/craftmine-world/host-requests.cjs')],outfile:path.join(out,'router.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'source-domain',setup(build){build.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(repo,'plugins/craftmine-world/domain-adapter.mjs')}));}}]});
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs'),{createWorkbenchService}=require('../plugins/craftmine-world/workbench-service.cjs');
const {createHostRequests}=require(path.join(out,'router.cjs'));
const core=new CoreClient(process.env.FB03_CORE??'D:/Craftmine World/vendor/pi-desktop/target/release/craftmine-core.exe',domain);
let selected=worldId;const report={format:'craftmine.fb03-world-conversation/1',out,worldId,expectedSession,modelCalls:0,engineCalls:0,calls:[]};
const getSettings=async()=>({activeWorldId:selected}),workbench=createWorkbenchService(core,{getSettings});
const router=createHostRequests(core,{getSettings,workbench}),runtime=new PluginRuntime({});
const loaded={manifest:{id:'craftmine.world'},pending:new Map(),nextCallId:1,child:{postMessage(message){Promise.resolve().then(()=>router(message.payload.method,message.payload.params)).then(value=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:true,value}),error=>runtime.handleChildMessage(loaded,{t:'res',id:message.id,ok:false,error:{code:error.code??'FAILED',message:error.message}}));}}};runtime.loaded.set('craftmine.world',loaded);
const access={selectedWorld:async()=>selected,sessions:async()=>sessions,pluginEnabled:()=>true,domain:async(method,args)=>{report.calls.push({method,channel:args.channel,sessionId:args.host?.sessionId});return runtime.requestCraftmineHost(method,args);}};
try{
 await core.start();report.before=await core.call('world.read',{id:worldId});
 report.automatic=await readWorldConversation({worldId},access);assert.equal(report.automatic.sessionId,expectedSession);
 report.preferred=await readWorldConversation({worldId,sessionId:expectedSession},access);assert.deepEqual(report.preferred,report.automatic);
 report.stalePreferred=await readWorldConversation({worldId,sessionId:'deleted-or-synthetic'},access);assert.deepEqual(report.stalePreferred,report.automatic);
 const worlds=await core.call('world.list',{}),other=worlds.find(item=>item.id!==worldId);assert.ok(other);selected=other.id;
 report.other=await readWorldConversation({worldId:other.id,sessionId:expectedSession},access);assert.equal(report.other.sessionId,null);
 report.after=await core.call('world.read',{id:worldId});assert.deepEqual(report.after,report.before);
 assert.ok(report.calls.every(call=>call.method==='workbench.request'&&call.channel==='task.current'));
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{runtime.loaded.clear();await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error,result:report.automatic}));}
