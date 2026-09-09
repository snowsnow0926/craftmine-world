// Shared, deterministic gameplay contracts and state. No DOM, network or eval.
export const SYSTEMS = {
  health: { name: '生命值', dependencies: ['player@1'], fields: { maxHealth:[1,10000], fallDamage:[0,100], regenPerSecond:[0,100] } },
  ranged: { name: '射击', dependencies: ['raycast@1','damageable@1'], fields: { damage:[1,1000], range:[1,80], cooldown:[0.1,10], magazine:[1,100], reloadSeconds:[0.2,10] } },
  melee: { name: '近战', dependencies: ['raycast@1','damageable@1'], fields: { damage:[1,1000], range:[0.5,4], cooldown:[0.15,10] } },
  // 通用资源：不写死血量以外的名字，蓝条/体力/饥饿/护甲都用它，最多同时启用多个。
  resource: { name: '自定义资源', dependencies: ['player@1'], fields: { max:[1,10000], regenPerSecond:[0,100], start:[0,10000] } },
};
export const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function exactKeys(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('模块字段不符合格式：需要一个 JSON 对象');
  const missing = fields.filter(k => !Object.hasOwn(value, k)), extra = Object.keys(value).filter(k => !fields.includes(k));
  if (missing.length || extra.length) throw Error(`模块字段不符合格式：${missing.length ? '缺少 ' + missing.join('、') : ''}${missing.length && extra.length ? '；' : ''}${extra.length ? '多出 ' + extra.join('、') : ''}。允许的字段只有：${fields.join('、')}`);
}
export function bounded(value,min,max) { if (!Number.isFinite(value)||value<min||value>max) throw Error(`数值需要在 ${min} 到 ${max} 之间`); }
export function validateSource(source) {
  if(source===null)return;
  exactKeys(source,['id','version']);
  if(!identifier(source.id)||!Number.isInteger(source.version)||source.version<1||source.version>100000)throw Error('模块来源版本无效');
}
export function validateSystem(system) {
  exactKeys(system,['id','name','type','config','source']);
  if(!identifier(system.id)||typeof system.name!=='string'||!system.name.trim()||system.name.length>60||!Object.hasOwn(SYSTEMS,system.type))throw Error('不支持的玩法模块');
  validateSource(system.source);
  const fields=SYSTEMS[system.type].fields;exactKeys(system.config,Object.keys(fields));
  for(const [key,[min,max]]of Object.entries(fields))bounded(system.config[key],min,max);
  if(system.type==='ranged'&&!Number.isInteger(system.config.magazine))throw Error('弹匣容量必须是整数');
}
export function validateSystems(systems) {
  if(!Array.isArray(systems)||systems.length>6)throw Error('最多启用六类基础玩法系统');
  const types=new Set(),ids=new Set();
  // 自定义资源可以有多个实例，其他系统类型仍然只能有一个。
  for(const s of systems){validateSystem(s);const key=s.type==='resource'?'resource:'+s.id:s.type;if(types.has(key)||ids.has(s.id))throw Error('同类玩法系统或 ID 重复');types.add(key);ids.add(s.id);}
}
export function validateGameplayState(state) {
  exactKeys(state,['systems','targets','equipped',...(Object.hasOwn(state,'archivedTargets')?['archivedTargets']:[]),...(Object.hasOwn(state,'cooldown')?['cooldown']:[])]);
  if(Object.hasOwn(state,'cooldown'))bounded(state.cooldown,0,10);
  if(![null,'ranged','melee'].includes(state.equipped))throw Error('装备状态无效');
  for(const [name,limit]of [['systems',6],['targets',128],...(Object.hasOwn(state,'archivedTargets')?[['archivedTargets',128]]:[])]) {
    const table=state[name];if(!table||typeof table!=='object'||Array.isArray(table)||Object.keys(table).length>limit)throw Error('玩法存档大小无效');
    for(const [id,value]of Object.entries(table)) {
      if(!identifier(id))throw Error('玩法存档 ID 无效');
      if(name==='targets'||name==='archivedTargets'){exactKeys(value,['health','maxHealth']);bounded(value.maxHealth,1,10000);bounded(value.health,0,value.maxHealth);}
      else if(value?.type==='health'){exactKeys(value,['type','health','maxHealth']);bounded(value.maxHealth,1,10000);bounded(value.health,0,value.maxHealth);}
      else if(value?.type==='ranged'){exactKeys(value,['type','ammo','reloadRemaining']);bounded(value.ammo,0,100);if(!Number.isInteger(value.ammo))throw Error('弹药数无效');bounded(value.reloadRemaining,0,10);}
      else if(value?.type==='resource'){exactKeys(value,['type','value','max']);bounded(value.max,1,10000);bounded(value.value,0,value.max);}
      else if(value?.type==='melee')exactKeys(value,['type']);
      else throw Error('玩法存档类型无效');
    }
  }
  return structuredClone(state);
}

