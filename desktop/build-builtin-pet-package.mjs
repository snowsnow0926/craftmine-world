// A playable source component: one identity, behavior and two reviewed appearances.
// This builder never installs a world, changes an existing package or runs Godot.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {contentHash,validatePath} from '../plugins/craftmine-world/package-format.mjs';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {companionV3SourceProfiles} from './companion-v3-source-profiles.mjs';

export const PET_ASSET_ID='cw.module.pet-companion';
// v2 binds the managed sandbox adapter with ordinary weapon dispatch. v1 is
// immutable in released products; never rebuild those bytes with new hashes.
export const PET_VERSION=2;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
export const PET_SOURCE_REQUIREMENTS=[
  ['craftmine_shared/component_state.gd','desktop/godot/shared/component_state.gd'],
  ['craftmine_shared/base_adapter.gd','desktop/godot/shared/adapters/creation-sandbox.gd'],
  ['craftmine_shared/runtime_bridge.gd','desktop/godot/shared/runtime_bridge.gd'],
];
function read(root,name){
  validatePath(name);
  const file=path.resolve(root,name),relative=path.relative(fs.realpathSync(root),fs.realpathSync(file));
  check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&fs.lstatSync(file).isFile(),'PET_FILE_OUTSIDE_ROOT');
  return fs.readFileSync(file);
}

