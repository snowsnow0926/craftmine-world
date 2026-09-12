// Replay the exact catalog tool call on a read-only copy of the ordinary
// player's real project, through the freshly built production broker + Rust.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {DatabaseSync,backup} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'../..'),input=path.resolve(process.argv[2]??'');
assert.ok(input.startsWith(path.join(root,'test-results')+path.sep),'only isolated ordinary-player reports are accepted');
const player=JSON.parse(fs.readFileSync(input,'utf8'));
assert.ok(player.format==='craftmine.fb02-ordinary-player/1'&&player.profile.startsWith(path.join(root,'test-results')+path.sep)&&player.worldId);
const out=fs.mkdtempSync(path.join(root,'test-results/guidance-core-route-')),plugin=path.join(out,'plugin'),domain=path.join(out,'domain');
const source=path.join(player.profile,'plugins/data/craftmine.world');
fs.cpSync(source,domain,{recursive:true,filter:file=>!file.endsWith('.lock')&&!/^tasks\.sqlite(?:-wal|-shm)?$/.test(path.basename(file))});
const db=new DatabaseSync(path.join(source,'tasks.sqlite'),{readOnly:true});await backup(db,path.join(domain,'tasks.sqlite'));db.close();
execFileSync(process.execPath,[path.join(root,'desktop/build-world-plugin.mjs'),'--output',plugin],{cwd:root,windowsHide:true,stdio:'pipe'});
const require=createRequire(import.meta.url),{CoreClient}=require(path.join(plugin,'core-client.cjs')),{createWorldTools}=require(path.join(plugin,'world-tools.cjs'));
const core=new CoreClient(process.env.CRAFTMINE_CORE_BINARY??path.join(root,'vendor/pi-desktop/target/debug/craftmine-core.exe'),domain);
const report={out,input,worldId:player.worldId,sourceEdited:false,modelCalled:false,checks:[]};
try{
  await core.start();
  const context={projectId:'guidance-source-review',sessionId:'guidance-source-review',turnId:'guidance-source-review',executionId:'guidance-source-review',toolCallId:'guidance-catalog'};
  const tool=createWorldTools(core,async()=>({activeWorldId:player.worldId})).find(tool=>tool.name==='godot_guidance');assert.ok(tool);
  const catalog=await tool.execute({mode:'catalog'},context);report.catalog=catalog;
  assert.equal(catalog.available,true);assert.equal(catalog.source.worldId,player.worldId);
  assert.equal(catalog.interfaceMatches.find(item=>item.skillId==='creation-sandbox.authoring')?.profile,'creation-player-collision/1');
  report.checks.push('exact ordinary-player catalog call accepts the real current source through production broker and core');
  const skill=catalog.skills.find(skill=>skill.id==='creation-sandbox.authoring');
  const pin={revision:catalog.source.revision,manifestHash:catalog.source.manifestHash};
  const page=await tool.execute({mode:'read',id:skill.id,version:skill.version,sha256:skill.sha256,...pin,limit:8000},context);
  assert.ok(page.text.includes('godot_'));report.checks.push('returned exact catalog identity can read the actual recipe');
  const ref=skill.references.find(ref=>ref.projectPath==='craftmine_shared/base_adapter.gd');
  const reference=await tool.execute({mode:'read',id:skill.id,version:skill.version,sha256:ref.sha256,path:ref.path,...pin,limit:8000},context);
  assert.equal(reference.sha256,ref.sha256);assert.ok(reference.text.includes('extends'));
  report.checks.push('modern wrapper resolves to the exact reviewed inherited adapter reference');
  await assert.rejects(tool.execute({mode:'catalog',worldId:'forged'},context));
  await assert.rejects(tool.execute({mode:'read',id:skill.id,version:skill.version,sha256:'f'.repeat(64),...pin},context));
  report.checks.push('forged world scope and unpinned content remain rejected');
  report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error,checks:report.checks}));}
