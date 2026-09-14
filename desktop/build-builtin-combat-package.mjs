// 可复用战斗预制包构建器。只读取已审查源码并产生确定性静态包，不安装或修改玩家世界。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
export const COMBAT_ASSET_ID='cw.module.sandbox-combat';
export const COMBAT_VERSION=2;
const sha=b=>createHash('sha256').update(b).digest('hex');
export function buildBuiltinCombatPackage({repository=process.cwd(),version=COMBAT_VERSION}={}){
 if(![1,2].includes(version))throw Error('COMBAT_VERSION_UNSUPPORTED');
 const root=path.resolve(repository), files={};
 for(const [name,source] of [
  ['scripts/combat_vitals.gd','desktop/godot/components/combat-vitals/scripts/combat_vitals.gd'],
  ['scripts/sandbox_weapon.gd','desktop/godot/components/sandbox-weapon/scripts/sandbox_weapon.gd'],
  ['scripts/sandbox_monster.gd','desktop/godot/components/sandbox-monster/scripts/sandbox_monster.gd'],
  ['README.md','desktop/godot/components/sandbox-weapon/README.md'],
 ]) files[name]=fs.readFileSync(path.join(root,source));
 if(version===2)for(const name of Object.keys(files).filter(name=>name.endsWith('.gd'))){
  files[name+'.uid']=Buffer.from('uid://'+sha(Buffer.from(COMBAT_ASSET_ID+'/v2/'+name)).slice(0,12)+'\n');
 }
 const content={assetId:COMBAT_ASSET_ID,version,kind:'module',files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([name,b])=>({path:name,bytes:b.length,sha256:sha(b)})),dependencies:[],entry:{entities:['player-vitals','player-weapon','monster-one'],sceneInstall:{mode:'script-node',script:'scripts/sandbox_monster.gd',nodeType:'CharacterBody3D',identityField:'entity_id',identityType:'String'},label:'造物战斗：武器、怪物与生命',description:'同一造物世界中的生命、射线武器、追击怪物和一次性掉落组件。需按声明分别挂载玩家生命、武器及怪物节点。',editableSettings:{maximum_health:'settings.maximumHealth',damage:'settings.damage',range_meters:'settings.range',cooldown_seconds:'settings.cooldown',max_ammo:'settings.maxAmmo',attack_damage:'settings.attackDamage',attack_cooldown:'settings.attackCooldown',move_speed:'settings.moveSpeed',reward_id:'settings.rewardId',reward_count:'settings.rewardCount'}},interfaces:{persistentComponent:{group:'craftmine_persistent_components',methods:['snapshot','validate_state','restore','validate_restored_state']},weapon:{group:'craftmine_player_weapons',method:'attack(player)'},target:{group:'craftmine_damageable_targets',method:'apply_damage(amount,player)'}},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{kind:'persistent-component',ledger:'/body/components',formats:['craftmine.combat-vitals-state/1','craftmine.sandbox-weapon-state/1','craftmine.sandbox-monster-state/1'],inventory:'/body/inventory',oldWorld:'component-absent-world-unchanged'},licenses:{author:'Craftmine World contributors',license:'MIT'}};
 if(version===2){
  content.entry.entities=['monster-one'];
  content.entry.label='造物战斗：怪物实例与生命/武器源码';
  content.entry.description='自动加入一只怪物。追击与伤害需要另外挂载唯一玩家生命节点；包内提供生命和武器源码，不自动发放武器，也未实现剑/AK切换或重生。';
  content.entry.installationGuide={automaticNodes:[{entity:'monster-one',script:'scripts/sandbox_monster.gd',nodeType:'CharacterBody3D'}],
   requiredManualNodes:[{role:'player-vitals',script:'scripts/combat_vitals.gd',nodeType:'Node3D',parent:'.',identityField:'entity_id',playerPath:'../Player',group:'craftmine_player_vitals',countPerPlayer:1,neededFor:['monster-pursuit','monster-player-damage','weapon-fire']}],
   optionalManualNodes:[{role:'player-weapon',script:'scripts/sandbox_weapon.gd',nodeType:'Node3D',parent:'.',identityField:'entity_id',playerPath:'../Player',group:'craftmine_player_weapons',countPerPlayer:1,condition:'Only when requested by the player; this is a basic ray weapon, not sword/AK switching.'}],
   afterInstall:{tools:['godot_project_index','godot_file_read','godot_project_patch','godot_build_start','godot_build_read'],instructions:'Use returned install paths and the actual source index to read all three installed scripts. Mount required vitals with a fresh entity_id and the actual player_path through ordinary source CAS, then check/adopt. A monster without unique player vitals deliberately does not pursue or attack. Repeated installs add monsters, not another vitals or weapon.'},
   notIncluded:['melee-sword','AK47','weapon-switching','reload','automatic-respawn']};
 }
 const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)}, bytes=packStaticPackage({root:{id:COMBAT_ASSET_ID,version},resources:[{manifest,files}]});
 const archive=unpackStaticPackage(bytes); if(archive.resources[0].contentHash!==manifest.contentHash) throw Error('COMBAT_PACKAGE_ROUNDTRIP_FAILED');
 const file=COMBAT_ASSET_ID+(version===1?'':'-v'+version)+'.zip';
 return {file,bytes,entry:{assetId:COMBAT_ASSET_ID,version,kind:'module',file,bytes:bytes.length,sha256:sha(bytes),rootContentHash:manifest.contentHash,label:content.entry.label,tags:['builtin','prefab','playable','战斗','武器','怪物'],source:{origin:'Craftmine World sandbox combat '+version+'.0.0',author:'Craftmine World contributors',license:'MIT',licenseStatus:'verified'}}};
}
