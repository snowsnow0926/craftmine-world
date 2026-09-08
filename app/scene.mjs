import { sceneDiff,upgradeScene } from './scene-diff.mjs';
export { sceneDiff,upgradeScene,withAppearanceFormat } from './scene-diff.mjs';
import { createHash } from 'node:crypto';
import { SYSTEMS, identifier, exactKeys, bounded, validateSource, validateSystems, validateGameplayState } from './gameplay.mjs';
import { canonicalJSON } from './canonical.mjs';
import { validateAppearance,checkAppearanceBounds,sceneAssetReferences } from './asset-binding.mjs';
import { compileBehavior } from './behavior-build.mjs';
import { validateBehaviorState } from './behavior-state.mjs';
export { canonicalJSON } from './canonical.mjs';

export const MATERIALS = { grass: 1, dirt: 2, stone: 3, wood: 4, leaves: 5, planks: 6, sand: 7, brick: 8, light: 9, glass: 12 };
export const EMPTY_SCENE = { format: 'craftmine.scene/1', title: '最初的世界', night: false, objects: [] };
export const INITIAL_SNAPSHOT = { format: 'craftmine.progress/1', player: { x: 0.5, y: 6, z: 12.5, yaw: 0, pitch: 0 } };
export const clone = value => structuredClone(value);
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('需要 JSON 对象');
  if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(value, key))) throw Error('对象字段不符合格式');
}
function string(value, max) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('文字字段无效'); }
function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw Error(`整数需要在 ${min} 到 ${max} 之间`); }
function vector(value, min, max) { keys(value, ['x', 'y', 'z']); for (const n of Object.values(value)) integer(n, min, max); }
export function validateSnapshot(input) {
  if(!['craftmine.progress/1','craftmine.progress/2','craftmine.progress/3'].includes(input?.format))throw Error('进度格式不兼容，已保留原存档');
  keys(input, input.format==='craftmine.progress/3'?['format','player','gameplay','behaviors']:input.format==='craftmine.progress/2'?['format','player','gameplay']:['format', 'player']);
  if(input.format!=='craftmine.progress/1')validateGameplayState(input.gameplay);
  if(input.format==='craftmine.progress/3')validateBehaviorState(input.behaviors);
  keys(input.player, ['x', 'y', 'z', 'yaw', 'pitch']);
  const p = input.player;
  if (Object.values(p).some(n => !Number.isFinite(n)) || Math.abs(p.x) > 47.4 || Math.abs(p.z) > 47.4 || p.y < 6 || p.y > 38 || Math.abs(p.yaw) > 1e6 || Math.abs(p.pitch) > 1.52) throw Error('玩家位置或视角无效');
  return clone(input);
}
function compileLegacy(input) {
  keys(input, ['format', 'title', 'night', 'objects']);
  if (input.format !== EMPTY_SCENE.format) throw Error('场景格式不兼容');
  string(input.title, 80);
  if (typeof input.night !== 'boolean' || !Array.isArray(input.objects) || input.objects.length > 64) throw Error('场景最多包含 64 个对象');
  const ids = new Set(), cells = new Map(); let volume = 0;
  for (const object of input.objects) {
    keys(object, ['id', 'name', 'position', 'parts']); string(object.name, 60);
    if (typeof object.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(object.id) || ids.has(object.id)) throw Error('对象 ID 无效或重复');
    ids.add(object.id); vector(object.position, -40, 40);
    if (!Array.isArray(object.parts) || !object.parts.length || object.parts.length > 128) throw Error('每个对象需要 1–128 个几何部分');
    for (const part of object.parts) {
      keys(part, ['offset', 'size', 'material']); vector(part.offset, -24, 24); vector(part.size, 1, 24);
      if (!Object.hasOwn(MATERIALS, part.material)) throw Error('未知材质');
      volume += part.size.x * part.size.y * part.size.z;
      if (volume > 24000) throw Error('场景超出 24,000 格构造预算，请缩小规模');
      const min = Object.fromEntries(['x','y','z'].map(k => [k, object.position[k] + part.offset[k]]));
      if (min.x < -46 || min.z < -46 || min.y < 6 || min.x + part.size.x > 46 || min.z + part.size.z > 46 || min.y + part.size.y > 38) throw Error('对象超出场地：地面 y=6，水平边界 ±46，高度小于 38');
      for (let x = min.x; x < min.x + part.size.x; x++) for (let y = min.y; y < min.y + part.size.y; y++) for (let z = min.z; z < min.z + part.size.z; z++) {
        const key = `${x},${y},${z}`, old = cells.get(key);
        if (old && old[4] !== object.id) throw Error('不同对象发生重叠，请调整位置');
        cells.set(key, [x, y, z, MATERIALS[part.material], object.id]);
      }
    }
  }
  const scene = clone(input), hash = createHash('sha256').update(JSON.stringify(scene)).digest('hex');
  return { format: 'craftmine.build/1', hash, scene, voxels: [...cells.values()] };
}
export function validateObjectScope(before, after, selected) {
  if (!selected) return;
  before=upgradeScene(before);after=upgradeScene(after);
  for(const scene of [before,after])scene.objects=scene.objects.map(o=>({...o,appearance:o.appearance||null}));
  const beforeRest = before.objects.filter(o => o.id !== selected);
  const afterRest = after.objects.filter(o => o.id !== selected);
  if (canonicalJSON(beforeRest) !== canonicalJSON(afterRest) || before.night !== after.night || before.title !== after.title || canonicalJSON(before.systems)!==canonicalJSON(after.systems)) throw Error('模型修改超出了选中对象的范围，候选未采纳。若要修改整个世界，请先清除对象选择。');
  const behaviorIds=new Set([...(before.behaviors||[]),...(after.behaviors||[])].map(b=>b.id));
  for(const id of behaviorIds){const a=before.behaviors?.find(b=>b.id===id),b=after.behaviors?.find(b=>b.id===id);if(canonicalJSON(a)===canonicalJSON(b))continue;for(const d of [a,b].filter(Boolean))if(d.targets.length!==1||d.targets[0]!==selected||d.permissions.some(p=>!['objects.write','hud.message'].includes(p)))throw Error('玩法修改超出了选中对象的范围');}
}