export class GameplaySession {
  constructor(systems=[],objects=[],saved=null) {
    validateSystems(systems);if(saved)validateGameplayState(saved);
    this.definitions=systems;this.objects=objects;this.cooldown=saved?.cooldown||0;
    this.state={systems:{},targets:{},equipped:null,archivedTargets:structuredClone(saved?.archivedTargets||{})};
    for(const [id,value]of Object.entries(saved?.targets||{}))if(!objects.some(o=>o.id===id&&o.components?.health>0))this.state.archivedTargets[id]=structuredClone(value);
    for(const s of systems) {
      const old=saved?.systems[s.id];
      this.state.systems[s.id]=s.type==='health'?{type:s.type,health:old?.type===s.type?Math.min(old.health,s.config.maxHealth):s.config.maxHealth,maxHealth:s.config.maxHealth}:
        s.type==='resource'?{type:s.type,value:old?.type===s.type?Math.min(old.value,s.config.max):Math.min(s.config.start,s.config.max),max:s.config.max}:
        s.type==='ranged'?{type:s.type,ammo:old?.type===s.type?Math.min(old.ammo,s.config.magazine):s.config.magazine,reloadRemaining:old?.type===s.type?Math.min(old.reloadRemaining,s.config.reloadSeconds):0}:{type:s.type};
    }
    for(const o of objects)if(o.components?.health>0){const old=saved?.targets[o.id]||this.state.archivedTargets[o.id];this.state.targets[o.id]={health:old?Math.min(old.health,o.components.health):o.components.health,maxHealth:o.components.health};delete this.state.archivedTargets[o.id];}
    const weapons=systems.filter(s=>!['health','resource'].includes(s.type)).map(s=>s.type);
    this.state.equipped=weapons.includes(saved?.equipped)?saved.equipped:weapons[0]||null;
    validateGameplayState(this.state);
  }
  get(type){return this.definitions.find(s=>s.type===type);}
  get player(){const s=this.get('health');return s?this.state.systems[s.id]:null;}
  get dead(){return this.player?.health===0;}
  alive(id){return this.state.targets[id]?.health!==0;}
  equip(type){if(['ranged','melee'].includes(type)&&this.get(type)){this.state.equipped=type;return true;}return false;}
  tick(dt){
    bounded(dt,0,60);
    this.cooldown=Math.max(0,this.cooldown-dt);
    const ranged=this.get('ranged');if(ranged){const state=this.state.systems[ranged.id];if(state.reloadRemaining>0){state.reloadRemaining=Math.max(0,state.reloadRemaining-dt);if(state.reloadRemaining===0)state.ammo=ranged.config.magazine;}}
    const health=this.get('health');if(health&&!this.dead)this.player.health=Math.min(this.player.maxHealth,this.player.health+health.config.regenPerSecond*dt);
    for(const definition of this.definitions)if(definition.type==='resource'){const state=this.state.systems[definition.id];state.value=Math.min(state.max,state.value+definition.config.regenPerSecond*dt);}
  }
  resource(id){const definition=this.definitions.find(s=>s.type==='resource'&&s.id===id);return definition?this.state.systems[definition.id]:null;}
  resources(){return this.definitions.filter(s=>s.type==='resource').map(s=>({id:s.id,name:s.name,...this.state.systems[s.id]}));}
  addResource(id,amount){const state=this.resource(id);if(!state)return null;state.value=Math.min(state.max,Math.max(0,state.value+amount));return state.value;}
  setResource(id,value){const state=this.resource(id);if(!state)return null;state.value=Math.min(state.max,Math.max(0,value));return state.value;}
  hurt(amount){if(!this.player||this.dead)return 0;const before=this.player.health;this.player.health=Math.max(0,before-Math.max(0,amount));return before-this.player.health;}
  fall(distance){const s=this.get('health');return s?this.hurt(Math.max(0,distance-3)*s.config.fallDamage):0;}
  revive(){if(this.player)this.player.health=this.player.maxHealth;}
  reload(){const s=this.get('ranged');if(!s||this.dead)return false;const state=this.state.systems[s.id];if(state.reloadRemaining||state.ammo===s.config.magazine)return false;state.reloadRemaining=s.config.reloadSeconds;return true;}
  attack(hit){
    if(hit&&((hit.id!=null&&!identifier(hit.id))||!Number.isFinite(hit.distance)||hit.distance<0))throw Error('攻击命中信息无效');
    const s=this.get(this.state.equipped);if(!s||this.dead||this.cooldown>0)return {fired:false};
    if(s.type==='ranged'){const state=this.state.systems[s.id];if(state.reloadRemaining)return {fired:false,reason:'正在换弹'};if(!state.ammo)return {fired:false,reason:'弹匣已空，按 R 换弹'};state.ammo--;}
    this.cooldown=s.config.cooldown;
    const target=hit&&hit.distance<=s.config.range?this.state.targets[hit.id]:null;
    let damage=0;if(target&&target.health>0){damage=Math.min(target.health,s.config.damage);target.health-=damage;}
    return {fired:true,type:s.type,damage,id:damage?hit.id:null,destroyed:!!damage&&target.health===0};
  }
  snapshot(){return {...structuredClone(this.state),cooldown:this.cooldown};}
}
