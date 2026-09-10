/** Finite offscreen parameter forms. No arbitrary value, selector, script or RPC. */
type TargetProbe = {action: string; worldId: string; targetId?: string};
const actions = new Set(['open', 'close', 'read', 'select', 'useDefault', 'submit']);
export function targetFeedbackProbeScript(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_TARGET_FEEDBACK_PROBE');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['action', 'worldId', 'targetId'].includes(key))
    || typeof value.action !== 'string' || !actions.has(value.action)
    || typeof value.worldId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(value.worldId)) throw Error('INVALID_TARGET_FEEDBACK_PROBE');
  if (value.action === 'select') {
    if (typeof value.targetId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.targetId)) throw Error('INVALID_TARGET_FEEDBACK_PROBE');
  } else if (value.targetId !== undefined) throw Error('INVALID_TARGET_FEEDBACK_PROBE');
  return `(${targetFeedbackDomProbe.toString()})(${JSON.stringify(value)})`;
}
async function targetFeedbackDomProbe(input: TargetProbe) {
  const api = globalThis as any;
  if (!api.__craftmineHeadless) throw Error('HEADLESS_TARGET_FEEDBACK_GUARD_REQUIRED');
  const bound = () => {if (document.body.dataset.worldId !== input.worldId) throw Error('GODOT_WORLD_CHANGED');};
  bound();
  if (input.action === 'open' || input.action === 'close') {
    await api.craftmineView.showSurface({surface: input.action === 'open' ? {kind:'workbench',tab:'library'} : {kind:'world'}});
    bound();
  }
  const area = document.querySelector<HTMLElement>('[data-target-feedback]');
  const open = !!area && !area.closest('[hidden]');
  const select = area?.querySelector<HTMLSelectElement>('select');
  const field = area?.querySelector<HTMLInputElement>('[data-target-feedback-value]');
  const defaults = area?.querySelector<HTMLButtonElement>('[data-target-feedback-default]');
  const submit = area?.querySelector<HTMLButtonElement>('[data-target-feedback-submit]');
  if (input.action === 'select') {
    if (!open || !select || select.disabled || ![...select.options].some(option => option.value === input.targetId)) throw Error('TARGET_FEEDBACK_PROBE_TARGET_UNAVAILABLE');
    select.value = input.targetId!;
    select.dispatchEvent(new Event('change'));
  } else if (input.action === 'useDefault' || input.action === 'submit') {
    const button = input.action === 'useDefault' ? defaults : submit;
    if (!open || !button || button.disabled || !button.form || !area?.contains(button.form)) throw Error('TARGET_FEEDBACK_PROBE_CONTROL_UNAVAILABLE');
    button.form.requestSubmit(button);
  }
  bound();
  return {worldId:input.worldId,open,selectedTarget:select?.value??null,value:field?.value??null,
    targets:[...(select?.options??[])].slice(0,64).map(option => option.value),
    defaultDisabled:!defaults||defaults.disabled,submitDisabled:!submit||submit.disabled,
    defaultSource:area?.querySelector('[data-target-feedback-default-source]')?.textContent?.slice(0,2048)??null,
    notice:area?.querySelector('[role="status"]')?.textContent?.slice(0,4096)??null,
    guard:{...api.__craftmineHeadless}};
}
