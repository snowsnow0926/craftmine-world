// 可复用战斗预制包构建器。只读取已审查源码并产生确定性静态包，不安装或修改玩家世界。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
export const COMBAT_ASSET_ID='cw.module.sandbox-combat';
export const COMBAT_VERSION=1;
const sha=b=>createHash('sha256').update(b).digest('hex');
export function buildBuiltinCombatPackage({repository=process.cwd()}={}){
 const root=path.resolve(repository), files={};
 for(const [name,source] of [
  ['scripts/combat_vitals.gd','desktop/godot/components/combat-vitals/scripts/combat_vitals.gd'],
  ['scripts/sandbox_weapon.gd','desktop/godot/components/sandbox-weapon/scripts/sandbox_weapon.gd'],
  ['scripts/sandbox_monster.gd','desktop/godot/components/sandbox-monster/scripts/sandbox_monster.gd'],
  ['README.md','desktop/godot/components/sandbox-weapon/README.md'],
 ]) files[name]=fs.readFileSync(path.join(root,source));
 const content={assetId:COMBAT_ASSET_ID,version:COMBAT_VERSION,kind:'module',files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([name,b])=>({path:name,bytes:b.length,sha256:sha(b)})),dependencies:[],entry:{entities:['player-vitals','player-weapon','monster-one'],sceneInstall:{mode:'script-node',script:'scripts/sandbox_monster.gd',nodeType:'CharacterBody3D',identityField:'entity_id',identityType:'String'},label:'造物战斗：武器、怪物与生命',description:'同一造物世界中的生命、射线武器、追击怪物和一次性掉落组件。需按声明分别挂载玩家生命、武器及怪物节点。',editableSettings:{maximum_health:'settings.maximumHealth',damage:'settings.damage',range_meters:'settings.range',cooldown_seconds:'settings.cooldown',max_ammo:'settings.maxAmmo',attack_damage:'settings.attackDamage',attack_cooldown:'settings.attackCooldown',move_speed:'settings.moveSpeed',reward_id:'settings.rewardId',reward_count:'settings.rewardCount'}},interfaces:{persistentComponent:{group:'craftmine_persistent_components',methods:['snapshot','validate_state','restore','validate_restored_state']},weapon:{group:'craftmine_player_weapons',method:'attack(player)'},target:{group:'craftmine_damageable_targets',method:'apply_damage(amount,player)'}},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},state:{kind:'persistent-component',ledger:'/body/components',formats:['craftmine.combat-vitals-state/1','craftmine.sandbox-weapon-state/1','craftmine.sandbox-monster-state/1'],inventory:'/body/inventory',oldWorld:'component-absent-world-unchanged'},licenses:{author:'Craftmine World contributors',license:'MIT'}};
 const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)}, bytes=packStaticPackage({root:{id:COMBAT_ASSET_ID,version:COMBAT_VERSION},resources:[{manifest,files}]});
 const archive=unpackStaticPackage(bytes); if(archive.resources[0].contentHash!==manifest.contentHash) throw Error('COMBAT_PACKAGE_ROUNDTRIP_FAILED');
 return {file:COMBAT_ASSET_ID+'.zip',bytes,entry:{assetId:COMBAT_ASSET_ID,version:COMBAT_VERSION,kind:'module',file:COMBAT_ASSET_ID+'.zip',bytes:bytes.length,sha256:sha(bytes),rootContentHash:manifest.contentHash,label:content.entry.label,tags:['builtin','prefab','playable','战斗','武器','怪物'],source:{origin:'Craftmine World sandbox combat 1.0.0',author:'Craftmine World contributors',license:'MIT',licenseStatus:'verified'}}};
}

