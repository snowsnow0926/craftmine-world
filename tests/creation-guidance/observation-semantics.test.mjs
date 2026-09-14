// Replay only archived values through the normal presentation layer. No live
// clock is forged and no engine, model, input, or player profile is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {normalizeLiveSample,renderFactsBlock}=require('../../plugins/craftmine-world/godot-observe.cjs');
const evidence=path.join(root,'docs/evidence/observation-semantics-20260912');
const adoptionBytes=fs.readFileSync(path.join(evidence,'adoption-report.json')),adoption=JSON.parse(adoptionBytes);
const excerpt=JSON.parse(fs.readFileSync(path.join(evidence,'source-check-excerpt.json')));
const sha=x=>createHash('sha256').update(x).digest('hex');
const a='ins-882b440ff2217a2e7519b1fc-e0',b='ins-436135d4a8aec10753b36e19-e0';

test('archived source patch/check/adoption identities align; A is non-solid and B retains its source parameters',()=>{
 assert.equal(sha(adoptionBytes),excerpt.adoptionReportSha256);
 assert.equal(excerpt.patch.toolResult.revision,excerpt.checkedJob.sourceRevision);
 assert.equal(excerpt.patch.toolResult.manifestHash,excerpt.checkedJob.manifestHash);
 assert.equal(excerpt.checkedJob.status,'passed');assert.equal(excerpt.checkedJob.buildId,adoption.checkedBuildId);
 assert.equal(excerpt.checkedJob.candidateId,adoption.candidateId);assert.equal(excerpt.checkedJob.worldId,adoption.worldId);
 assert.equal(adoption.reopened.buildId,adoption.checkedBuildId);assert.equal(adoption.ok,true);
 const operations=excerpt.patch.toolArgs.operations;assert.equal(operations.length,1);assert.equal(operations[0].path,'scenes/creation.tscn');
 const section=id=>operations[0].text.split('[node name="'+id+'"')[1]?.split('\n[node ')[0];
 for(const [id,scale,turns,solid]of [[a,250,1,false],[b,100,0,true]]){
  const text=section(id);assert.ok(text);assert.match(text,new RegExp('model_scale_percent = '+scale+'\\b'));
  assert.match(text,new RegExp('quarter_turns = '+turns+'\\b'));assert.match(text,new RegExp('solid = '+solid+'\\b'));
 }
 assert.deepEqual(adoption.launches.map(x=>x.exit.code),[0,0]);
});

test('the same archive disproves collision-disabled implies visually unselectable, including cold reopen',()=>{
 assert.equal(adoption.before.payload.creation.sceneObjectSelection.status,'blocked');
 assert.equal(adoption.before.payload.creation.sceneObjectTarget.nodeClass,'StaticBody3D');
 for(const sample of [adoption.after,adoption.reopened]){
  const c=sample.payload.creation;assert.equal(c.sceneObjectSelection.status,'hit');
  assert.equal(c.sceneObjectSelection.reason,'nearest-supported-triangle');
  assert.equal(c.sceneObjectTarget.nodeClass,'MeshInstance3D');
  assert.ok(c.sceneObjectTarget.ancestors.some(x=>x.nodePath===a));
  assert.ok(c.sceneObjectRefs.some(ref=>ref.nodePath===c.sceneObjectTarget.nodePath&&ref.ancestors.some(x=>x.nodePath===a)));
  assert.equal(c.sceneObjectSelection.pixelAccurate,false);assert.equal(c.sceneObjectSelection.renderLodVerified,false);
 }
 assert.notEqual(adoption.after.instanceId,adoption.reopened.instanceId);
});

