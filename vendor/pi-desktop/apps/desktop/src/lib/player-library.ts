export type LibraryReference = {assetId: string; version: number; contentHash: string};
export type PublishKind = "component" | "world";
export type LibraryCall = {call(channel: string, payload?: Record<string, unknown>): Promise<unknown>};
export type SourceSelection = {worldId: string; revision: number; manifestHash: string; items: Array<{nodePath: string; name: string; supported: boolean; reason?: string}>};
export type WorldTemplate = {ref: LibraryReference; displayName: string; description: string; tags: string[]; initialState: "saved-progress"; preview?: string; previewScope?: string; baseId?: string; baseVersion?: string; archiveSha256?: string};
let pendingTemplate: LibraryReference | null = null;
export const requestedWorldTemplate = () => pendingTemplate;
export const clearRequestedWorldTemplate = () => {pendingTemplate = null;};
export function requestWorldTemplateCreation(ref: LibraryReference) {
  pendingTemplate = libraryReference(ref);
  window.dispatchEvent(new CustomEvent("craftmine-mode-entry-open"));
}
export const libraryRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function libraryReference(value: unknown): LibraryReference {
  const ref = libraryRecord(value);
  if (typeof ref.assetId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(ref.assetId) || !Number.isSafeInteger(ref.version) || Number(ref.version) < 1 || Number(ref.version) > 100000 || !/^[a-f0-9]{64}$/.test(String(ref.contentHash))) throw Error("INVALID_ASSET_REFERENCE");
  return {assetId: ref.assetId, version: ref.version as number, contentHash: ref.contentHash as string};
}
export function parsePublicationSource(value: unknown, worldId: string): SourceSelection {
  const source = libraryRecord(value);
  if (source.worldId !== worldId || !Number.isSafeInteger(source.revision) || !/^[a-f0-9]{64}$/.test(String(source.manifestHash)) || !Array.isArray(source.items)) throw Error("PACKAGE_SOURCE_RECEIPT_INVALID");
  return {worldId, revision: source.revision as number, manifestHash: source.manifestHash as string, items: source.items.slice(0, 512).map(value => {
    const row = libraryRecord(value);
    if (typeof row.nodePath !== "string" || typeof row.name !== "string") throw Error("PACKAGE_SOURCE_RECEIPT_INVALID");
    return {nodePath: row.nodePath, name: row.name, supported: row.supported === true, ...(typeof row.reason === "string" ? {reason: row.reason} : {})};
  })};
}
export function parsePlayerWorldTemplate(value: unknown): WorldTemplate {
  const result = libraryRecord(value);
  if (result.format !== "craftmine.player-world-template/1" || result.kind !== "world" || result.action !== "create-new-world" || result.initialState !== "saved-progress" || typeof result.displayName !== "string") throw Error("WORLD_TEMPLATE_INVALID");
  const ref = libraryReference(result.ref);
  if (!ref.assetId.startsWith("player.world.")) throw Error("WORLD_TEMPLATE_INVALID");
  const preview = typeof result.preview === "string" && result.preview.length < 700050 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(result.preview) ? result.preview : undefined;
  return {ref, displayName: result.displayName, description: typeof result.description === "string" ? result.description : "", tags: Array.isArray(result.tags) ? result.tags.filter((tag): tag is string => typeof tag === "string") : [], initialState: "saved-progress", ...(preview ? {preview, previewScope: "source-world-view"} : {}), ...(typeof result.baseId==="string"?{baseId:result.baseId}:{}), ...(typeof result.baseVersion==="string"?{baseVersion:result.baseVersion}:{}), ...(/^[a-f0-9]{64}$/.test(String(result.archiveSha256))?{archiveSha256:result.archiveSha256 as string}:{})};
}
export function publicationMetadata(kind: PublishKind, name: string, description: string, tagsText: string, aliasesText: string) {
  const size = (text: string) => new TextEncoder().encode(text).length;
  const displayName = name.trim(), notes = description.trim();
  if (!displayName || size(displayName) > (kind === "world" ? 120 : 200) || /\p{Cc}/u.test(displayName)) throw Error("PUBLICATION_NAME_INVALID");
  if (size(notes) > (kind === "world" ? 1200 : 3000)) throw Error("PUBLICATION_DESCRIPTION_INVALID");
  const split = (input: string) => [...new Set(input.split(/[,，;；]/u).map(value => value.trim()).filter(Boolean))];
  const tags = split(tagsText), aliases = split(aliasesText), combined = [...new Set([...tags, ...aliases])];
  if (combined.length > 24 || combined.some(tag => size(tag) > 40 || /\p{Cc}/u.test(tag))) throw Error("PUBLICATION_TAGS_INVALID");
  return {displayName, description: notes, tags, aliases};
}
export function publicationMessage(code: unknown, zh: boolean): string {
  const text = String(code instanceof Error ? code.message : code);
  const known: Array<[RegExp, string, string]> = [
    [/PUBLICATION_NAME_INVALID/, "请填写较短的素材名称。", "Enter a shorter asset name."],
    [/PUBLICATION_DESCRIPTION_INVALID/, "请缩短说明。", "Shorten the description."],
    [/PUBLICATION_TAGS_INVALID/, "标签与别名合计最多 24 项，请缩短过长条目。", "Use up to 24 short tags and aliases."],
    [/SOURCE_CHANGED|WORLD_CHANGED|OWNER_CHANGED|SOURCE_MISMATCH|SOURCE_STALE/, "世界或源码已变化。如有保留的保存操作，请先取消本次保存，再重新读取并保存。", "The world or source changed. Cancel any retained save, then reload and save again."],
    [/COMPONENT_TOO_LARGE/, "这个对象及其依赖超过组件大小限制，请先拆分。", "This object and its dependencies are too large; split it into smaller components."],
    [/DEPENDENCY|MULTIPLE_IDENTITIES|SELECT_COMPONENT_NOT_WORLD/, "此对象还不能独立保存，需要先整理依赖或拆分组件。", "Prepare an independent component or resolve its dependencies first."],
    [/VERSION.*(CONFLICT|EXISTS)|ASSET.*CONFLICT/, "这个版本已存在，请查看素材库或选择新的版本。", "This version already exists. Check the library or choose a new version."],
    [/NOT_GODOT|GODOT_WORLD_REQUIRED|WORLD_TEMPLATE_UNSUPPORTED/, "目前支持已应用的 Godot 世界。", "An applied Godot world is required."],
  ];
  return known.find(([pattern]) => pattern.test(text))?.[zh ? 1 : 2] ?? text;
}
export async function publicationPackageCall(bridge: LibraryCall, worldId: string, method: string, params: Record<string, unknown> = {}) {
  return bridge.call("package.request", {worldId, method, params: {...params, worldId}});
}
