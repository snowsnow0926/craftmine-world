/** Fixed DOM forms only. This script is installed by the private headless IPC. */
type AssetProbe = {action: string; ownerWorldId: string | null; assetId?: string; version?: number; tags?: string[]; favoritesOnly?: boolean};
export function assetsProbeScript(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("INVALID_ASSET_PROBE");
  const value = input as Record<string, any>;
  const fields: Record<string, string[]> = {open: [], close: [], read: [], importPick: [], importConfirm: [], preview: ["assetId", "version"], select: ["assetId", "version"], favorite: ["assetId"], saveTags: ["assetId", "tags"], filter: ["favoritesOnly"]};
  if (typeof value.action !== "string" || !Object.hasOwn(fields, value.action) || Object.keys(value).some(key => !["action", "ownerWorldId", ...fields[value.action]].includes(key))
    || !(value.ownerWorldId === null || typeof value.ownerWorldId === "string" && /^[a-z0-9][a-z0-9-]{1,47}$/.test(value.ownerWorldId))
    || (fields[value.action].includes("assetId") && !(typeof value.assetId === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value.assetId)))
    || (fields[value.action].includes("version") && !(Number.isSafeInteger(value.version) && value.version > 0))
    || (value.action === "filter" && typeof value.favoritesOnly !== "boolean")
    || (value.action === "saveTags" && !(Array.isArray(value.tags) && value.tags.length <= 32 && value.tags.every((tag: unknown) => typeof tag === "string" && !!tag.trim() && new TextEncoder().encode(tag).length <= 40 && !/[\p{Cc},，;]/u.test(tag))))) throw Error("INVALID_ASSET_PROBE");
  return `(${assetsDomProbeResult.toString()})(${JSON.stringify(value)},${assetsDomProbe.toString()})`;
}
/** Decode only our finite test transport; unknown page failures still reject. */
export function unwrapAssetsProbeResult(result: unknown): any {
  const value = result as any;
  if (!value || value.format !== "craftmine.asset-probe-result/1" || typeof value.ok !== "boolean") throw Error("INVALID_ASSET_PROBE_RESULT");
  if (!value.ok) {
    if (Object.keys(value).sort().join(",") !== "code,format,ok" ||
        !["HEADLESS_ASSET_GUARD_REQUIRED", "ASSET_PANEL_OWNER_CHANGED", "ASSET_PROBE_CONTROL_UNAVAILABLE", "ASSET_PROBE_UNOBSERVED_ASSET", "ASSET_PROBE_UNOBSERVED_VERSION"].includes(value.code)) throw Error("INVALID_ASSET_PROBE_RESULT");
    throw Error(value.code);
  }
  if (Object.keys(value).sort().join(",") !== "format,ok,value" || !value.value || typeof value.value !== "object" || Array.isArray(value.value)) throw Error("INVALID_ASSET_PROBE_RESULT");
  return value.value;
}
function assetsDomProbeResult(input: AssetProbe, probe: (input: AssetProbe) => unknown) {
  try {
    return {format: "craftmine.asset-probe-result/1", ok: true, value: probe(input)};
  } catch (error) {
    const code = error instanceof Error ? error.message : null;
    if (code === "ASSET_PROBE_CONTROL_UNAVAILABLE" && input.action === "open") {
      return {format: "craftmine.asset-probe-result/1", ok: true, value: {ready: false, open: false}};
    }
    if (code && ["HEADLESS_ASSET_GUARD_REQUIRED", "ASSET_PANEL_OWNER_CHANGED", "ASSET_PROBE_CONTROL_UNAVAILABLE", "ASSET_PROBE_UNOBSERVED_ASSET", "ASSET_PROBE_UNOBSERVED_VERSION"].includes(code)) {
      return {format: "craftmine.asset-probe-result/1", ok: false, code};
    }
    throw error;
  }
}
function assetsDomProbe(input: AssetProbe) {
  if (!(globalThis as any).__craftmineHeadless) throw Error("HEADLESS_ASSET_GUARD_REQUIRED");
  const active = document.querySelector<HTMLElement>('.craftmine-world-item[data-world-active="true"]')?.dataset.worldId ?? null;
  const sheet = document.querySelector<HTMLElement>('[data-asset-sheet="true"]');
  if (active !== input.ownerWorldId || (sheet && (sheet.dataset.assetOwner || null) !== active)) throw Error("ASSET_PANEL_OWNER_CHANGED");
  const submit = (form: HTMLFormElement | null | undefined, button?: HTMLButtonElement) => {
    const target = button ?? form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!form || !target || target.form !== form || target.disabled || target.closest('[hidden]')) throw Error("ASSET_PROBE_CONTROL_UNAVAILABLE");
    form.requestSubmit(target);
  };
  const cards = [...(sheet?.querySelectorAll<HTMLButtonElement>('.asset-library-card[data-asset-id]') ?? [])];
  const annotation = sheet?.querySelector<HTMLElement>('[data-annotation-asset]');
  if (input.action === "open" && !sheet) {
    const toggle = document.querySelector<HTMLButtonElement>('[data-aux-toggle="assets"]');
    submit(document.querySelector<HTMLFormElement>(toggle?.getAttribute("aria-expanded") === "true" ? '[data-aux-open-form="assets"]' : '[data-aux-toggle-form="assets"]'));
  } else if (input.action === "close") submit(sheet?.querySelector('[data-asset-close-form]'));
  else if (input.action === "select") {
    const card = cards.find(item => item.dataset.assetId === input.assetId && Number(item.dataset.assetVersion) === input.version);
    if (!card) throw Error("ASSET_PROBE_UNOBSERVED_ASSET");
    submit(card.form, card);
  } else if (input.action === "importPick" || input.action === "importConfirm") {
    submit(sheet?.querySelector<HTMLFormElement>(input.action === "importPick" ? '[data-asset-import-form="pick"]' : '[data-asset-import-form="confirm"]'));
  } else if (input.action === "preview") {
    if (!annotation || annotation.dataset.annotationAsset !== input.assetId) throw Error("ASSET_PROBE_UNOBSERVED_ASSET");
    const form = sheet?.querySelector<HTMLFormElement>('[data-asset-preview-form="begin"]');
    if (Number(form?.dataset.previewVersion) !== input.version) throw Error("ASSET_PROBE_UNOBSERVED_VERSION");
    submit(form);
  } else if (input.action === "favorite" || input.action === "saveTags") {
    if (!annotation || annotation.dataset.annotationAsset !== input.assetId) throw Error("ASSET_PROBE_UNOBSERVED_ASSET");
    if (input.action === "saveTags") {
      const text = annotation.querySelector<HTMLInputElement>('[data-annotation-tags]');
      if (!text || text.disabled) throw Error("ASSET_PROBE_CONTROL_UNAVAILABLE");
      text.value = input.tags!.join(", ");
    }
    submit(annotation.querySelector<HTMLFormElement>(input.action === "favorite" ? '[data-annotation-form="favorite"]' : '[data-annotation-form="tags"]'));
  } else if (input.action === "filter") {
    const control = sheet?.querySelector<HTMLInputElement>('[data-filter="favorites"]');
    if (!control || control.disabled) throw Error("ASSET_PROBE_CONTROL_UNAVAILABLE");
    control.checked = input.favoritesOnly!;
    submit(control.form);
  }
  const button = annotation?.querySelector<HTMLButtonElement>('[data-annotation-form="favorite"] button');
  return {ownerWorldId: active, open: !!sheet,
    cards: cards.slice(0, 100).map(item => ({assetId: item.dataset.assetId, version: Number(item.dataset.assetVersion)})),
    selected: annotation ? {assetId: annotation.dataset.annotationAsset, favorite: button?.getAttribute("aria-pressed") === "true", tags: annotation.querySelector<HTMLInputElement>('[data-annotation-tags]')?.value ?? "", pending: button?.disabled === true} : null,
    favoritesOnly: sheet?.querySelector<HTMLInputElement>('[data-filter="favorites"]')?.checked ?? false,
    import: {ready: !!sheet?.querySelector('[data-asset-import-form="confirm"]'), done: sheet?.querySelector('[data-asset-import="done"]')?.textContent?.slice(0, 500) ?? null},
    preview: {tone: sheet?.querySelector<HTMLElement>('[data-preview-tone]')?.dataset.previewTone ?? null, label: sheet?.querySelector('.asset-library-preview-label')?.textContent?.slice(0, 500) ?? null, thumbnail: !!sheet?.querySelector('[data-preview-thumb]')},
    error: sheet?.querySelector('[role="alert"]')?.textContent?.slice(0, 1000) ?? null,
    guard: {...(globalThis as any).__craftmineHeadless}};
}
