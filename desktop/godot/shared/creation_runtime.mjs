// Pure runtime projection for the authored creation scene.
// This is deliberately independent of Godot so acceptance can verify the
// durable scene after save/reopen without moving a real mouse or starting a UI.

const SHAPES = Object.freeze({
  tree: [0.6, 2, 0.6], rock: [0.7, 0.7, 0.7], chest: [0.6, 0.55, 0.5],
  door: [0.8, 1.3, 0.25], marker: [0.3, 0.7, 0.3],
});

const clone = value => JSON.parse(JSON.stringify(value));

/** Convert creation.json into deterministic entities understood by probes. */
export function materializeCreationRuntime(document) {
  if (!document || document.format !== 'craftmine.creation-scene/1' || !Array.isArray(document.entities)) {
    throw new Error('CREATION_RUNTIME_INVALID_SCENE');
  }
  const entities = document.entities.map(entity => {
    const shape = SHAPES[entity.kind];
    if (!shape) throw new Error('CREATION_RUNTIME_INVALID_KIND');
    return {
      id: entity.id, kind: entity.kind, position: [...entity.position],
      rotationY: entity.rotationY, scale: [...entity.scale], color: entity.color,
      parameters: clone(entity.parameters || {}), halfExtents: bounds(entity, shape),
    };
  });
  const rules = (document.rules || []).map(rule => ({
    id: rule.id, kind: rule.kind, doorId: rule.doorId, sequence: [...rule.sequence],
    progress: 0, open: false,
  }));
  return { format: 'craftmine.creation-runtime/1', revision: document.revision,
    timeOfDay: document.defaults?.timeOfDay ?? 12, entities, rules };
}

function bounds(entity, shape) {
  const angle = entity.rotationY * Math.PI / 180;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const x = shape[0] * entity.scale[0], z = shape[2] * entity.scale[2];
  return [x * c + z * s, shape[1] * entity.scale[1], x * s + z * c];
}

/** Stable target snapshot used by creation_operation and acceptance tests. */
export function creationTargetSnapshot(runtime, { worldId, buildId, instanceId, manifestHash,
  snapshotId = `creation-${runtime.revision}`, playerPosition = [0, 0, 0], targetId = null } = {}) {
  const target = targetId ? runtime.entities.find(entity => entity.id === targetId) : null;
  return { format: 'craftmine.creation-target/1', snapshotId, worldId, buildId, instanceId,
    sourceRevision: runtime.revision, manifestHash, playerPosition: [...playerPosition],
    target: target ? { entityId: target.id, position: [...target.position], normal: [0, 1, 0], surface: 'entity', revision: runtime.revision } :
      { entityId: null, position: [0, 0, 0], normal: [0, 1, 0], surface: 'ground', revision: runtime.revision },
    obstacles: runtime.entities.map(entity => ({ id: entity.id, position: [...entity.position], halfExtents: [...entity.halfExtents] })),
  };
}

/** Map a durable entity to the same deterministic canvas coordinates as the
 * top-down CreationRenderer. This pure mapping is used by headless interaction
 * tests and keeps target identity tied to the persisted entity id. */
export function creationScreenPoint(entity, { origin = [192, 128], pixelsPerUnit = 32 } = {}) {
  if (!entity || !Array.isArray(entity.position) || entity.position.length !== 3) return null;
  return [origin[0] + Number(entity.position[0]) * pixelsPerUnit,
    origin[1] + Number(entity.position[2]) * pixelsPerUnit];
}

/** Select the nearest persisted entity under a top-down canvas point. */
export function selectCreationTarget(runtime, point, { origin = [192, 128], pixelsPerUnit = 32,
  padding = 8, maxDistance = Infinity } = {}) {
  if (!runtime || !Array.isArray(runtime.entities) || !Array.isArray(point) || point.length !== 2) return null;
  let best = null;
  for (const entity of runtime.entities) {
    const screen = creationScreenPoint(entity, { origin, pixelsPerUnit });
    if (!screen) continue;
    const half = entity.halfExtents || [0.5, 0.5, 0.5];
    const radius = Math.max(Number(half[0]) || 0, Number(half[2]) || 0) * pixelsPerUnit + padding;
    const dx = point[0] - screen[0], dy = point[1] - screen[1];
    const distance = Math.hypot(dx, dy);
    if (distance > radius || distance > maxDistance) continue;
    if (!best || distance < best.distance || (distance === best.distance && entity.id < best.entity.id)) {
      best = { entity, distance, screenPoint: screen };
    }
  }
  return best ? best.entity : null;
}

/** Build a target snapshot directly from a safe canvas selection. */
export function creationTargetSnapshotAtPoint(runtime, point, metadata = {}, options = {}) {
  const target = selectCreationTarget(runtime, point, options);
  return creationTargetSnapshot(runtime, { ...metadata, targetId: target?.id ?? null });
}

/** Apply one marker interaction to a sequence-door rule in pure logic. */
export function advanceSequenceDoor(runtime, markerId) {
  const next = clone(runtime);
  for (const rule of next.rules) {
    if (rule.open || rule.sequence[rule.progress] !== markerId) { if (!rule.open && rule.sequence.includes(markerId)) rule.progress = 0; continue; }
    rule.progress += 1;
    if (rule.progress >= rule.sequence.length) { rule.open = true; rule.progress = rule.sequence.length; }
  }
  return next;
}
