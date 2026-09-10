export type CreationTarget = {
  entityId: string | null;
  entityName?: string;
  entityKind?: string;
  scale?: [number,number,number];
  color?: string;
  position: [number, number, number];
  normal: [number, number, number];
  surface: "entity" | "ground";
  revision: number;
};
export type CreationTargetCapture = {
  captureId: string | null;
  worldId: string | null;
  target: CreationTarget | null;
  reason: string | null;
};
export type CreationRequestContext = { creationTarget: { captureId: string } };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
const vector = (value: unknown): [number, number, number] | null => Array.isArray(value) && value.length === 3 && value.every(component => typeof component === "number" && Number.isFinite(component)) ? [...value] as [number, number, number] : null;

/** Display only host-observed valid entity/ground hits; a boundary is not a placement target. */
export function parseCreationTarget(value: unknown): CreationTargetCapture {
  const raw = record(value), hit = record(raw.target);
  const position = vector(hit.position), normal = vector(hit.normal);
  const entityId = id(hit.entityId);
  const validSurface = hit.surface === "ground" || (hit.surface === "entity" && entityId !== null);
  const revision = typeof hit.revision === "number" && Number.isSafeInteger(hit.revision) && hit.revision >= 0 ? hit.revision : null;
  const target = position && normal && validSurface && revision !== null
    ? { entityId: hit.surface === "entity" ? entityId : null, position, normal, surface: hit.surface as "entity" | "ground", revision, ...(id(hit.entityName)?{entityName: id(hit.entityName)!}:{}), ...(id(hit.entityKind)?{entityKind:id(hit.entityKind)!}:{}), ...(vector(hit.scale)?{scale:vector(hit.scale)!}:{}), ...(typeof hit.color === "string" && /^#[a-fA-F0-9]{6}$/.test(hit.color)?{color:hit.color}:{}) }
    : null;
  return { captureId: target || raw.target === null ? id(raw.captureId) : null, worldId: id(raw.worldId), target, reason: id(raw.reason) };
}

/** Copy the opaque host capture now. Queuing or later camera movement cannot alter it. */
export function creationRequestContext(capture: CreationTargetCapture | null): CreationRequestContext | undefined {
  return capture?.captureId ? { creationTarget: { captureId: capture.captureId } } : undefined;
}

export function copyCreationRequestContext(context: CreationRequestContext | undefined): CreationRequestContext | undefined {
  return context ? { creationTarget: { captureId: context.creationTarget.captureId } } : undefined;
}
