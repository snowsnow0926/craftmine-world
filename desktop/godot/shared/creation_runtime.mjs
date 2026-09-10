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
