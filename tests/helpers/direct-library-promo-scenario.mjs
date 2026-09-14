import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {settleOperatorInputEvidence,settleOperatorExplorationEvidence} from './operator-input-evidence.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const PROMO_NATIVE_STAGES=['cw.nature.promo-broadleaf','cw.scene.promo-meadow','cw.module.promo-monsters','cw.module.promo-heavyblade','cw.module.promo-hunt','cw.module.promo-ak47'];
export function parseDirectLibraryArgs(args,env={}){
  if(args[0]&&!args[0].startsWith('--'))return parseDirectLibraryArgs(['--application-root',args[0],'--resources',args[1],...args.slice(2)],env);
  const values={};
  for(let i=0;i<args.length;i+=2){assert(['--application-root','--packaged-root','--resources','--scenario'].includes(args[i]),'DIRECT_ARGUMENT_UNKNOWN');assert(args[i+1]&&!args[i+1].startsWith('--')&&!Object.hasOwn(values,args[i]),'DIRECT_ARGUMENT_INVALID');values[args[i]]=args[i+1];}
  const applicationRoot=values['--application-root'],packagedRoot=values['--packaged-root']??env.CRAFTMINE_PACKAGED_ROOT??null;
  if(values['--packaged-root']&&env.CRAFTMINE_PACKAGED_ROOT)assert.equal(path.resolve(values['--packaged-root']),path.resolve(env.CRAFTMINE_PACKAGED_ROOT),'PACKAGED_ROOT_CONFLICT');
  const resources=values['--resources']??(packagedRoot?path.join(packagedRoot,'resources'):null),scenario=values['--scenario']??'legacy';
  assert(['legacy','promo-six-stage'].includes(scenario),'DIRECT_SCENARIO_INVALID');
  for(const item of [applicationRoot,resources,...(packagedRoot?[packagedRoot]:[])])assert(typeof item==='string'&&path.isAbsolute(item),'ABSOLUTE_DIRECT_PATH_REQUIRED');
  if(scenario==='promo-six-stage')assert(packagedRoot&&path.resolve(resources)===path.join(path.resolve(packagedRoot),'resources'),'PROMO_SEALED_RESOURCES_REQUIRED');
  return {applicationRoot,resources,packagedRoot,scenario};
}

export function promoPlacementFromGround(source,scene){
  const number='(-?\\d+(?:\\.\\d+)?)',vector=`Vector3\\(\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}\\s*\\)`;
  const found=[...source.matchAll(new RegExp(`_solid\\(self,\\s*${vector},\\s*${vector},\\s*"ground"\\)`,'g'))];
  assert.equal(found.length,1,'PROMO_ACTUAL_GROUND_CONTRACT_REQUIRED');
  const v=found[0].slice(1).map(Number),[width,height,depth,x,y,z]=v;
  // This scenario is intentionally for the shipped blank creation base. A
  // changed floor requires a reviewed placement plan, not invented dimensions.
  assert.deepEqual(v,[64,.4,64,0,-.2,0],'PROMO_GROUND_CHANGED_REVIEW_PLACEMENT');
  assert.match(scene,/\[node name="CameraRig"[^\]]*\][\s\S]*?position = Vector3\(0, 0\.65, 0\)/,'PROMO_CAMERA_HEIGHT_CONTRACT_REQUIRED');
  const ground={minimum:[x-width/2,y+height/2,z-depth/2],maximum:[x+width/2,y+height/2,z+depth/2]};
  const stages=PROMO_NATIVE_STAGES.map((assetId,i)=>({assetId,position:[{x:-18,y:0,z:20},{x:0,y:0,z:0},{x:0,y:0,z:6},{x:0,y:0,z:0},{x:0,y:0,z:16},{x:0,y:0,z:0}][i]}));
  return {ground,cameraHeight:.65,stages,reason:'Read actual packaged _solid ground and CameraRig source; original meadow and monster/trial footprints fit the existing floor. Tree is outside arena and initial player.'};
}

