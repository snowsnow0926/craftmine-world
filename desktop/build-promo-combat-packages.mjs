import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const PROMO_COMBAT_MODEL_PINS=Object.freeze({
  monsters:{file:'hornling.glb',bytes:57432,sha256:'775ec49dcf1ee9f7fbab8155c1f56b4071c24390fc07f00981626c820a146e69',sourceJobId:'bef967e4-6830-4439-a08f-68361a3e32f0'},
  heavyblade:{file:'heavyblade.glb',bytes:83592,sha256:'c32983d66bec11463046f3e66b5c5309225df975cf93ad28878b241c9cc2ccad',sourceJobId:'41a3e161-9855-46d5-b143-4e41dad1762a'},
  hunt:{file:'riftbeast.glb',bytes:336872,sha256:'88f9128fbb8e3d246897e97925fe688cd9b6f82d026465cd70c79bc4cda71298',sourceJobId:'c1ab3278-4931-408e-a1c8-d4c180cf72a3'},
  ak47:{file:'ak47.glb',bytes:210864,sha256:'066a2666ad71f850856052a9b0480a642e04a5d60c000ee48910170dd5bad25c',sourceJobId:'9b2bac9f-6271-4231-bbfe-73ba99490fcd'},
});
const stages={
  monsters:{label:'宣传片同款六只角怪',description:'直接复用宣传片里的六只角怪：靠近追击、蓄力近战、击倒、R 恢复和保存各怪物生命。自动创建六只怪物及不可见玩家生命组件；不附赠剑、AK 或巨兽。需要明确的平地活动范围，不具备完整导航寻路。',scene:'encounter.tscn',entities:['encounter'],tags:['小怪','怪物','角怪','hornling','monster','enemy','combat'],automatic:['encounter-root','six-hornlings','shared-invisible-player-combat-context'],formats:['craftmine.promo-combat-context/1','craftmine.promo-encounter/1','craftmine.promo-hornling/1']},
  heavyblade:{label:'宣传片同款重刃',description:'直接复用宣传片重刃模型与轻重斩、耐力和闪避。可单独装备，也能打已安装的宣传片角怪；不附带怪物、竞技场或巨兽。J/左键轻斩，K/右键重斩，Shift闪避；方向键转视角。巨兽试炼需另装。',scene:'blade.tscn',entities:['blade'],tags:['剑','重刃','重剑','大剑','heavyblade','sword','melee','weapon'],automatic:['heavyblade-equipment','shared-invisible-player-combat-context'],formats:['craftmine.promo-combat-context/1','craftmine.promo-heavyblade/1']},
  hunt:{label:'宣传片同款裂岳兽试炼',description:'复用宣传片裂岳兽与真实横扫、冲撞、怒化、破绽和胜负记录。需要先安装同款重刃；自动加入一只巨兽、试炼标牌和试炼围栏，不新发第二把剑。需明确22×28米平整无障碍场地；H明确进入，B返回。加载不传送、不清场。',scene:'hunt.tscn',entities:['hunt'],tags:['巨兽','裂岳兽','怪猎','试炼','大型怪物','大怪物','狩猎','riftbeast','boss','hunt'],automatic:['one-riftbeast','trial-sign','trial-only-barriers','shared-invisible-player-combat-context'],formats:['craftmine.promo-combat-context/1','craftmine.promo-hunt/1']},
  ak47:{label:'宣传片同款 AK47',description:'复用宣传片 AK47 模型、连射、瞄准、后坐力、30发弹匣与换弹。可独立装备，不附带怪物、剑或巨兽。能打已安装的宣传片角怪或试炼中的裂岳兽；J/左键连射，K/右键瞄准，R换弹，方向键转视角。若已装重刃，2/3切换。',scene:'rifle.tscn',entities:['rifle'],tags:['AK47','AK','枪','步枪','连射','rifle','gun','weapon'],automatic:['ak47-equipment','shared-invisible-player-combat-context'],formats:['craftmine.promo-combat-context/1','craftmine.promo-ak47/1']},
};

