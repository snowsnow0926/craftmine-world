/** Finite offscreen history navigation. No script, selector or core RPC input. */
type HistoryProbe = {action: string; worldId: string; targetOid?: string; path?: string};
const actions = new Set(['open', 'close', 'read', 'refresh', 'compareHead', 'compareVersion', 'diff', 'next', 'previous']);
export function historyProbeScript(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_HISTORY_PROBE');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['action','worldId','targetOid','path'].includes(key)) || typeof value.action !== 'string' || !actions.has(value.action)
    || typeof value.worldId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(value.worldId)) throw Error('INVALID_HISTORY_PROBE');
  if (value.action === 'compareVersion') {
    if (typeof value.targetOid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.targetOid)) throw Error('INVALID_HISTORY_PROBE');
  } else if (value.targetOid !== undefined) throw Error('INVALID_HISTORY_PROBE');
  if (value.action === 'diff') {
    if (typeof value.path !== 'string' || !value.path || value.path.length > 1024 || /[\u0000-\u001f]/.test(value.path)) throw Error('INVALID_HISTORY_PROBE');
  } else if (value.path !== undefined) throw Error('INVALID_HISTORY_PROBE');
  return `(${historyDomProbe.toString()})(${JSON.stringify(value)})`;
}

function historyDomProbe(input: HistoryProbe) {
  if (!(globalThis as any).__craftmineHeadless) throw Error('HEADLESS_HISTORY_GUARD_REQUIRED');
  const active = document.querySelector<HTMLElement>('.craftmine-world-item[data-world-active="true"]');
  if (active?.dataset.worldId !== input.worldId) throw Error('GODOT_WORLD_CHANGED');
  const section = document.querySelector<HTMLElement>('[data-godot-history]');
  if (section && section.dataset.historyWorld !== input.worldId) throw Error('GODOT_WORLD_CHANGED');
  const submit = (form: HTMLFormElement | null, button?: HTMLButtonElement | null) => {
    const target = button ?? form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!form || !target || target.form !== form || target.disabled) throw Error('HISTORY_PROBE_CONTROL_UNAVAILABLE');
    form.requestSubmit(target);
  };
  if (input.action === 'open') submit(document.querySelector('[data-history-open-form]'));
  else if (input.action === 'close') submit(document.querySelector('[data-history-close-form]'));
  else if (input.action === 'refresh') submit(document.querySelector('[data-history-refresh-form]'));
  else if (input.action === 'compareHead' || input.action === 'compareVersion') {
    const form = document.querySelector<HTMLFormElement>('[data-history-select-form]');
    const button = input.action === 'compareHead' ? form?.querySelector<HTMLButtonElement>('[data-history-compare-head]')
      : [...(form?.querySelectorAll<HTMLButtonElement>('[data-history-compare]') ?? [])].find(item => item.dataset.historyCompare === input.targetOid);
    if (!button) throw Error('HISTORY_PROBE_CONTROL_UNAVAILABLE');
    submit(form, button);
  } else if (input.action === 'diff' || input.action === 'next' || input.action === 'previous') {
    const form = document.querySelector<HTMLFormElement>('[data-comparison-form]');
    const button = input.action === 'diff' ? [...(form?.querySelectorAll<HTMLButtonElement>('[data-compare-path]') ?? [])].find(item => item.dataset.comparePath === input.path)
      : form?.querySelector<HTMLButtonElement>(input.action === 'next' ? '[data-compare-next]' : '[data-compare-previous]');
    if (!button) throw Error('HISTORY_PROBE_CONTROL_UNAVAILABLE');
    submit(form, button);
  }
  const text = (selector: string, limit = 1000) => section?.querySelector(selector)?.textContent?.slice(0, limit) ?? null;
  return {worldId: input.worldId, open: !!section, viewId: section?.dataset.historyView ?? null,
    headOid: section?.dataset.historyHead ?? null, appliedOid: section?.dataset.historyFormal ?? null,
    busy: section?.dataset.historyBusy === 'true', branch: section?.querySelector<HTMLSelectElement>('[data-history-branch]')?.value ?? null,
    comparison: !!section?.querySelector('[data-history-comparison]'), comparisonBusy: section?.querySelector<HTMLElement>('[data-history-comparison]')?.dataset.comparisonBusy === 'true',
    records: [...(section?.querySelectorAll<HTMLElement>('[data-history-records] [data-history-compare]') ?? [])].map(item => item.dataset.historyCompare),
    files: [...(section?.querySelectorAll<HTMLElement>('[data-compare-path]') ?? [])].map(item => ({path: item.dataset.comparePath, text: item.textContent})),
    range: text('[data-compare-range]'), count: text('[data-compare-count]'), patch: text('[data-compare-patch]', 65536), binary: text('[data-compare-binary]'),
    error: text('[role="alert"]', 4000), sourceOpen: !!section?.querySelector('[data-history-text]'),
    guard: {...(globalThis as any).__craftmineHeadless}};
}
