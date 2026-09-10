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
