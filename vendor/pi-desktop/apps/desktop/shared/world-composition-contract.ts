export type CompositionRequest = {
  recipeId: "companion-exploration" | "rain-exploration" | "collect-unlock-flight";
  recipeVersion: 1;
  choices: {scenery: "keep" | "forest" | "city-street"; companion: boolean; weather: "keep" | "rain"; collectionCount: number};
  wish?: string;
};
export type CompositionPlan = {
  format: "craftmine.world-composition-plan/1"; worldId: string; planHash: string;
  request: CompositionRequest; source: {revision: number; manifestHash: string};
  components: Array<{archiveRef: {assetId: string; version: number; contentHash: string}; archiveSha256: string; rootContentHash: string; displayName: string; source: {licenseStatus: string}; sourceRequirements: {status: string}; existingSource: string}>;
  checks: Array<{id: string; status: string; detail: string}>;
  missingLogic: Array<{id: string; detail: string}>;
  applied: false; compatibility: "not-runtime-verified";
};
const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("COMPOSITION_INVALID_PARAMS");
  return value as Record<string, any>;
};
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some(key => !keys.includes(key))) throw Error("COMPOSITION_INVALID_PARAMS");
};
export function validateCompositionRequest(input: unknown): CompositionRequest {
  const value = record(input); exact(value, ["recipeId", "recipeVersion", "choices", "wish"]);
  if (!["companion-exploration", "rain-exploration", "collect-unlock-flight"].includes(value.recipeId) || value.recipeVersion !== 1) throw Error("COMPOSITION_RECIPE_VERSION_REQUIRED");
  const choices = record(value.choices); exact(choices, ["scenery", "companion", "weather", "collectionCount"]);
  if (!["keep", "forest", "city-street"].includes(choices.scenery) || typeof choices.companion !== "boolean" || !["keep", "rain"].includes(choices.weather)
    || !Number.isInteger(choices.collectionCount) || (value.recipeId === "collect-unlock-flight" ? choices.collectionCount < 1 || choices.collectionCount > 12 : choices.collectionCount !== 0)) throw Error("COMPOSITION_CHOICES_REQUIRED");
  if (value.wish !== undefined && (typeof value.wish !== "string" || new TextEncoder().encode(value.wish).length > 6000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.wish))) throw Error("COMPOSITION_WISH_INVALID");
  return {recipeId: value.recipeId, recipeVersion: 1, choices: {...choices} as CompositionRequest["choices"], ...(value.wish === undefined ? {} : {wish: value.wish})};
}
export function validateCompositionPackageRequest(method: unknown, input: unknown): Record<string, unknown> {
  const value = record(input);
  if (typeof value.worldId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(value.worldId)) throw Error("COMPOSITION_WORLD_REQUIRED");
  if (method === "compositionCatalog") {exact(value, ["worldId"]); return {worldId: value.worldId};}
  if (method !== "compositionPlan") throw Error("COMPOSITION_INVALID_PARAMS");
  exact(value, ["worldId", "request"]); return {worldId: value.worldId, request: validateCompositionRequest(value.request)};
}
export function parseCompositionPlan(input: unknown, worldId: string): CompositionPlan {
  const value = record(input), digest = /^[a-f0-9]{64}$/;
  if (value.format !== "craftmine.world-composition-plan/1" || value.worldId !== worldId || !digest.test(value.planHash) || value.applied !== false || value.compatibility !== "not-runtime-verified"
    || !Number.isSafeInteger(value.source?.revision) || value.source.revision < 0 || !digest.test(value.source?.manifestHash)
    || !Array.isArray(value.components) || value.components.length > 8 || !Array.isArray(value.checks) || value.checks.length > 24 || !Array.isArray(value.missingLogic) || value.missingLogic.length > 8) throw Error("COMPOSITION_RECEIPT_INVALID");
  validateCompositionRequest(value.request);
  for (const row of value.components) {
    if (!/^cw\.[a-z0-9._-]{1,72}$/.test(row?.archiveRef?.assetId) || !Number.isSafeInteger(row.archiveRef.version) || row.archiveRef.version < 1
      || !digest.test(row.archiveRef.contentHash) || !digest.test(row.archiveSha256) || !digest.test(row.rootContentHash) || typeof row.displayName !== "string" || row.displayName.length > 200
      || !["source-requirements-matched", "adaptation-required"].includes(row.sourceRequirements?.status) || typeof row.source?.licenseStatus !== "string") throw Error("COMPOSITION_RECEIPT_INVALID");
  }
  for (const row of [...value.checks, ...value.missingLogic]) if (typeof row?.id !== "string" || typeof row.detail !== "string" || row.detail.length > 1600) throw Error("COMPOSITION_RECEIPT_INVALID");
  return value as CompositionPlan;
}
export function compositionPrompt(plan: CompositionPlan, zh: boolean): string {
  parseCompositionPlan(plan, plan.worldId);
  const prefix = zh ? "请在当前世界实现这份玩法组合。保留我的补充要求和现有玩法、角色、相机及存档；不要把整城需求缩成一个街区片段。先通过 godot_source_library 的 compose 模式重新检查以下 request，再读取固定版本素材，补齐缺少的逻辑，使用正常源码修改、检查和采用流程。实际测试玩法及保存重开；编译成功或模型可见不能代替玩法验收。" : "Implement this composition in the current world. Preserve my additional wishes and existing gameplay, player, camera and saved progress; do not reduce a whole-city request to one fragment. Recheck this request through godot_source_library mode=compose, read the exact assets, implement missing logic and follow normal source edits, checks and adoption. Play the gameplay and test save/reopen; compilation or a visible model is not gameplay acceptance.";
  return prefix + "\n\n" + JSON.stringify({worldId: plan.worldId, planHash: plan.planHash, source: plan.source, request: plan.request, pinnedAssets: plan.components.map(row => ({ref: row.archiveRef, archiveSha256: row.archiveSha256})), requiredChecks: plan.checks.map(row => row.id), missingLogic: plan.missingLogic.map(row => row.id)}, null, 2);
}