export function readPromoNativePlan(resources){
  const base=path.join(resources,'godot/bases/creation-sandbox'),sourceFile=path.join(base,'scripts/creation_world.gd'),sceneFile=path.join(base,'scenes/creation.tscn');
  const source=fs.readFileSync(sourceFile),scene=fs.readFileSync(sceneFile),plan=promoPlacementFromGround(source.toString(),scene.toString());
  const directory=path.join(resources,'plugins/craftmine.world/builtin-source-library'),catalogFile=path.join(directory,'catalog.json'),catalogBytes=fs.readFileSync(catalogFile),catalog=JSON.parse(catalogBytes);
  assert.equal(catalog.format,'craftmine.builtin-source-library/1');
  for(const stage of plan.stages){
    const rows=catalog.entries.filter(row=>row.assetId===stage.assetId&&row.version===1);assert.equal(rows.length,1,'PROMO_SEALED_ASSET_REQUIRED:'+stage.assetId);
    const entry=rows[0];assert.equal(path.basename(entry.file),entry.file,'PROMO_ARCHIVE_PATH_INVALID');
    const bytes=fs.readFileSync(path.join(directory,entry.file));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
    const archive=unpackStaticPackage(bytes);assert.equal(archive.packageJson.root.id,stage.assetId);
    const resource=archive.resources.find(row=>row.manifest.content.assetId===stage.assetId);assert(resource);assert.equal(resource.contentHash,entry.rootContentHash);
    assert.equal(resource.manifest.content.entry.entities.length,1);
    const model=resource.files.get('model.glb');assert(model,'PROMO_MODEL_REQUIRED');
    stage.package={assetId:stage.assetId,version:1,archiveFile:entry.file,archiveSha256:entry.sha256,rootContentHash:entry.rootContentHash,modelSha256:sha(model),modelBytes:model.length,entry:resource.manifest.content.entry};
  }
  return {...plan,sourceEvidence:{sourceFile,sourceSha256:sha(source),sceneFile,sceneSha256:sha(scene),catalogFile,catalogSha256:sha(catalogBytes)}};
}

export const promoBody=snapshot=>{assert.equal(snapshot?.state?.body?.format,'craftmine.creation-progress/1');return snapshot.state.body;};
export function preservePriorComponents(before,after){
  const a=promoBody(before),b=promoBody(after);
  for(const [id,state]of Object.entries(a.components??{}))assert.deepEqual(b.components?.[id],state,'PRIOR_COMPONENT_CHANGED:'+id);
  assert.deepEqual(b.player,a.player,'PLAYER_CHANGED_DURING_INSTALL');
  for(const key of ['inventory','openedChests','doors','rules'])assert.deepEqual(b[key],a[key],'PRIOR_WORLD_PROGRESS_CHANGED:'+key);
  return {previousComponentIds:Object.keys(a.components??{}),addedComponentIds:Object.keys(b.components??{}).filter(id=>!Object.hasOwn(a.components??{},id)),priorComponentsPreserved:true};
}
const components=(snapshot,format)=>Object.entries(promoBody(snapshot).components??{}).filter(([,state])=>state.format===format).map(([id,state])=>({id,...state}));
const one=(snapshot,format)=>{const rows=components(snapshot,format);assert.equal(rows.length,1,'ONE_COMPONENT_REQUIRED:'+format);return rows[0];};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);

