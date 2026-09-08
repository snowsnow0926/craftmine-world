import { canonicalJSON } from '../canonical.mjs';

// 轨迹 = 一次需求跑完之后的全部可观察事实。裁判只吃轨迹，不吃代码、不吃解释。
// 因此判定是纯函数：同一份轨迹跑两次必然同一结论。
export const TRACE_FORMAT = 'craftmine.trace/1';

export function traceStep(input = {}) {
  return {
    index: input.index ?? 0,
    label: input.label || input.event?.type || 'step',
    event: input.event || { type: 'tick', targetId: null },
    player: input.player ? { x: input.player.x, y: input.player.y, z: input.player.z } : null,
    commands: input.commands || [],
    effects: input.effects || [],
    before: input.before || null,
    after: input.after || null,
    change: input.change || { changed: false, fields: [] },
    error: input.error || null,
  };
}

export function buildTrace(input = {}) {
  const steps = (input.steps || []).map((step, index) => traceStep({ ...step, index }));
  return {
    format: TRACE_FORMAT,
    requirement: input.requirement || null,
    build: input.build || null,
    revision: input.revision ?? null,
    player: input.player || null,
    baseline: input.baseline || null,
    start: input.start || null,
    steps,
    final: input.final || steps[steps.length - 1]?.after || null,
    errors: input.errors || steps.filter(step => step.error).map(step => `${step.label}：${step.error}`),
  };
}

export function traceDigest(trace) {
  return canonicalJSON({
    format: trace?.format || TRACE_FORMAT,
    requirement: trace?.requirement || null,
    build: trace?.build || null,
    baseline: trace?.baseline || null,
    start: trace?.start || null,
    steps: (trace?.steps || []).map(step => ({ label: step.label, event: step.event, commands: step.commands, change: step.change, error: step.error, after: step.after })),
    final: trace?.final || null,
  });
}

// 轨迹必须自洽：每一步的前后快照要接得上，否则判定没有意义。
export function validateTrace(trace) {
  if (!trace || trace.format !== TRACE_FORMAT) throw Error('轨迹格式不兼容');
  if (!trace.start) throw Error('轨迹缺少初始快照');
  if (!Array.isArray(trace.steps)) throw Error('轨迹缺少步骤');
  return trace;
}

