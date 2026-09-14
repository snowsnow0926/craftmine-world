'use strict';
// Composition is a source-bound plan, never an installer or gameplay verifier.
const {createHash}=require('node:crypto');
const pins=require('./world-composition-pins.json');
const {companionPositionConfiguration}=require('./companion-position-bounds.cjs');
const {enrichCompanionSourceFiles}=require('./companion-root-binding.mjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const check=(yes,code)=>{if(!yes)throw Error(code);};
const exact=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),'COMPOSITION_INVALID_PARAMS');
const recipes=[
  {id:'companion-exploration',version:1,label:{zh:'伙伴探索',en:'Companion exploration'},description:{zh:'保留当前世界，组合伙伴和探索场景。',en:'Keep the current world and combine a companion with an exploration scene.'},defaults:{scenery:'keep',companion:true,weather:'keep',collectionCount:0}},
  {id:'rain-exploration',version:1,label:{zh:'雨中漫游',en:'Rain exploration'},description:{zh:'保留步行与相机，加入可操控的雨。',en:'Add controllable rain while preserving walking and the camera.'},defaults:{scenery:'keep',companion:false,weather:'rain',collectionCount:0}},
  {id:'collect-unlock-flight',version:1,label:{zh:'收集物品解锁飞行',en:'Collect to unlock flight'},description:{zh:'组合伙伴、收集任务和飞机；AI 需补齐任务与真实跑道。',en:'Combine a companion, collection quest and aircraft; the agent must implement the quest and a real runway.'},defaults:{scenery:'keep',companion:true,weather:'keep',collectionCount:3}},
];
function catalog(){return {format:'craftmine.world-composition-catalog/1',recipes:recipes.map(row=>({...structuredClone(row),version:3})),supportedRecipeVersions:[1,2,3],choices:{scenery:[{id:'keep',label:{zh:'保留当前场景',en:'Keep current scenery'}},{id:'forest',label:{zh:'增加森林入口',en:'Add forest gateway'}},{id:'city-street',label:{zh:'增加城市街区片段',en:'Add city street fragment'}}],weather:[{id:'keep',label:{zh:'保留当前天气',en:'Keep current weather'}},{id:'rain',label:{zh:'加入可操控的雨',en:'Add controllable rain'}}]},scope:'current-world-preserved',applied:false};}
function request(input){
  exact(input,['recipeId','recipeVersion','choices','wish']);
  const recipe=recipes.find(row=>row.id===input.recipeId&&[1,2,3].includes(input.recipeVersion));check(recipe,'COMPOSITION_RECIPE_VERSION_REQUIRED');
  exact(input.choices,['scenery','companion','weather','collectionCount']);const choices=input.choices;
  check(['keep','forest','city-street'].includes(choices.scenery)&&typeof choices.companion==='boolean'&&['keep','rain'].includes(choices.weather)&&Number.isInteger(choices.collectionCount),'COMPOSITION_CHOICES_REQUIRED');
  check(recipe.id==='collect-unlock-flight'?choices.collectionCount>=1&&choices.collectionCount<=12:choices.collectionCount===0,'COMPOSITION_COLLECTION_COUNT_INVALID');
  check(input.wish===undefined||typeof input.wish==='string'&&Buffer.byteLength(input.wish)<=6000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.wish),'COMPOSITION_WISH_INVALID');
  return {recipeId:recipe.id,recipeVersion:input.recipeVersion,choices:{...choices},wish:input.wish??''};
}
function selectedAssets(input){
  const chosen=[];
  if(input.choices.scenery==='forest')chosen.push('cw.scene.forest-gateway');
  if(input.choices.scenery==='city-street')chosen.push('cw.city.ward-street');
  if(input.choices.companion)chosen.push('cw.module.approved-pomeranian');
  if(input.choices.weather==='rain')chosen.push('cw.module.rain-control');
  if(input.recipeId==='collect-unlock-flight')chosen.push('cw.module.reusable-j20');
  return chosen.map(id=>{const version=input.recipeVersion===3&&id==='cw.module.approved-pomeranian'?3:input.recipeVersion>=2&&['cw.module.approved-pomeranian','cw.module.rain-control'].includes(id)?2:1;const entry=pins.entries.find(row=>row.assetId===id&&row.version===version);check(entry,'COMPOSITION_PIN_MISSING');return entry;});
}
function assessRequirements(entry,files){
  const evaluate=items=>(items??[]).map(item=>({path:item.path,expectedSha256:item.sha256,status:files.has(item.path)?files.get(item.path).sha256===item.sha256?'matched':'changed':'missing'}));
  const required=evaluate(entry.sourceRequirements);
  const profiles=(entry.sourceRequirementProfiles??[]).map(profile=>({id:profile.id,files:evaluate(profile.requirements)}));
  return {status:required.every(item=>item.status==='matched')&&(!profiles.length||profiles.some(profile=>profile.files.every(item=>item.status==='matched')))?'source-requirements-matched':'adaptation-required',required,profiles};
}
function createWorldComposition({call,ensureBuiltin,readArchive}){
  async function plan(input,{worldId,context,assertActive=()=>{}}){
    const selected=request(input);check(typeof worldId==='string'&&worldId.length>0,'COMPOSITION_WORLD_REQUIRED');assertActive();
    const world=await call('world.read',{id:worldId});check(world.runtimeKind==='godot','GODOT_WORLD_REQUIRED');
    context??=(await call('godotProject.sourceContext',{worldId})).context;
    const files=new Map();let identity,offset=0;
    do{
      assertActive();const index=await call('godotProject.index',{context,worldId,offset,limit:32,...(identity?{revision:identity.revision,manifestHash:identity.manifestHash}:{})});
      check(index.worldId===worldId&&Number.isSafeInteger(index.revision)&&/^[a-f0-9]{64}$/.test(index.manifestHash)&&Array.isArray(index.files),'COMPOSITION_SOURCE_IDENTITY_REQUIRED');
      identity??=index;check(identity.revision===index.revision&&identity.manifestHash===index.manifestHash,'COMPOSITION_SOURCE_CHANGED');
      for(const file of index.files){check(typeof file.path==='string'&&/^[a-f0-9]{64}$/.test(file.sha256)&&!files.has(file.path),'COMPOSITION_SOURCE_INDEX_INVALID');files.set(file.path,file);}
      check(files.size<=8192,'COMPOSITION_SOURCE_TOO_LARGE');
      if(index.nextOffset!=null)check(Number.isSafeInteger(index.nextOffset)&&index.nextOffset>offset,'COMPOSITION_SOURCE_INDEX_INVALID');
      offset=index.nextOffset;
    }while(offset!=null);
    await enrichCompanionSourceFiles(call,context,worldId,identity,files,assertActive);
    await ensureBuiltin();const components=[];
    for(const pin of selectedAssets(selected)){
      assertActive();const record=await call('asset.read',{assetId:pin.assetId,version:pin.version}),version=record.version_;
      check(version?.assetId===pin.assetId&&version.version===pin.version&&version.mediaKind==='package'&&version.files?.length===1&&version.files[0].sha256===pin.archiveSha256,'COMPOSITION_PIN_CHANGED');
      const ref={assetId:pin.assetId,version:pin.version,contentHash:version.contentHash};
      const archive=await readArchive(ref);check(!archive.worldTemplate&&archive.archive.archiveSha256===pin.archiveSha256,'COMPOSITION_PIN_CHANGED');
      const resource=archive.archive.resources.find(row=>row.manifest.content.assetId===pin.assetId)?.manifest;
      check(resource?.contentHash===pin.rootContentHash,'COMPOSITION_PIN_CHANGED');
      const content=resource.content,entry=content.entry;
      components.push({archiveRef:ref,archiveSha256:pin.archiveSha256,rootContentHash:pin.rootContentHash,displayName:version.displayName,source:version.source,
        sourceRequirements:assessRequirements(entry,files),existingSource:files.has('addons/'+pin.assetId+'/'+entry.sceneInstall.sceneFile)?'component-files-present-inspect-instances':'not-observed',
        kind:content.kind,compatibility:{declared:content.compatibility,status:content.compatibility?.base===identity.baseId&&(!content.compatibility.engine||content.compatibility.engine===identity.engineVersion)?'base-and-engine-matched':'adaptation-required'},capabilities:entry.capabilities??[],placement:entry.placement??null,airspaceRequirements:entry.airspaceRequirements??null,controls:entry.controls??null,playerBinding:entry.playerBinding??entry.integration??null,exclusiveCapability:entry.exclusiveCapability??null,state:content.state,interfaces:content.interfaces,
        ...(content.entry.positionValidation?{positionValidation:content.entry.positionValidation,sourceConfiguration:companionPositionConfiguration(files,identity)}:{}),
        nextAction:'read-exact-component-and-inspect-target-before-propose',applied:false});
    }
    const checks=[
      {id:'preserve-world',status:'required',detail:'Keep the current world, authored gameplay, player, camera and saved progress. Scenery choices add fragments, never replace a requested whole city.'},
      {id:'placement',status:'runtime-verification-required',detail:'Inspect actual ground, clearances, reachable spawn and component bounds. Template placement is not a captured player target.'},
      {id:'controller-camera',status:'inspection-required',detail:'Inspect existing player/camera ownership. Do not add a second movement controller or replace the active camera.'},
      {id:'state-identities',status:'verification-required',detail:'Use independent persistent entity IDs; save and cold reopen before claiming progress survives.'},
      {id:'input-conflicts',status:'inspection-required',detail:'Compare declared component controls with existing input and unhandled key handlers. Keep on-foot and piloted input mutually exclusive.'},
    ];
    if(selected.choices.weather==='rain')checks.push({id:'weather-owner',status:files.has('addons/cw.module.rain-control/rain_control.gd')?'possible-conflict':'inspection-required',detail:'Only one weather owner. Existing component files require checking live instances; legacy advance_rain/resume_rain controllers also conflict. Retain or adapt the current controller instead of adding a duplicate.'});
    const missingLogic=[];
    if(selected.recipeId==='collect-unlock-flight'){
      checks.push({id:'physical-runway',status:'runtime-verification-required',detail:'Requires a real level 2400 m × 56 m runway, identity parent, unit aircraft scale, center 2.18 m above collider, negative-Z heading and open airspace. Call the aircraft inspect_runway against real collision. The stock 64 m sandbox is insufficient.'});
      missingLogic.push({id:'collection-objective',count:selected.choices.collectionCount,implementation:'agent-source-adaptation',detail:'Create reachable collectible objects with stable IDs, one-time collection, visible objective progress and persistent collected IDs. Do not count proximity to scenery or spawn completion.'});
      missingLogic.push({id:'flight-unlock',implementation:'agent-source-adaptation',detail:'Connect collection completion to an aircraft-scoped boarding gate. Before completion interaction must remain locked; after completion normal collision/runway checks still apply. Keep landed exit available and preserve existing flight state.'});
      checks.push({id:'quest-flight',status:'verification-required',detail:'Play the unfinished quest, verify locked boarding, collect every target, verify unlock and actual takeoff/landing, then save and cold reopen. A visible aircraft or a passed compile is not gameplay acceptance.'});
    }
    // Recheck the current view after all immutable archive reads; a plan cannot
    // silently combine one source revision with a newer selected world draft.
    assertActive();const final=await call('godotProject.index',{context,worldId,offset:0,limit:1});
    check(final.worldId===worldId&&final.revision===identity.revision&&final.manifestHash===identity.manifestHash,'COMPOSITION_SOURCE_CHANGED');
    const body={format:'craftmine.world-composition-plan/1',worldId,request:selected,source:{revision:identity.revision,manifestHash:identity.manifestHash,baseId:identity.baseId??null,engineVersion:identity.engineVersion??null},components,checks,missingLogic,
      scope:'current-world-preserved',status:'requires-agent-adaptation-and-checks',compatibility:'not-runtime-verified',applied:false,
      nextSteps:['Read exact archiveRef via godot_source_library mode=read; inspect actual current source and installed instances.','Propose reusable components through existing propose/propose-group; adapt custom source and missing logic through the normal draft tools.','Run normal source check, actual gameplay verification and player candidate adoption.','Save/reopen and publish a new template only after the player confirms the result.']};
    return {...body,planHash:hash(JSON.stringify(body))};
  }
  return {catalog,plan};
}
module.exports={compositionCatalog:catalog,validateCompositionRequest:request,selectedAssets,assessRequirements,createWorldComposition};