export async function runPromoSixStage(api){
  const {report,out,resources,rpc,nav,panel,pkg,start,stop,createWorld,openExistingWorld,startDirect,applyDirect,capture,save,mark,closeAssets}=api;
  const plan=readPromoNativePlan(resources);report.scenario='promo-six-stage';report.plan=plan;report.play=[];report.stages=[];report.modelCalls=0;
  report.limits.push('Local ordinary-library acceptance only; no DeepSeek request or autonomous model selection is tested.','The pinned blank floor and specific source footprints are checked. Native candidate physics guards remain authoritative.');save();
  let worldId;
  async function freeze(){const receipt=await panel('godot.runtimeSave',{freeze:true});const snapshot=await rpc('godotSnapshot');assert.equal(snapshot.worldId,worldId);return {receipt,snapshot};}
  async function identity(){const o=await rpc('godotObserve');assert.equal(o.worldId,worldId);assert(o.buildId&&o.instanceId);return {worldId,buildId:o.buildId,instanceId:o.instanceId};}
  function playWriter(kind,label){const file=path.join(out,'promo-play-'+String(report.play.length).padStart(2,'0')+'-'+randomUUID()+'.json'),entry={file,kind,label,status:'started'};report.play.push(entry);save();return async value=>{fs.writeFileSync(file,JSON.stringify({...value,kind,label},null,2));entry.status=value.primaryError?'failed':'recorded';save();};}
  async function segment(label,segment){
    const id=await identity(),persist=playWriter('input',label);
    report.activeNativeInput=id;save();
    try{
    const evidence=await settleOperatorInputEvidence({identity:id,segment:{capture:false,...segment},
      run:async()=>{await panel('godot.runtimeResume');return rpc('inputSegment',{payload:{identity:id,segment:{capture:false,...segment}}});},archive:async value=>value,
      release:()=>rpc('cancelInputs',{payload:{identity:id}}),checkpoint:freeze,persist});
    if(evidence.primaryError)throw Error(evidence.primaryError);assert.equal(evidence.result.status,'completed');assert.equal(evidence.release.released,true);
    return evidence.checkpoint.snapshot;
    }finally{delete report.activeNativeInput;save();}
  }
  async function explore(label,steps){
    const id=await identity(),persist=playWriter('explore',label);
    await panel('godot.runtimeResume');
    const evidence=await settleOperatorExplorationEvidence({identity:id,steps,observe:()=>rpc('godotObserve'),run:()=>rpc('godotExplore',{payload:{...id,steps:steps.map(step=>({...step,capture:false}))}}),archive:async value=>value,persist});
    if(evidence.primaryError)throw Error(evidence.primaryError);return (await freeze()).snapshot;
  }
  async function aimAt(point){const snapshot=await rpc('godotSnapshot'),p=promoBody(snapshot).player.position;const dx=point[0]-p[0],dy=point[1]-(p[1]+plan.cameraHeight),dz=point[2]-p[2];return explore('look-at-observed-target',[{op:'look',args:{yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(dy,Math.hypot(dx,dz))}}]);}
  async function swordProbe(){
    let snapshot=await rpc('godotSnapshot'),target=components(snapshot,'craftmine.promo-hornling/1').filter(m=>m.health>0).sort((a,b)=>distance(a.position,promoBody(snapshot).player.position)-distance(b.position,promoBody(snapshot).player.position))[0];assert(target);
    for(let i=0;i<8&&distance(target.position,promoBody(snapshot).player.position)>3.5;i++){
      await aimAt([target.position[0],target.position[1]+.8,target.position[2]]);
      snapshot=await explore('walk-toward-live-hornling',[{op:'walk',args:{forward:1,right:0,frames:25}}]);target=components(snapshot,'craftmine.promo-hornling/1').find(m=>m.id===target.id);assert(target&&target.health>0);
    }
    assert(distance(target.position,promoBody(snapshot).player.position)<=3.5,'HORNLLING_NOT_REACHED_BY_REAL_MOVEMENT');
    await aimAt([target.position[0],target.position[1]+.8,target.position[2]]);const before=await rpc('godotSnapshot');
    const after=await segment('ordinary J heavyblade slash',{keys:['KeyJ'],frames:1,settleFrames:45});
    const damaged=components(after,'craftmine.promo-hornling/1').find(m=>m.id===target.id);assert(damaged.health<target.health,'HEAVYBLADE_DID_NOT_DAMAGE_HORNLLING');
    report.swordProof={before,after,targetId:target.id,noHuntInstalled:components(before,'craftmine.promo-hunt/1').length===0,capture:await capture('promo-sword-hit')};save();
  }
  async function huntProbe(){
    const before=await rpc('godotSnapshot'),after=await segment('ordinary H trial entry',{keys:['KeyH'],frames:1,settleFrames:8});
    assert.equal(one(after,'craftmine.promo-heavyblade/1').status,'active','H_DID_NOT_START_TRIAL');
    const moved=await segment('observe actual beast attacks',{frames:360,settleFrames:0});assert(one(moved,'craftmine.promo-heavyblade/1').health<100,'BEAST_ATTACK_NOT_OBSERVED');
    report.huntProof={before,after,attacked:moved,capture:await capture('promo-beast-trial')};save();
  }
  async function rifleProbe(){
    await segment('ordinary 2 equip rifle',{keys:['Digit2'],frames:1,settleFrames:30});
    let before=await rpc('godotSnapshot');const beast=one(before,'craftmine.promo-hunt/1').boss,arena=plan.stages[4].position;
    await aimAt([beast.position[0]+arena.x,beast.position[1]+arena.y+2.3,beast.position[2]+arena.z]);before=await rpc('godotSnapshot');
    const fired=await segment('ordinary J rifle burst',{keys:['KeyJ'],frames:25,settleFrames:0});
    assert(one(fired,'craftmine.promo-ak47/1').shots>one(before,'craftmine.promo-ak47/1').shots,'RIFLE_DID_NOT_FIRE');
    assert(one(fired,'craftmine.promo-hunt/1').boss.health<one(before,'craftmine.promo-hunt/1').boss.health,'RIFLE_BOSS_DAMAGE_NOT_OBSERVED');
    await segment('ordinary B leave trial',{keys:['KeyB'],frames:1,settleFrames:3});
    const reloaded=await segment('ordinary R reload',{keys:['KeyR'],frames:1,settleFrames:150});assert.equal(one(reloaded,'craftmine.promo-ak47/1').rounds,30);
    const blade=await segment('ordinary 3 select existing blade',{keys:['Digit3'],frames:1,settleFrames:3});assert.equal(one(blade,'craftmine.promo-combat-context/1').selectedSlot,'blade');
    const rifle=await segment('ordinary 2 return to rifle',{keys:['Digit2'],frames:1,settleFrames:3});assert.equal(one(rifle,'craftmine.promo-combat-context/1').selectedSlot,'rifle');
    report.rifleProof={before,fired,reloaded,blade,rifle,capture:await capture('promo-rifle')};save();
  }

  await start('promo-first');worldId=await createWorld('宣传片素材六阶段 · 本地验收');report.initialSnapshot=await rpc('godotSnapshot');report.initialSource=await pkg('sourceList');report.before=await rpc('godotObserve');
  assert.deepEqual(promoBody(report.initialSnapshot).components??{},{});mark('Ordinary PI form created the fresh blank world; six packaged archives verified');
  const instanceIds=new Set();
  for(const stage of plan.stages){
    if(api.cancelled?.())throw Error('TEST_CANCELLED');
    const before=await freeze(),sourceBefore=await pkg('sourceList');
    const row=await startDirect(stage.assetId,stage.position);row.packagedEvidence=stage.package;assert.equal(row.ready.ref.assetId,stage.assetId);assert.equal(row.ready.ref.version,1);
    await applyDirect(row,{staticCapture:true});const after=await freeze(),sourceAfter=await pkg('sourceList');
    const proof={assetId:stage.assetId,before,after,sourceBefore,sourceAfter,operationId:row.operationId};report.stages.push(proof);save();
    proof.progress=preservePriorComponents(before.snapshot,after.snapshot);
    for(const id of row.applied.instanceIds){assert(!instanceIds.has(id),'DUPLICATE_INSTANCE_ID');instanceIds.add(id);}
    assert(sourceAfter.revision>sourceBefore.revision);assert.notEqual(sourceAfter.manifestHash,sourceBefore.manifestHash);
    proof.formal=await rpc('godotObserve');
    if(stage.assetId==='cw.nature.promo-broadleaf')await aimAt([stage.position.x,stage.position.y+2,stage.position.z]);
    if(stage.assetId==='cw.scene.promo-meadow')await explore('look-at-meadow',[{op:'look',args:{yaw:0,pitch:-.45}}]);
    if(stage.assetId==='cw.module.promo-monsters'){const first=components(after.snapshot,'craftmine.promo-hornling/1')[0];await aimAt([first.position[0],first.position[1]+.8,first.position[2]]);}
    proof.capture=await capture('promo-stage-'+report.stages.length);save();mark('Ordinary library checked and adopted '+stage.assetId);
    if(stage.assetId==='cw.module.promo-heavyblade')await swordProbe();
    if(stage.assetId==='cw.module.promo-hunt')await huntProbe();
    if(stage.assetId==='cw.module.promo-ak47')await rifleProbe();
  }
  report.finalSave=await freeze();report.saved=report.finalSave.snapshot;report.after=await rpc('godotObserve');report.source=await pkg('sourceList');report.guards=await rpc('guards');save();
  const materialized=path.join(out,'profile/plugins/data/craftmine.world/godot-builds'),copies=[];
  assert(fs.existsSync(materialized),'PROMO_NATIVE_BUILD_SOURCE_ROOT_REQUIRED');
  function scan(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){if(item.isSymbolicLink())continue;const file=path.join(directory,item.name);if(item.isDirectory())scan(file);else if(item.name==='model.glb'){
    const normalized=file.replaceAll('\\','/'),stage=plan.stages.find(row=>normalized.includes('/addons/'+row.assetId+'/model.glb'));if(stage){const bytes=fs.readFileSync(file);copies.push({assetId:stage.assetId,file,sha256:sha(bytes),bytes:bytes.length});assert.equal(sha(bytes),stage.package.modelSha256,'MATERIALIZED_MODEL_CHANGED');}
  }}}
  scan(materialized);for(const stage of plan.stages)assert(copies.some(row=>row.assetId===stage.assetId),'MATERIALIZED_MODEL_NOT_FOUND:'+stage.assetId);report.materializedModelCopies=copies;save();
  await stop();if(api.cancelled?.())throw Error('TEST_CANCELLED');await start('promo-cold');await openExistingWorld(worldId);report.reopened=await rpc('godotObserve');report.reopenedSnapshot=await rpc('godotSnapshot');report.reopenedSource=await pkg('sourceList');save();
  assert.equal(report.reopened.buildId,report.after.buildId);assert.notEqual(report.reopened.instanceId,report.after.instanceId);assert.deepEqual(promoBody(report.reopenedSnapshot),promoBody(report.saved),'COLD_PROGRESS_CHANGED');
  assert.deepEqual(report.reopenedSource.items.map(x=>x.entityId).sort(),report.source.items.map(x=>x.entityId).sort());
  for(const row of report.operations){row.coldStatus=await nav('library.direct',{action:'status',worldId,operationId:row.operationId});assert.equal(row.coldStatus.status,'applied');assert.deepEqual(row.coldStatus.instanceIds,row.applied.instanceIds);assert.deepEqual(row.coldStatus.ref,row.applied.ref);}
  await closeAssets();report.reopenedCapture=await capture('promo-six-cold');report.passed=true;mark('Six ordinary-library stages and actual input probes retained formal progress on cold reopen');
}
