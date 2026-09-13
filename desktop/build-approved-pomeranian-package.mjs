import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {PET_SOURCE_REQUIREMENTS} from './build-builtin-pet-package.mjs';
import {RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256,componentBridgeProfiles} from './released-component-bridge.mjs';

export const APPROVED_POMERANIAN_ID='cw.module.approved-pomeranian';
export const APPROVED_POMERANIAN_SHA256='1ab9f354598df75504b061fb06e1e5e386bd59c878afcec3bad8388832dadd0b';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(yes,code)=>{if(!yes)throw Error(code);};

export function buildApprovedPomeranianPackage({repository,root=path.join(repository,'desktop/godot/components/approved-pomeranian'),version=1}){
  check(version===1||version===2,'COMPONENT_VERSION_UNSUPPORTED');
  const model=fs.readFileSync(path.join(root,'model.glb'));
  check(model.length===3753144&&hash(model)===APPROVED_POMERANIAN_SHA256,'APPROVED_POMERANIAN_MODEL_CHANGED');
  const provenance=JSON.parse(fs.readFileSync(path.join(root,'provenance.json')));
  check(provenance.model.sha256===APPROVED_POMERANIAN_SHA256&&provenance.model.bytes===model.length,'APPROVED_POMERANIAN_LINEAGE_INVALID');
  const prefix='res://addons/'+APPROVED_POMERANIAN_ID+'/';
  const files={
    'model.glb':model,
    'model.glb.import':Buffer.from('[remap]\nimporter="scene"\ntype="PackedScene"\n\n[params]\nmeshes/generate_lods=false\n'),
    'companion.gd':fs.readFileSync(path.join(root,'companion.gd')),
    'companion.gd.uid':fs.readFileSync(path.join(root,'companion.gd.uid')),
    'LICENSE.txt':fs.readFileSync(path.join(root,'LICENSE.txt')),
    'provenance.json':Buffer.from(JSON.stringify(provenance,null,2)+'\n'),
    'companion.tscn':Buffer.from(`[gd_scene load_steps=3 format=3]\n\n[ext_resource type="Script" path="${prefix}companion.gd" id="1"]\n[ext_resource type="PackedScene" path="${prefix}model.glb" id="2"]\n\n[node name="ApprovedPomeranian" type="CharacterBody3D"]\nscript = ExtResource("1")\nentity_id = "pet"\ncompanion_name = "小麦"\nappearance_key = "pomeranian-white"\npomeranian_visual = ExtResource("2")\n`),
  };
  check(Object.values(files).reduce((sum,bytes)=>sum+bytes.length,0)<=4*1024*1024,'APPROVED_POMERANIAN_COMPONENT_TOO_LARGE');
  const pin=([name,source])=>({path:name,sha256:source==='desktop/godot/shared/runtime_bridge_engine_v1.gd'?RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256:hash(fs.readFileSync(path.join(repository,source)))});
  const controllerPins=[
    ['craftmine_shared/base_adapter.gd','desktop/godot/shared/adapters/creation-sandbox-controller-v2.gd'],
    ['craftmine_shared/base_adapter_controller_v1.gd','desktop/godot/shared/adapters/creation-sandbox-controller-v1.gd'],
    ['craftmine_shared/base_adapter_legacy.gd','desktop/godot/shared/adapters/creation-sandbox.gd'],
    ['craftmine_shared/progress_collision.gd','desktop/godot/shared/progress_collision.gd'],
  ];
  const sourceRequirementProfiles=[
    {id:'legacy-component-runtime',requirements:PET_SOURCE_REQUIREMENTS.slice(1).map(pin)},
    {id:'creation-player-collision/1',requirements:[...controllerPins,PET_SOURCE_REQUIREMENTS[2]].map(pin)},
    {id:'creation-player-collision/1+engine-monitor/1',requirements:[...controllerPins,
      ['craftmine_shared/runtime_bridge.gd','desktop/godot/shared/runtime_bridge_engine_v1.gd'],
      ['craftmine_shared/runtime_bridge_base.gd','desktop/godot/shared/runtime_bridge.gd'],
      ['craftmine_shared/engine_performance.gd','desktop/godot/shared/engine_performance.gd']].map(pin)},
  ];
  const content={assetId:APPROVED_POMERANIAN_ID,version,kind:'module',
    files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],
    entry:{entities:['pet'],label:'演示同款可爱白色博美',
      description:'已认可演示里的同款白色博美。能在平地跟随、近距离抚摸和等待，并保存名字、外观、跟随开关、位置及抚摸次数。重复安装创建独立伙伴。不会寻路、驾驶或战斗。',
      aliases:['博美','白色博美','可爱博美','同款博美','小麦','pomeranian','cute white dog','Mochi'],
      capabilities:['follow-flat-ground','pet-interaction','wait','persistent-state','independent-instances'],
      style:'soft-round-white-pomeranian',
      orientation:{modelForward:'+Z',componentForward:'-Z',visualYawDegrees:180},
      sceneInstall:{mode:'instance',sceneFile:'companion.tscn',identityField:'entity_id',identityType:'String'},
      sourceRequirements:[pin(PET_SOURCE_REQUIREMENTS[0])],sourceRequirementProfiles,
      placement:{anchor:'feet',dimensionsMm:[370,265,370]},
      appearances:[{key:'pomeranian-white',scene:'model.glb',sha256:APPROVED_POMERANIAN_SHA256,acceptedDemoAppearance:true},
        {key:'pomeranian-cream',scene:'model.glb',sha256:APPROVED_POMERANIAN_SHA256,acceptedDemoAppearance:false,variant:'instance-local-material-tint'}],
      editableSettings:{companion_name:'settings.name',appearance_key:'settings.appearanceKey',following:'settings.following'},
      playerBinding:{nodePath:'../Player',scope:'creation-sandbox'},interaction:{action:'interact',routing:'managed-base-component-ray',maximumDistanceMm:3000},
      waiting:{sourceSetting:'following',value:false,resumeValue:true,method:'set_following'},
      animation:{mode:'static-model-root-locomotion',skinning:false,clips:[]},lineage:provenance},
    interfaces:{persistentComponent:{group:'craftmine_persistent_components',identityProperty:'entity_id',methods:['snapshot','validate_state','restore','validate_restored_state']},interaction:{method:'interact',actor:'Player'}},
    compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},
    state:{kind:'persistent-component',format:'craftmine.pet-companion-state/1',ledger:'/body/components',identity:'entityId',settings:['name','appearanceKey','following'],sourceSettings:['name','appearanceKey','following'],runtimeFields:['position','yaw','interactionCount'],removedIdentity:'retain-last-saved-state',sourceSettingsMigration:'changed-source-defaults-only'},
    licenses:{wrapperLicense:'MIT',licenseFile:'LICENSE.txt',modelLicense:provenance.model.license,modelLicenseStatus:'unverified',distribution:'local-product-reuse-no-remote-publication'}
  };
  content.entry.sourceRequirementProfiles=componentBridgeProfiles(content.entry.sourceRequirementProfiles,version);
  const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
  const bytes=packStaticPackage({root:{id:APPROVED_POMERANIAN_ID,version},resources:[{manifest,files}]});
  check(bytes.length<=5*1024*1024,'APPROVED_POMERANIAN_ZIP_TOO_LARGE');
  unpackStaticPackage(bytes);
  const file=APPROVED_POMERANIAN_ID+(version===1?'':'.v'+version)+'.zip';
  return {file,bytes,entry:{assetId:APPROVED_POMERANIAN_ID,version,kind:'module',file,bytes:bytes.length,sha256:hash(bytes),rootContentHash:manifest.contentHash,label:content.entry.label,
    tags:[...(version===2?['compatibility-version']:[]),'builtin','prefab','playable','approved-demo','博美','白色博美','同款博美','可爱','小麦','pomeranian','dog','Mochi','跟随','follow','抚摸','pet','等待','wait'],
    source:{origin:'Craftmine approved demo 2026-09-13 / Codex gpt-6-astra xhigh / Blender reference-guided model',author:'Craftmine project generated content',license:'MIT wrapper; generated model rights unverified',licenseStatus:'unverified'}}};
}
