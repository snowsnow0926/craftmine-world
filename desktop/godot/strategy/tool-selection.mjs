// Tool selection: the "old strategy" and the candidate "new strategy" side by side.
//
// The two arms are pure functions of the same inputs, so a comparison cannot be
// won by giving the new arm a different task set or a different clock.
//
//   baseline  (current behaviour, kept for comparison)
//     - only filters by base id, ignores engine/state compatibility, capability
//       availability and past failures, keeps the whole catalog in id order.
//   candidate (what GD8 is allowed to test)
//     - filters by engine version, state format and available capabilities;
//     - drops tools that already failed on this base+version and have not
//       succeeded since (failed-experience reuse);
//     - orders by past success, then cost, then id, and caps the list.
//
// Neither arm may change the frozen task set, the scoring contract or the
// pass conditions. They only choose tools.
import { STRATEGY_ARM_FORMAT, isPlain } from './formats.mjs';

export const ARM_IDS = Object.freeze(['baseline', 'candidate']);

function normalizeTool(raw, index) {
  if (!isPlain(raw) || typeof raw.toolId !== 'string' || raw.toolId.length === 0) {
    return { ok: false, errors: [`catalog[${index}] 缺少 toolId`] };
  }
  return {
    ok: true,
    errors: [],
    tool: {
      toolId: raw.toolId,
      name: typeof raw.name === 'string' ? raw.name : raw.toolId,
      bases: Array.isArray(raw.bases) ? raw.bases : [],
      engineVersions: Array.isArray(raw.engineVersions) ? raw.engineVersions : [],
      stateFormats: Array.isArray(raw.stateFormats) ? raw.stateFormats : [],
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
      requires: Array.isArray(raw.requires) ? raw.requires : [],
      costClass: Number.isFinite(raw.costClass) ? raw.costClass : 2,
    },
  };
}

function memoryStats(memory, toolId, context, capabilities) {
  const relevant = (Array.isArray(memory) ? memory : []).filter(record => isPlain(record)
    && record.toolId === toolId
    && (record.baseId === undefined || record.baseId === context.baseId)
    && (record.baseVersion === undefined || record.baseVersion === context.baseVersion)
    && (record.capability === undefined || capabilities.length === 0 || capabilities.includes(record.capability)));
  const ordered = [...relevant].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  const last = ordered[ordered.length - 1] || null;
  const successes = ordered.filter(record => record.outcome === 'success').length;
  const failures = ordered.filter(record => record.outcome === 'failure').length;
  return {
    attempts: ordered.length,
    successes,
    failures,
    lastOutcome: last ? last.outcome : null,
    lastAt: last ? last.at ?? null : null,
    successRate: ordered.length ? Number((successes / ordered.length).toFixed(3)) : null,
  };
}

export function selectTools({ task = {}, catalog = [], context = {}, memory = [], arm = 'candidate', maxTools = 8 } = {}) {
  if (!ARM_IDS.includes(arm)) throw new Error(`未知策略分支：${arm}；可选 ${ARM_IDS.join('、')}`);
  const capabilityTags = Array.isArray(task.capabilityTags) ? task.capabilityTags : [];
  const available = new Set(Array.isArray(context.availableCapabilities) ? context.availableCapabilities : []);
  const normalized = catalog.map((raw, index) => normalizeTool(raw, index));
  const invalid = normalized.filter(item => !item.ok).flatMap(item => item.errors);
  const tools = normalized.filter(item => item.ok).map(item => item.tool);

  const excluded = [];
  const selected = [];

  for (const tool of tools) {
    const reason = (code, detail) => excluded.push({ toolId: tool.toolId, code, detail });
    const baseOk = tool.bases.length === 0 || tool.bases.includes(context.baseId);

    if (arm === 'baseline') {
      if (!baseOk) { reason('base-mismatch', `工具底座 ${tool.bases.join('、')} / 目标 ${context.baseId}`); continue; }
      selected.push({ toolId: tool.toolId, costClass: tool.costClass, capabilities: tool.capabilities, stats: null });
      continue;
    }

    if (!baseOk) { reason('base-mismatch', `工具底座 ${tool.bases.join('、')} / 目标 ${context.baseId}`); continue; }
    if (tool.engineVersions.length && !tool.engineVersions.includes(context.engineVersion)) {
      reason('engine-mismatch', `工具引擎 ${tool.engineVersions.join('、')} / 目标 ${context.engineVersion}`); continue;
    }
    if (tool.stateFormats.length && !tool.stateFormats.includes(context.stateFormat)) {
      reason('state-format-mismatch', `工具状态格式 ${tool.stateFormats.join('、')} / 目标 ${context.stateFormat}`); continue;
    }
    const missing = tool.requires.filter(capability => !available.has(capability));
    if (missing.length) { reason('missing-requirement', `缺少前置能力 ${missing.join('、')}`); continue; }

    const stats = memoryStats(memory, tool.toolId, context, tool.capabilities);
    if (stats.lastOutcome === 'failure') { reason('failed-before', `上一次在 ${context.baseId}@${context.baseVersion} 失败，且之后没有成功记录`); continue; }

    selected.push({ toolId: tool.toolId, costClass: tool.costClass, capabilities: tool.capabilities, stats });
  }

  const ordered = arm === 'baseline'
    ? [...selected].sort((a, b) => a.toolId.localeCompare(b.toolId))
    : [...selected].sort((a, b) => {
      const rateA = a.stats?.successRate ?? -1;
      const rateB = b.stats?.successRate ?? -1;
      if (rateA !== rateB) return rateB - rateA;
      if (a.costClass !== b.costClass) return a.costClass - b.costClass;
      return a.toolId.localeCompare(b.toolId);
    });

  const limited = arm === 'baseline' ? ordered : ordered.slice(0, Math.max(0, maxTools));

  return {
    format: STRATEGY_ARM_FORMAT,
    arm,
    taskId: task.taskId ?? null,
    context: { baseId: context.baseId ?? null, baseVersion: context.baseVersion ?? null, stateFormat: context.stateFormat ?? null, engineVersion: context.engineVersion ?? null },
    tools: limited.map(item => ({ toolId: item.toolId, costClass: item.costClass, capabilities: item.capabilities, stats: item.stats })),
    excluded,
    invalid,
    summary: `${arm} 选中 ${limited.length} 个工具，排除 ${excluded.length} 个，无效目录项 ${invalid.length} 个`,
  };
}

/** Run both arms on the same inputs; the only difference is the arm id. */
export function compareArms(input) {
  return {
    format: 'craftmine.godot-strategy-arms/1',
    taskId: input?.task?.taskId ?? null,
    baseline: selectTools({ ...input, arm: 'baseline' }),
    candidate: selectTools({ ...input, arm: 'candidate' }),
  };
}
