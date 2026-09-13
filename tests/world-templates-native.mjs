// Native storage boundary integration; no model, game window or input events.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {register,createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {materializeWorldTemplate,readWorldTemplates} from '../desktop/godot/shared/world-templates.mjs';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {initializationFileBatches}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts');
const {CoreClient}=createRequire(import.meta.url)('../plugins/craftmine-world/core-client.cjs');
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const data=fs.mkdtempSync(path.join(root,'test-results/template-native-'));
const binary=process.env.CRAFTMINE_CORE_BINARY;if(!binary||!path.isAbsolute(binary))throw Error('CRAFTMINE_CORE_BINARY required');
const core=new CoreClient(binary,path.join(data,'domain'));
const report={format:'craftmine.world-template-native-test/1',worlds:[],modelCalls:0,buildsRun:0};
try{
 await core.start();
 for(const option of readWorldTemplates()){
  const worldId='native-'+option.id,out=path.join(data,worldId),manifest=materializeWorldTemplate({worldId,template:option.id,out});
  const body=JSON.parse(fs.readFileSync(path.join(out,'craftmine_initial_state.json'))).initialProgress;
  const snapshot={format:'craftmine.godot-progress/1',worldId,baseId:'creation-sandbox',baseVersion:'1.0.0',stateVersion:1,body};
  await core.call('godotWorld.initialize',{worldId,title:option.label,baseId:'creation-sandbox',baseBuild:'creation-sandbox-1.0.0',snapshot});
  const context={projectId:'template-integration',sessionId:worldId,turnId:randomUUID()};
  await core.call('workspace.open',{context,selectedWorld:worldId});
  const task=await core.call('task.context',{context});
  let index=await core.call('godotProject.create',{context,worldId,toolCallId:'create-source',baseBuild:task.binding.baseBuild,baseId:'creation-sandbox',files:[{path:'project.godot',text:fs.readFileSync(path.join(out,'project.godot'),'utf8')}]});
  const files=manifest.files.filter(f=>f.path!=='project.godot').map(f=>({path:f.path,bytesBase64:fs.readFileSync(path.join(out,f.path)).toString('base64'),expectedHash:null}));
  const batches=initializationFileBatches(files);
  for(let i=0;i<batches.length;i++)index=await core.call('godotProject.applyFiles',{context,worldId,toolCallId:'install-'+i,revision:index.revision,manifestHash:index.manifestHash,files:batches[i]},120000);
  const observed=[];let offset=0;
  do{const page=await core.call('godotProject.index',{context,worldId,offset,limit:32});observed.push(...page.files);offset=page.nextOffset??0;}while(offset);
  assert.equal(observed.length,manifest.files.length);
  for(const file of manifest.files)assert.equal(observed.find(f=>f.path===file.path).sha256,file.sha256);
  const record=await core.call('world.read',{id:worldId});assert.deepEqual(record.world.snapshot,snapshot);
  await core.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
  report.worlds.push({worldId,files:observed.length,batches:batches.length,sourceHash:index.manifestHash,initialStateHash:record.contentHash});
 }
 assert.equal((await core.call('world.list')).length,4);
 await core.stop();await core.start();assert.equal((await core.call('world.list')).length,4);
 report.passed=true;fs.writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({data,...report}));
}finally{await core.stop();}