test('normal presentation preserves the archived actual target and explains bounds uncertainty without inventing geometry',()=>{
 const s=adoption.reopened;
 const live=normalizeLiveSample({...s.payload,worldId:s.worldId,buildId:s.buildId,instanceId:s.instanceId,sampledAt:s.sampledAt},
  {worldId:s.worldId,buildId:s.buildId},{now:Date.parse(s.sampledAt)}); // Archived clock, not a present-day freshness claim.
 assert.equal(live.stale,false);assert.deepEqual(live.creation,s.payload.creation);
 const before=JSON.stringify(live),block=renderFactsBlock({live});
 assert.match(block,/sceneSelection\(sample\): status="hit" targetClass="MeshInstance3D"/);
 assert.ok(block.includes(a+'/Visual/building-small-a'));assert.match(block,/collision disabled does not imply visual selection disabled/);
 assert.match(block,/Object world bounds and cross-axis reach remain unknown/);assert.match(block,/playerBounds describes the player/);
 assert.equal(JSON.stringify(live),before);assert.equal(live.creation.sceneObjectTarget.bounds,undefined);
 const missing=renderFactsBlock({live:{available:true,baseId:'creation-sandbox',creation:{},stale:false}});
 assert.match(missing,/status="unknown" targetClass=null targetPath=null/);
});

test('frame distinct is tied to the one-probe implementation and the archived assertion, not cross-build visual evidence',()=>{
 assert.deepEqual(excerpt.checkedJob.runtimeFrame,{detail:'frames=3 distinct=2',id:'runtime.frame',passed:true});
 const verifier=fs.readFileSync(path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier.ts'),'utf8');
 assert.match(verifier,/render\.distinctFrames = new Set\(render\.captures\.map\(\(capture\) => capture\.sha256\)\)\.size/);
 assert.match(verifier,/render\.ok = render\.frames >= FRAME_COUNT/);
 assert.equal(adoption.visual,'UNVERIFIED','the source archive itself does not claim a cross-version visual comparison');
});

test('versioned guidance and advertised observation/check tools state these finite evidence boundaries',()=>{
 const corpus=require('../../plugins/craftmine-world/guidance/catalog.json'),skill=corpus.skills.find(s=>s.id==='creation-sandbox.authoring');
 const text=fs.readFileSync(path.join(root,'plugins/craftmine-world/guidance/creation-sandbox.md'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(skill.version,'1.9.0');assert.equal(skill.text,text);assert.equal(skill.sha256,sha(text));
 // The archive and live presentation tests above still assert the exact
 // collision/selection, sceneObjectRefs, bounds and one-probe contracts.
 // Current guidance expresses their interpretation in these separate clauses;
 // do not require wording retired with the 1.7.1 guide.
 assert.match(text,/Godot 的渲染能力与宿主当前的目标拾取覆盖范围不同/);
 assert.match(text,/`fallback` 说明当前目标证据不足，不说明该网格不能显示/);
 assert.match(text,/或把碰撞包围盒当作精确可见表面来掩盖覆盖缺口/);
 assert.match(text,/宿主的通用运行、画面、存档与恢复检查通过只证明这些边界，不代表任意自然语言需求的语义验收已经完成/);
 assert.match(text,/player\.position 是胶囊中心/);
 assert.match(text,/playerBounds\.position 是脚底位置/);
 const tools=require('../../plugins/craftmine-world/manifest.json').contributes.agentTools;
 const observation=tools.find(x=>x.name==='godot_runtime_state'),check=tools.find(x=>x.name==='godot_build_read');
 assert.deepEqual(observation.schema.properties.scope.enum,['build','live']);
 assert.deepEqual(Object.keys(observation.schema.properties),['scope'],'The model cannot inject observation identity');
 assert.equal(observation.risk,'low');
 assert.match(observation.description,/A sample without its own identity, from another world or build, from a replaced instance, or older than the freshness window is marked stale/);
 assert.match(observation.description,/Live state is never inferred from a task-start snapshot or from the last saved progress/);
 assert.match(check.description,/passed proves only the checked candidate/);
 assert.match(check.description,/Reading never grants authority or proves untested gameplay/);
});
