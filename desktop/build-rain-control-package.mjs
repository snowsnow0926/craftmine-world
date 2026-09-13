import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {PET_SOURCE_REQUIREMENTS} from './build-builtin-pet-package.mjs';

export const RAIN_CONTROL_ID='cw.module.rain-control';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(yes,code)=>{if(!yes)throw Error(code);};
export function buildRainControlPackage({repository,root=path.join(repository,'desktop/godot/components/rain-control')}){
  const provenance=JSON.parse(fs.readFileSync(path.join(root,'provenance.json')));
  check(provenance.format==='craftmine.rain-control-provenance/1'&&provenance.sourceWorld==='promo-rain','RAIN_PROVENANCE_INVALID');
  check(Array.isArray(provenance.sourceFiles)&&provenance.sourceFiles.length===3&&new Set(provenance.sourceFiles.map(file=>file.path)).size===3,'RAIN_PROVENANCE_SOURCES_INVALID');
  for(const file of provenance.sourceFiles){
    check(['scripts/rain_world.gd','scripts/rain_magic_state.gd','shaders/rain_water.gdshader'].includes(file.path),'RAIN_PROVENANCE_PATH_INVALID');
    const bytes=fs.readFileSync(path.join(repository,'desktop/godot/shared/promo-templates/promo-rain/source',file.path));
    check(bytes.length===file.bytes&&hash(bytes)===file.sha256,'RAIN_APPROVED_SOURCE_CHANGED');
  }
  // New wrapper text is canonical across worktree checkout line endings. The
  // inherited shader's approved LF encoding and lineage pin are preserved too.
  const files=Object.fromEntries(['rain_control.gd','rain_control.gd.uid','LICENSE.txt'].map(name=>[name,Buffer.from(fs.readFileSync(path.join(root,name),'utf8').replaceAll('\r\n','\n'))]));
  files['provenance.json']=Buffer.from(JSON.stringify(provenance,null,2)+'\n');
  files['rain_water.gdshader']=Buffer.from(fs.readFileSync(path.join(root,'rain_water.gdshader'),'utf8').replaceAll('\r\n','\n'));
  check(hash(files['rain_water.gdshader'])===provenance.sourceFiles.find(file=>file.path==='shaders/rain_water.gdshader').sha256,'RAIN_ORIGINAL_SHADER_CHANGED');
  const prefix='res://addons/'+RAIN_CONTROL_ID+'/';
  files['rain_control.tscn']=Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="${prefix}rain_control.gd" id="1"]\n\n[node name="RainControl" type="Node3D"]\nscript = ExtResource("1")\nentity_id = "rain"\n`);
  check(Object.values(files).reduce((sum,bytes)=>sum+bytes.length,0)<=4*1024*1024,'RAIN_COMPONENT_TOO_LARGE');
  const pin=([name,source])=>({path:name,sha256:hash(fs.readFileSync(path.join(repository,source)))});
  const controllerPins=[
    ['craftmine_shared/base_adapter.gd','desktop/godot/shared/adapters/creation-sandbox-controller-v2.gd'],
    ['craftmine_shared/base_adapter_controller_v1.gd','desktop/godot/shared/adapters/creation-sandbox-controller-v1.gd'],
    ['craftmine_shared/base_adapter_legacy.gd','desktop/godot/shared/adapters/creation-sandbox.gd'],
    ['craftmine_shared/progress_collision.gd','desktop/godot/shared/progress_collision.gd'],
  ];
  const content={assetId:RAIN_CONTROL_ID,version:1,kind:'module',
    files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],
    entry:{entities:['rain'],label:'可复用控雨：悬停与倒流',
      description:'把2200颗动态雨滴与凝雨、悬停、逆流、恢复降雨和自动施法加入现有造物世界。悬停时玩家仍可自由移动；保存雨滴高度、阶段、计时和施法次数。保留已有玩家、相机、地面和天空。一个世界只允许一个天气控制器；不包含庭院或整世界。',
      aliases:['控雨','雨滴悬停','雨滴倒流','雨的逆序','暂停雨滴','rain control','freeze rain','reverse rain'],
      capabilities:['moving-rain','suspend-rain-while-player-walks','reverse-rain','normal-rain','automatic-cast','persistent-state'],
      sceneInstall:{mode:'instance',sceneFile:'rain_control.tscn',identityField:'entity_id',identityType:'String'},
      sourceRequirements:[pin(PET_SOURCE_REQUIREMENTS[0])],
      sourceRequirementProfiles:[
        {id:'legacy-component-runtime',requirements:PET_SOURCE_REQUIREMENTS.slice(1).map(pin)},
        {id:'creation-player-collision/1',requirements:[...controllerPins,PET_SOURCE_REQUIREMENTS[2]].map(pin)},
        {id:'creation-player-collision/1+engine-monitor/1',requirements:[...controllerPins,
          ['craftmine_shared/runtime_bridge.gd','desktop/godot/shared/runtime_bridge_engine_v1.gd'],
          ['craftmine_shared/runtime_bridge_base.gd','desktop/godot/shared/runtime_bridge.gd'],
          ['craftmine_shared/engine_performance.gd','desktop/godot/shared/engine_performance.gd']].map(pin)},
      ],
      placement:{anchor:'ground-volume-origin',dimensionsMm:[60000,14000,60000],rotation:'identity',scale:'unit'},
      controls:{advance:'U',normal:'I',automatic:'O',routing:'unhandled-unmodified-key',configurableProperties:['advance_keycode','normal_keycode','automatic_keycode'],changesInputMap:false},
      exclusiveCapability:{group:'craftmine_weather_controllers',scope:'existing-player-world',conflict:'reject-check-and-save',multipleInstances:'remove-extra-controller-before-apply',legacyOwnerDetection:['advance_rain','resume_rain']},
      integration:{playerPath:'../Player',replacesPlayer:false,replacesCamera:false,replacesEnvironment:false,worldSourcePreserved:true,weatherArea:'fixed-local-volume',roofOcclusion:false},
      lineage:provenance},
    interfaces:{persistentComponent:{group:'craftmine_persistent_components',identityProperty:'entity_id',methods:['snapshot','validate_state','restore','validate_restored_state']},rainControl:{method:'request_action',actions:['advance','normal','automatic']}},
    compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},
    state:{kind:'persistent-component',format:'craftmine.rain-control-state/1',ledger:'/body/components',identity:'entityId',runtimeFields:['phase','velocity','phaseAge','rainClock','automatic','casts','heights'],heightEncoding:'four-canonical-base64-float32-chunks',removedIdentity:'retain-last-saved-state'},
    licenses:{author:'Craftmine World contributors',license:'MIT',licenseFile:'LICENSE.txt',source:'Accepted project rain world; original water shader and adapted simulation; procedural geometry'}
  };
  const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
  const bytes=packStaticPackage({root:{id:RAIN_CONTROL_ID,version:1},resources:[{manifest,files}]});
  check(bytes.length<=5*1024*1024,'RAIN_PACKAGE_TOO_LARGE');unpackStaticPackage(bytes);
  const file=RAIN_CONTROL_ID+'.zip';
  return {file,bytes,entry:{assetId:RAIN_CONTROL_ID,version:1,kind:'module',file,bytes:bytes.length,sha256:hash(bytes),rootContentHash:manifest.contentHash,label:content.entry.label,
    tags:['builtin','playable','reusable-world-content','rain','weather','reverse','suspend','控雨','凝雨','悬停','倒流','逆流','雨的逆序','技能'],
    source:{origin:'Craftmine approved rain demo 2026-09-13',author:'Craftmine World contributors',license:'MIT',licenseStatus:'verified'}}};
}
