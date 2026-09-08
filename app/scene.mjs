import { createHash } from 'node:crypto';

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
  keys(input, ['format', 'player']);
  if (input.format !== INITIAL_SNAPSHOT.format) throw Error('进度格式不兼容，已保留原存档');
  keys(input.player, ['x', 'y', 'z', 'yaw', 'pitch']);
  const p = input.player;
  if (Object.values(p).some(n => !Number.isFinite(n)) || Math.abs(p.x) > 47.4 || Math.abs(p.z) > 47.4 || p.y < 6 || p.y > 38 || Math.abs(p.yaw) > 1e6 || Math.abs(p.pitch) > 1.52) throw Error('玩家位置或视角无效');
  return clone(input);
}
export function compileScene(input) {
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
export function sceneDiff(before, after) {
  const old = new Map(before.objects.map(o => [o.id, o])), next = new Map(after.objects.map(o => [o.id, o]));
  return {
    added: after.objects.filter(o => !old.has(o.id)).map(o => o.name),
    changed: after.objects.filter(o => old.has(o.id) && JSON.stringify(old.get(o.id)) !== JSON.stringify(o)).map(o => o.name),
    removed: before.objects.filter(o => !next.has(o.id)).map(o => o.name),
    environment: before.night !== after.night,
  };
}
export function validateObjectScope(before, after, selected) {
  if (!selected) return;
  const beforeRest = before.objects.filter(o => o.id !== selected);
  const afterRest = after.objects.filter(o => o.id !== selected);
  if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest) || before.night !== after.night || before.title !== after.title) throw Error('模型修改超出了选中对象的范围，候选未采纳。若要修改整个世界，请先清除对象选择。');
}
const vecSchema = { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, z: { type: 'integer' } }, required: ['x','y','z'], additionalProperties: false };
const objSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const OUTPUT_SCHEMA = objSchema({
  summary: { type: 'string' },
  notes: { type: 'array', items: { type: 'string' } },
  scene: { anyOf: [ { type: 'null' }, objSchema({
    format: { type: 'string', enum: ['craftmine.scene/1'] }, title: { type: 'string' }, night: { type: 'boolean' },
    objects: { type: 'array', items: objSchema({
      id: { type: 'string' }, name: { type: 'string' }, position: vecSchema,
      parts: { type: 'array', items: objSchema({ offset: vecSchema, size: vecSchema, material: { type: 'string', enum: Object.keys(MATERIALS) } }) },
    }) },
  }) ] },
});