export function buildBuiltinPetPackage({repository,petRoot=path.join(repository,'desktop/godot/components/pet-companion'),visualRoot=path.join(repository,'desktop/godot/components/canine-visuals'),version=PET_VERSION}){
  check(version===2||version===3||version===4,'COMPONENT_VERSION_UNSUPPORTED');
  const visualManifest=JSON.parse(read(visualRoot,'manifest.json'));
  check(visualManifest.format==='craftmine.canine-visual-source/1'&&visualManifest.version===1&&visualManifest.license==='MIT','PET_VISUAL_MANIFEST_INVALID');
  const files={
    'scripts/pet_companion.gd':version>=3?Buffer.from(read(petRoot,`scripts/pet_companion-v${version}.gd`).toString('utf8').replace(/\r\n/g,'\n')):read(petRoot,'scripts/pet_companion.gd'),
    'scripts/pet_companion.gd.uid':read(petRoot,'scripts/pet_companion.gd.uid'),
    'LICENSE.txt':read(visualRoot,'LICENSE.txt'),
  };
  check(/^uid:\/\/[a-z0-9]+\s*$/.test(files['scripts/pet_companion.gd.uid'].toString()),'PET_SCRIPT_UID_INVALID');
  const appearances=[];
  for(const key of ['dog','pomeranian-white']){
    const item=visualManifest.items?.find(item=>item.appearanceKey===key);
    check(item?.file===key+'.glb'&&item.skeleton===false&&item.embeddedMaterials===true&&item.externalResources?.length===0,'PET_VISUAL_DECLARATION_INVALID');
    const bytes=read(visualRoot,item.file),sidecar=read(visualRoot,item.file+'.import');
    check(bytes.length===item.bytes&&sha(bytes)===item.sha256,'PET_VISUAL_HASH_MISMATCH');
    check(sidecar.toString().replace(/\r\n/g,'\n').trim()==='[remap]\nimporter="scene"\ntype="PackedScene"\n\n[params]\nmeshes/generate_lods=false','PET_VISUAL_IMPORT_UNSUPPORTED');
    files['visuals/'+item.file]=bytes;files['visuals/'+item.file+'.import']=sidecar;
    appearances.push({key,scene:'visuals/'+item.file,sha256:item.sha256,dimensionsMm:item.dimensionsMm,triangles:item.triangles,meshInstances:item.meshParts.length});
  }
  // Exact known resource bindings; there is no generic source-path rewriting.
  const prefix='res://addons/'+PET_ASSET_ID+'/';
  files['scenes/pet_companion.tscn']=Buffer.from(`[gd_scene load_steps=4 format=3]\n\n[ext_resource type="Script" path="${prefix}scripts/pet_companion.gd" id="1_behavior"]\n[ext_resource type="PackedScene" path="${prefix}visuals/dog.glb" id="2_dog"]\n[ext_resource type="PackedScene" path="${prefix}visuals/pomeranian-white.glb" id="3_pomeranian"]\n\n[node name="PetCompanion" type="CharacterBody3D"]\nscript = ExtResource("1_behavior")\nentity_id = "pet"\nappearance_key = "dog"\ndog_visual = ExtResource("2_dog")\npomeranian_visual = ExtResource("3_pomeranian")\n`);
  const sourceRequirements=PET_SOURCE_REQUIREMENTS.map(([projectPath,sourcePath])=>({path:projectPath,sha256:sha(read(repository,sourcePath))}));
  const content={assetId:PET_ASSET_ID,version,kind:'module',files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],
    entry:{entities:['pet'],sceneInstall:{mode:'instance',sceneFile:'scenes/pet_companion.tscn',identityField:'entity_id',identityType:'String'},sourceRequirements,
      label:'宠物伙伴：小狗与白色博美',description:'可跟随、近距离抚摸并保存进度的宠物。重复安装得到独立伙伴；修改同一根节点的 appearance_key 可在小狗与白色博美之间换外观，保留身份和进度。首版沿平地跟随，遇障碍停留，不提供寻路、驾驶或战斗。',
      placement:{anchor:'feet',dimensionsMm:[1500,770,1500]},appearances,
      editableSettings:{companion_name:'settings.name',appearance_key:'settings.appearanceKey',following:'settings.following'},
      playerBinding:{nodePath:'../Player',scope:'creation-sandbox'},interaction:{action:'interact',routing:'managed-base-component-ray',maximumDistanceMm:3000},
      animation:{mode:'rigid-part-node-keyframes',clips:['idle','walk'],skinning:false}},
    interfaces:{persistentComponent:{group:'craftmine_persistent_components',identityProperty:'entity_id',methods:['snapshot','validate_state','restore','validate_restored_state']},interaction:{method:'interact',actor:'Player'}},
    compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},
    state:{kind:'persistent-component',format:'craftmine.pet-companion-state/1',ledger:'/body/components',identity:'entityId',settings:['name','appearanceKey','following'],sourceSettings:['name','appearanceKey','following'],runtimeFields:['position','yaw','interactionCount'],removedIdentity:'retain-last-saved-state',sourceSettingsMigration:'changed-source-defaults-only'},
    licenses:{author:'Craftmine World contributors',license:'MIT',licenseFile:'LICENSE.txt',visualSource:'Original canine-visuals 1',visualManifestSha256:sha(read(visualRoot,'manifest.json'))}};
  if(version>=3){
    content.entry.description += " v3 的默认保存范围仍为各轴 ±80，仅供兼容。安装到城市或其他世界前，必须按该世界源码设置每个实例的 saved_position_min / saved_position_max；不会自动识别任意世界。";
    content.entry.sourceRequirements=sourceRequirements.slice(0,1);
    content.entry.sourceRequirementProfiles=companionV3SourceProfiles(repository);
    content.entry.positionValidation={mode:'explicit-receiving-world-bounds',sourceProperties:{minimum:'saved_position_min',maximum:'saved_position_max'},coordinateAnchor:'companion-feet',compatibilityDefaults:{minimum:[-80,-80,-80],maximum:[80,80,80]},requiresWorldConfiguration:true,finiteCoordinateLimit:100000,verticalContactToleranceMm:2,changesSavedPosition:false,note:'Legacy-sized defaults do not cover the full city. Read the receiving world source and explicitly configure both bounds before check/adoption; unknown worlds are not automatically adapted.'};
    content.entry.upgradeFrom={versions:[2],script:'scripts/pet_companion.gd',sha256:sha(read(petRoot,'scripts/pet_companion.gd')),mode:'same-script-path-preserve-entity-and-state'};
  }
  if(version===4){
    content.entry.description += ' v4 修复连续转向造成的缩放漂移，保持原有状态与范围配置契约；不增加寻路能力。';
    content.entry.upgradeFrom={versions:[3],script:'scripts/pet_companion.gd',sha256:sha(Buffer.from(read(petRoot,'scripts/pet_companion-v3.gd').toString('utf8').replace(/\r\n/g,'\n'))),mode:'same-script-path-preserve-entity-and-state'};
  }
  const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
  const bytes=packStaticPackage({root:{id:PET_ASSET_ID,version},resources:[{manifest,files}]});
  const archive=unpackStaticPackage(bytes);
  check(archive.resources.length===1&&archive.resources[0].contentHash===manifest.contentHash,'PET_PACKAGE_ROUNDTRIP_FAILED');
  const file=PET_ASSET_ID+(version===2?'':'.v'+version)+'.zip';
  return {file,bytes,entry:{assetId:PET_ASSET_ID,version,kind:'module',file,bytes:bytes.length,sha256:sha(bytes),rootContentHash:manifest.contentHash,label:content.entry.label,
    tags:[...(version>=3?['reusable-world-content','world-bounded-state']:[]),'builtin','prefab','playable','宠物','小狗','博美','跟随','抚摸'],source:{origin:'Craftmine World pet-companion '+version+'.0.0',author:'Craftmine World contributors',license:'MIT',licenseStatus:'verified'}}};
}
