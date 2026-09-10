// Shared, renderer-neutral view of world/creation.json. Godot uses the same
// document through creation_renderer.gd; keeping this parser pure lets tests
// verify save/reopen identity without launching a window.
export function readCreationEntities(text) {
  if (typeof text !== 'string' || text.trim() === '') return { revision: 0, entities: [] };
  const value = JSON.parse(text);
  if (!value || value.format !== 'craftmine.creation-scene/1' || !Array.isArray(value.entities)) {
    throw new Error('CREATION_SCENE_INVALID');
  }
  return {
    revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
    entities: value.entities.map((entity) => ({
      id: entity.id, kind: entity.kind,
      position: [...entity.position], rotationY: entity.rotationY,
      scale: [...entity.scale], color: entity.color,
      parameters: { ...(entity.parameters || {}) },
    })),
  };
}

export function creationRenderItems(document) {
  return document.entities.map((entity) => ({
    id: entity.id, kind: entity.kind,
    // Top-down bases use x/z from the shared 3D creation coordinate system.
    position: { x: entity.position[0], y: entity.position[2] },
    scale: { x: entity.scale[0], y: entity.scale[1] },
    color: entity.color,
  }));
}

/**
 * Project durable creation entities into a renderer-neutral 2D view.
 * Side-view and mining-sandbox both use screen-space x/y coordinates while
 * creation operations store a shared 3D position.  Keeping this mapping pure
 * lets each base render the same saved document without trusting arbitrary
 * values from the file.
 */
export function creationRenderItemsForBase(document, baseId, options = {}) {
  const scale = Number.isFinite(options.scale) ? options.scale : 32;
  const origin = Array.isArray(options.origin) && options.origin.length >= 2
    ? [Number(options.origin[0]) || 0, Number(options.origin[1]) || 0]
    : [0, 0];
  if (!['side-view', 'mining-sandbox', 'top-down'].includes(baseId)) {
    throw new Error('CREATION_BASE_UNSUPPORTED');
  }
  return document.entities.map((entity) => {
    const p = Array.isArray(entity.position) ? entity.position : [0, 0, 0];
    const x = Number.isFinite(Number(p[0])) ? Number(p[0]) : 0;
    // Side-view/mining use the shared x/y plane. Top-down keeps x/z.
    const axis = baseId === 'top-down' ? 2 : 1;
    const y = Number.isFinite(Number(p[axis])) ? Number(p[axis]) : 0;
    return {
      id: entity.id,
      kind: entity.kind,
      position: { x: origin[0] + x * scale, y: origin[1] + y * scale },
      scale: { x: Number(entity.scale?.[0]) || 1, y: Number(entity.scale?.[1]) || 1 },
      color: entity.color,
    };
  });
}