export function buildPromoCombatPackage({repository=process.cwd(),stage}={}){
  const spec=stages[stage],pin=PROMO_COMBAT_MODEL_PINS[stage];
  if(!spec)throw Error('PROMO_COMBAT_STAGE_UNSUPPORTED');
  const assetId='cw.module.promo-'+stage,version=1;
  const directory=path.join(repository,'desktop/godot/components/reusable-promo-combat');
  const origin='desktop/godot/shared/promo-templates/promo-mainline/source';
  const model=fs.readFileSync(path.join(repository,origin,'assets/blender',pin.file));
  if(model.length!==pin.bytes||hash(model)!==pin.sha256)throw Error('PROMO_COMBAT_ORIGINAL_MODEL_CHANGED');
  const readSource=file=>Buffer.from(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'));
  const files={'core.gd':readSource(path.join(directory,'core.gd')),'model.glb':model,
    'model.glb.import':Buffer.from('[remap]\nimporter="scene"\ntype="PackedScene"\n\n[params]\nmeshes/generate_lods=false\n')};
  for(const name of fs.readdirSync(path.join(directory,stage)).sort()) files[name]=readSource(path.join(directory,stage,name));
  for(const name of Object.keys(files).filter(name=>name.endsWith('.gd')))
    files[name+'.uid']=Buffer.from('uid://'+hash(Buffer.from(assetId+'/v1/'+name)).slice(0,12)+'\n');
  const lineage={template:'promo-mainline',sourceCommit:'fb2752c898811da4274bad3b0e4cae3eb32d780b',model:{...pin,sourcePath:origin+'/assets/blender/'+pin.file,byteIdentical:true},adaptation:'Source-local component split from the existing promotional combat. Original template and model bytes are unchanged.'};
  const behaviorSources={monsters:['scripts/monsters/encounter.gd','scripts/monsters/hornling.gd'],heavyblade:['scripts/hunt/duel.gd','scripts/hunt/hunter_input_guard.gd'],hunt:['scripts/hunt/duel.gd','scripts/hunt/riftbeast.gd'],ak47:['scripts/weapons/ak47.gd']}[stage];
  lineage.behaviorSources=behaviorSources.map(name=>{const bytes=fs.readFileSync(path.join(repository,origin,name));return {path:origin+'/'+name,bytes:bytes.length,sha256:hash(bytes)};});
  files['ORIGINAL_ASSETS_LICENSE.txt']=fs.readFileSync(path.join(repository,origin,'licenses/ORIGINAL_ASSETS_LICENSE.txt'));
  lineage.originalLicense={path:origin+'/licenses/ORIGINAL_ASSETS_LICENSE.txt',sha256:hash(files['ORIGINAL_ASSETS_LICENSE.txt']),scope:'Preserved original declaration; generated-model rights have not been independently verified.'};
  // Source-file hash evidence is a build concern. Runtime uses a versioned protocol,
  // since exported/compiled scripts need not expose their source text.
  lineage.sharedHelperSha256=hash(files['core.gd']);
  files['provenance.json']=Buffer.from(JSON.stringify(lineage,null,2)+'\n');
  files['README.md']=Buffer.from(spec.description+'\n\nPlayer and camera paths are explicit paths relative to the receiving world root. Root transforms must have unit scale and no rotation. The shared invisible context is identified by the player path and retains health/equipment across later installations. No package rewrites the world root. No module regenerates any GLB.\n');
  const content={assetId,version,kind:'module',files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],
    entry:{entities:spec.entities,label:spec.label,description:spec.description,aliases:spec.tags,capabilities:['persistent-state','promotional-model-reuse'],
      sceneInstall:{mode:'instance',sceneFile:spec.scene,identityField:'entity_id',identityType:'String'},
      sourceRequirements:[{path:'scripts/scene_contract.gd',sha256:hash(fs.readFileSync(path.join(repository,'desktop/godot/bases/creation-sandbox/scripts/scene_contract.gd')))},...(stage==='hunt'?[{path:'addons/cw.module.promo-heavyblade/blade.gd',sha256:hash(readSource(path.join(directory,'heavyblade/blade.gd')))}]:[])],
      installationGuide:{automaticNodes:spec.automatic,notIncluded:stage==='monsters'?['heavyblade','riftbeast','AK47','arena','magic-pulse']:stage==='hunt'?['hornlings','additional-heavyblade','AK47']:stage==='ak47'?['hornlings','heavyblade','riftbeast','arena']:['hornlings','riftbeast','arena','AK47'],requiredConfiguration:[...(stage==='hunt'?['Install cw.module.promo-heavyblade v1 first; the exact installed blade script is hash-pinned. Configure a 22 x 28 meter flat clear arena centered at this root.']:[]),'Unique creation-sandbox Player with look, movement, snapshot and movement-lock interfaces.','Explicit camera_path and player_path; root-relative default Player and Player/CameraRig/PitchPivot/Camera3D.',...(stage==='monsters'?['Flat walkable unobstructed encounter footprint: local X [-26,26], Z [-37,10], height compatible with original capsule. Set saved_position_min/max to the receiving world bounds before adoption; the package does not clear terrain or teleport the player.']:[])],repeatedInstall:stage==='monsters'?'Adds a new encounter with derived independent monster identities; shared player health is reused.':'Exactly one instance of this equipment role per player; duplicate installation is rejected at runtime check.'},
      ...(stage==='hunt'?{arena:{anchor:'center-at-ground-height',widthMm:22000,depthMm:28000,clearHeightMm:4600,rotationDegrees:0,scale:1,groundToleranceMm:50,entry:'H-only-explicit-trial-entry',exit:'B-return-to-saved-entry-pose',loadTeleportsPlayer:false,clearsTerrain:false,requiresFlatUnobstructedFootprint:true},requiredModules:[{assetId:'cw.module.promo-heavyblade',version:1,automaticInstall:false}]}:{}),
      playerBinding:{scope:'receiving-world',playerPath:'Player',cameraPath:'Player/CameraRig/PitchPivot/Camera3D'},lineage},
    interfaces:{persistentComponent:{group:'craftmine_persistent_components',identityProperty:'entity_id',methods:['snapshot','validate_state','restore']},sharedContext:{protocol:'craftmine.promo-combat-context/1',group:'craftmine_promo_context',identity:'sha256-of-explicit-player-path',singletonPerWorld:true}},
    compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},
    state:{kind:'persistent-component',formats:spec.formats,ledger:'/body/components',oldWorld:'unchanged',laterModuleInstall:'preserve-existing-identity-and-state'},
    licenses:{wrapperLicense:'MIT',originalDeclarationFile:'ORIGINAL_ASSETS_LICENSE.txt',modelLicenseStatus:'unverified',distribution:'local-product-reuse-no-remote-publication'}};
  const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
  const bytes=packStaticPackage({root:{id:assetId,version},resources:[{manifest,files}]});
  unpackStaticPackage(bytes);
  const file=assetId+'.zip';
  return {file,bytes,entry:{assetId,version,kind:'module',file,bytes:bytes.length,sha256:hash(bytes),rootContentHash:manifest.contentHash,label:spec.label,tags:['builtin','playable','approved-demo','reusable-world-content',...spec.tags],source:{origin:'Craftmine promotional mainline / Codex gpt-6-astra xhigh / Blender',author:'Craftmine project generated content',license:'MIT wrapper; generated model rights unverified',licenseStatus:'unverified'}}};
}

export function buildPromoCombatPackages(options={}){return Object.keys(stages).map(stage=>buildPromoCombatPackage({...options,stage}));}