export const overlaps=(a,b)=>['x','y','z'].every(k=>a.min[k]<b.max[k]-0.00001&&a.max[k]>b.min[k]+0.00001);
export function objectBounds(object) {
  return {min:Object.fromEntries(['x','y','z'].map(k=>[k,Math.min(...object.parts.map(p=>object.position[k]+p.offset[k]))])),max:Object.fromEntries(['x','y','z'].map(k=>[k,Math.max(...object.parts.map(p=>object.position[k]+p.offset[k]+p.size[k]))]))};
}
export function compileScene(input) {
  if(input?.format==='craftmine.scene/1')return compileLegacy(input);
  const assets=input?.format==='craftmine.scene/4',scripted=assets||input?.format==='craftmine.scene/3';
  exactKeys(input,scripted?['format','title','night','objects','systems','behaviors']:['format','title','night','objects','systems']);
  if(!scripted&&input.format!=='craftmine.scene/2')throw Error('场景格式不兼容');
  string(input.title,80);if(typeof input.night!=='boolean'||!Array.isArray(input.objects)||input.objects.length>128)throw Error('场景最多包含 128 个对象');
  validateSystems(input.systems);
  const ids=new Set(),primitives=[],bins=new Map();let volume=0,faces=0;
  const vec=(v,min,max)=>{exactKeys(v,['x','y','z']);for(const n of Object.values(v))bounded(n,min,max);};
  for(const o of input.objects){
    exactKeys(o,['id','name','position','parts','components','source',...(assets?['appearance']:[])]);string(o.name,60);
    if(assets){validateAppearance(o.appearance);checkAppearanceBounds(o);}
    if(!identifier(o.id)||ids.has(o.id))throw Error('对象 ID 无效或重复');ids.add(o.id);
    vec(o.position,-40,40);validateSource(o.source);exactKeys(o.components,['health','contactDamage']);bounded(o.components.health,0,10000);bounded(o.components.contactDamage,0,100);
    if(o.components.contactDamage>0&&!input.systems.some(s=>s.type==='health'))throw Error('接触伤害需要启用生命值模块');
    if(!Array.isArray(o.parts)||!o.parts.length||o.parts.length>128)throw Error('每个对象需要 1–128 个几何部分');
    for(const p of o.parts){
      exactKeys(p,['shape','offset','size','material','color','solid']);vec(p.offset,-24,24);vec(p.size,0.02,24);
      if(!['box','blade'].includes(p.shape)||!Object.hasOwn({...MATERIALS,solid:0},p.material)||!/^#[0-9a-fA-F]{6}$/.test(p.color)||typeof p.solid!=='boolean')throw Error('几何、材质、颜色或碰撞无效');
      if(p.shape==='blade'&&p.solid)throw Error('薄叶片不能作为实心碰撞体');
      volume+=p.size.x*p.size.y*p.size.z;if(volume>24000||primitives.length>=4096)throw Error('场景超出构造预算（24,000 体积 / 4,096 部件）');
      const [x,y,z]=Object.values(p.size).map(Math.ceil);faces+=p.shape==='blade'?4:p.material==='solid'?6:2*(x*y+x*z+y*z);if(faces>100000)throw Error('场景超过 100,000 面的绘制预算');
      const min=Object.fromEntries(['x','y','z'].map(k=>[k,o.position[k]+p.offset[k]])),max=Object.fromEntries(['x','y','z'].map(k=>[k,min[k]+p.size[k]]));
      if(min.x< -46||min.z< -46||min.y<5.99999||max.x>46||max.z>46||max.y>38)throw Error('对象超出场地：地面 y=6，水平边界 ±46，高度小于 38');
      const primitive={...clone(p),id:o.id,min,max};
      // Decorations may overlap naturally. Solid parts from different objects must not intersect.
      if(p.solid){const seen=new Set();for(let x=Math.floor(min.x/4);x<=Math.floor(max.x/4);x++)for(let y=Math.floor(min.y/4);y<=Math.floor(max.y/4);y++)for(let z=Math.floor(min.z/4);z<=Math.floor(max.z/4);z++){
        const key=`${x},${y},${z}`,near=bins.get(key)||[];
        for(const other of near)if(!seen.has(other)){seen.add(other);if(other.id!==o.id&&overlaps(primitive,other))throw Error('不同实心对象发生重叠，请调整位置');}
        near.push(primitive);bins.set(key,near);
      }}
      primitives.push(primitive);
    }
  }
  if(assets)sceneAssetReferences(input);
  let behaviors;
  if(scripted){
    if(!Array.isArray(input.behaviors)||input.behaviors.length>8)throw Error('一个世界最多启用 8 个代码模块');
    const modules=new Set(),writers=new Set();behaviors=input.behaviors.map(d=>{
      const artifact=compileBehavior(d);if(modules.has(d.id))throw Error('代码模块 ID 重复');modules.add(d.id);
      for(const requirement of d.requires||[])if(!input.systems.some(s=>s.type===requirement.split('@')[0]))throw Error('代码玩法缺少依赖：'+requirement);
      for(const id of d.targets){if(!ids.has(id))throw Error('代码模块引用了不存在的对象');if(d.permissions.includes('objects.write')){if(writers.has(id))throw Error('同一对象只能由一个代码模块修改');writers.add(id);}}
      return artifact;
    });
    const instances=new Map();
    for(const {definition:d}of behaviors)if(d.binding){
      const b=d.binding,known=instances.get(b.instanceId),serialized=canonicalJSON({source:b.source,origin:b.origin,behaviors:b.behaviors,objects:b.objects.map(({key,world})=>({key,world})).sort((a,b)=>a.key.localeCompare(b.key))});
      if(known&&known!==serialized)throw Error('同一创作实例的绑定不一致');instances.set(b.instanceId,serialized);
      if(b.objects.some(p=>!ids.has(p.world))||b.behaviors.some(p=>!input.behaviors.some(other=>other.id===p.world&&other.binding?.instanceId===b.instanceId)))throw Error('创作实例缺少绑定的对象或玩法');
    }
  }
  const scene=clone(input),hash=createHash('sha256').update(canonicalJSON(scene)).digest('hex');
  return {format:assets?'craftmine.build/4':scripted?'craftmine.build/3':'craftmine.build/2',hash,scene,voxels:[],primitives,...(scripted?{behaviors}:{})};
}
const vecSchema = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x','y','z'], additionalProperties: false };
const objSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const sourceSchema={anyOf:[{type:'null'},objSchema({id:{type:'string'},version:{type:'integer'}})]};
const bindingSchema={anyOf:[{type:'null'},objSchema({instanceId:{type:'string'},source:objSchema({id:{type:'string'},version:{type:'integer'}}),origin:vecSchema,translation:vecSchema,objects:{type:'array',items:objSchema({key:{type:'string'},local:{type:'string'},world:{type:'string'}})},behaviors:{type:'array',items:objSchema({local:{type:'string'},world:{type:'string'}})}})]};
const behaviorFields={id:{type:'string'},name:{type:'string'},description:{type:'string'},code:{type:'string'},stateVersion:{type:'integer'},initialStateJSON:{type:'string'},paramsJSON:{type:'string'},targets:{type:'array',items:{type:'string'}},permissions:{type:'array',items:{type:'string',enum:['objects.write','player.motion','hud.message','inventory.write']}}};
export const OUTPUT_SCHEMA = objSchema({
  summary: { type: 'string' },
  notes: { type: 'array', items: { type: 'string' } },
  reuseCreations:{type:'array',items:objSchema({id:{type:'string'},version:{type:'integer'},position:{anyOf:[{type:'null'},vecSchema]}})},
  scene: { anyOf: [ { type: 'null' }, objSchema({
    format: { type: 'string', enum: ['craftmine.scene/3'] }, title: { type: 'string' }, night: { type: 'boolean' },
    objects: { type: 'array', items: objSchema({
      id: { type: 'string' }, name: { type: 'string' }, position: vecSchema,source:sourceSchema,
      components:objSchema({health:{type:'number'},contactDamage:{type:'number'}}),
      parts: { type: 'array', items: objSchema({ shape:{type:'string',enum:['box','blade']},offset: vecSchema, size: vecSchema, material: { type: 'string', enum: [...Object.keys(MATERIALS),'solid'] },color:{type:'string'},solid:{type:'boolean'} }) },
    }) },
    systems:{type:'array',items:{anyOf:Object.entries(SYSTEMS).map(([type,definition])=>objSchema({id:{type:'string'},name:{type:'string'},type:{type:'string',enum:[type]},config:objSchema(Object.fromEntries(Object.keys(definition.fields).map(k=>[k,{type:k==='magazine'?'integer':'number'}]))),source:sourceSchema}))}},
    behaviors:{type:'array',items:{anyOf:[objSchema({format:{type:'string',enum:['craftmine.behavior/1']},...behaviorFields}),objSchema({format:{type:'string',enum:['craftmine.behavior/2']},...behaviorFields,requires:{type:'array',items:{type:'string',enum:['health@1','ranged@1','melee@1']}},binding:bindingSchema})]}},
  }) ] },
});

const assetSceneSchema=structuredClone(OUTPUT_SCHEMA.properties.scene.anyOf[1]);
assetSceneSchema.properties.format.enum=['craftmine.scene/4'];
assetSceneSchema.properties.objects.items.properties.appearance={anyOf:[{type:'null'},objSchema({asset:objSchema({id:{type:'string'},version:{type:'integer'},hash:{type:'string'}}),offset:vecSchema,size:vecSchema,rotationY:{type:'number'},fit:{type:'string',enum:['contain','stretch']}})]};
assetSceneSchema.properties.objects.items.required.push('appearance');
OUTPUT_SCHEMA.properties.scene.anyOf.push(assetSceneSchema);

export function encodeAgentScene(input){const scene=upgradeScene(input);return {...scene,format:scene.format==='craftmine.scene/4'?scene.format:'craftmine.scene/3',behaviors:(scene.behaviors||[]).map(({initialState,params,...d})=>({...d,initialStateJSON:JSON.stringify(initialState),paramsJSON:JSON.stringify(params)}))};}
export function decodeAgentScene(input){
  if(!['craftmine.scene/3','craftmine.scene/4'].includes(input?.format)||!Array.isArray(input.behaviors))throw Error('模型需要返回完整的新场景格式');
  return {...input,behaviors:input.behaviors.map(d=>{
    exactKeys(d,['format','id','name','description','code','stateVersion','initialStateJSON','paramsJSON','targets','permissions',...(d?.format==='craftmine.behavior/2'?['requires','binding']:[])]);
    if(typeof d.initialStateJSON!=='string'||d.initialStateJSON.length>16000||typeof d.paramsJSON!=='string'||d.paramsJSON.length>8000)throw Error('模型代码参数或初始状态无效');
    const {initialStateJSON,paramsJSON,...rest}=d;return {...rest,initialState:JSON.parse(initialStateJSON),params:JSON.parse(paramsJSON)};
  })};
}
