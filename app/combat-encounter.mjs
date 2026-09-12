// Deterministic reusable encounter component. It drives the existing
// GameplaySession target/equipment path and only owns encounter-specific state.
import { identifier, bounded } from './gameplay.mjs';

const keys=(v,want)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('遭遇战存档格式无效');const extra=Object.keys(v).filter(k=>!want.includes(k));const miss=want.filter(k=>!Object.hasOwn(v,k));if(extra.length||miss.length)throw Error('遭遇战字段无效');};
const id=v=>{if(!identifier(v))throw Error('遭遇战实体 ID 无效');return v;};
export function validateEncounterState(value){
  keys(value,['monster','loot','collected']); keys(value.monster,['id','health','maxHealth','defeated','respawns']);
  id(value.monster.id); for(const n of ['health','maxHealth'])bounded(value.monster[n],0,10000); if(value.monster.maxHealth<1||value.monster.health>value.monster.maxHealth)throw Error('怪物生命值无效');
  if(typeof value.monster.defeated!=='boolean'||value.monster.defeated!==(value.monster.health===0)||!Number.isInteger(value.monster.respawns)||value.monster.respawns<0)throw Error('怪物状态无效');
  if(!Array.isArray(value.loot)||value.loot.length>32||value.loot.some(x=>!identifier(x)))throw Error('掉落物无效');
  if(!Array.isArray(value.collected)||value.collected.length>32||new Set(value.collected).size!==value.collected.length||value.collected.some(x=>!identifier(x)||!value.loot.includes(x)))throw Error('拾取状态无效');
  return structuredClone(value);
}

export class CombatEncounter {
  constructor(gameplay,{id:monsterId='monster-one',maxHealth=100,attackDamage=8,attackCooldown=.8,loot=['coin']}={},saved=null){
    if(!gameplay||typeof gameplay.attack!=='function'||typeof gameplay.hurt!=='function')throw Error('需要现有 GameplaySession');
    id(monsterId); bounded(maxHealth,1,10000); bounded(attackDamage,0,1000); bounded(attackCooldown,.1,10);
    this.gameplay=gameplay; this.config={id:monsterId,maxHealth,attackDamage,attackCooldown}; this.cooldown=0;
    const old=saved?validateEncounterState(saved):null; if(old&&old.monster.id!==monsterId)throw Error('怪物身份不匹配');
    this.state=old?old:{monster:{id:monsterId,health:maxHealth,maxHealth,defeated:false,respawns:0},loot:[...new Set(loot)],collected:[]};
    if(!this.state.loot.length)throw Error('遭遇战必须有掉落物');
  }
  tick(dt){bounded(dt,0,60);this.cooldown=Math.max(0,this.cooldown-dt);this.gameplay.tick(dt);}
  attack(distance=3){
    if(this.state.monster.defeated)return {fired:false,reason:'怪物已被击败'};
    const result=this.gameplay.attack({id:this.state.monster.id,distance});
    if(result.damage){this.state.monster.health=Math.max(0,this.state.monster.health-result.damage);if(this.state.monster.health===0)this.state.monster.defeated=true;}
    return {...result,remaining:this.state.monster.health,defeated:this.state.monster.defeated};
  }
  monsterAttack(){
    if(this.state.monster.defeated||this.cooldown>0)return {hit:false,reason:this.state.monster.defeated?'怪物已被击败':'攻击冷却中'};
    this.cooldown=this.config.attackCooldown;const damage=this.gameplay.hurt(this.config.attackDamage);return {hit:damage>0,damage};
  }
  collectLoot(){if(!this.state.monster.defeated)return [];const fresh=this.state.loot.filter(x=>!this.state.collected.includes(x));this.state.collected.push(...fresh);return [...fresh];}
  respawn(){if(!this.state.monster.defeated)return false;this.state.monster.health=this.state.monster.maxHealth;this.state.monster.defeated=false;this.state.monster.respawns++;this.state.collected=[];return true;}
  snapshot(){return validateEncounterState(this.state);}
}
