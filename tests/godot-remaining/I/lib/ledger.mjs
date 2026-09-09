// Ledger for A01–A17, V01–V16 and AL-A01–AL-A17.
//
// The frozen ledgers own the item list and the mapping to frozen rounds.
// Status is derived, never hand-written: a story can only read 已证实 when every
// linked round passed with complete evidence. One hard failure cannot be
// cancelled by other passes, and a blocked dependency stays 尚未执行.
export const LEDGER_FORMAT = 'craftmine.i.ledger-state/1';

export const STATUS = Object.freeze({
  VERIFIED: '已证实',
  FAILED: '失败',
  NOT_RUN: '尚未执行',
  INSUFFICIENT: '证据不足',
});

export function initialState(ledgers, { startedAt = new Date().toISOString() } = {}) {
  const items = {};
  for (const [group, ledger] of Object.entries(ledgers)) {
    for (const item of ledger.items) items[item.id] = { group, id: item.id, title: item.title, status: STATUS.NOT_RUN, rounds: item.rounds ?? [], reasons: item.blockedReason ? [item.blockedReason] : [], history: [] };
  }
  return { format: LEDGER_FORMAT, startedAt, items };
}

export function applyRound(state, { roundId, categoryId, verdict, evidenceDir = null, reasons = [], failures = [], stories = [], identity = null }) {
  for (const storyId of stories) {
    const item = state.items[storyId];
    if (!item) continue;
    item.history.push({ at: new Date().toISOString(), roundId, categoryId, verdict, evidenceDir, reasons, failures: failures.map(failure => failure.class ?? 'unknown') });
  }
  return state;
}

// A round verdict is one of: passed | failed | insufficient | not-run | blocked.
// `requireLive` is the guard against turning replay/audit evidence into a pass:
// only rounds actually executed against the real product model can verify a story.
export function deriveStatus(item, { roundsById, hardFailures = [], requireLive = true }) {
  const linked = item.rounds.map(roundId => roundsById.get(roundId));
  const verdicts = linked.map(round => round?.verdict ?? 'not-run');
  if (verdicts.some(verdict => verdict === 'failed')) return { status: STATUS.FAILED, reason: '至少一轮硬断言失败' };
  if (verdicts.some(verdict => verdict === 'insufficient')) return { status: STATUS.INSUFFICIENT, reason: '存在证据不足的轮次' };
  if (hardFailures.length) return { status: STATUS.FAILED, reason: `硬失败：${hardFailures.map(f => f.class ?? f).join(', ')}` };
  if (verdicts.length && verdicts.every(verdict => verdict === 'passed')) {
    const nonLive = linked.filter(round => round?.mode && round.mode !== 'live');
    if (requireLive && nonLive.length) return { status: STATUS.NOT_RUN, reason: `仅有 ${[...new Set(nonLive.map(round => round.mode))].join('/')} 证据，真实模型尚未执行` };
    return { status: STATUS.VERIFIED, reason: '全部关联轮次通过且证据完整' };
  }
  if (verdicts.some(verdict => verdict === 'blocked')) return { status: STATUS.NOT_RUN, reason: '依赖产品接口未接通' };
  return { status: STATUS.NOT_RUN, reason: '尚未执行' };
}

export function refresh(state, { rounds, ledgers, requireLive = true }) {
  const roundsById = new Map(rounds.map(round => [round.id, round]));
  for (const [group, ledger] of Object.entries(ledgers)) {
    for (const frozen of ledger.items) {
      const item = state.items[frozen.id];
      if (!item) continue;
      const linked = frozen.rounds ?? [];
      const hardFailures = linked.flatMap(roundId => roundsById.get(roundId)?.failures ?? []).filter(failure => failure.class && failure.class !== 'human-intervention');
      const derived = deriveStatus({ ...item, rounds: linked }, { roundsById, hardFailures, requireLive });
      item.status = derived.status;
      item.reason = derived.reason;
      item.group = group;
      item.rounds = linked;
    }
  }
  return state;
}

export function ledgerRows(state) {
  return Object.values(state.items).sort((a, b) => a.id.localeCompare(b.id));
}

export function ledgerMarkdown(state, { title = '验收台账' } = {}) {
  const rows = ledgerRows(state);
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
  const lines = [`## ${title}`, '', `- 已证实：${counts[STATUS.VERIFIED] ?? 0}`, `- 失败：${counts[STATUS.FAILED] ?? 0}`, `- 尚未执行：${counts[STATUS.NOT_RUN] ?? 0}`, `- 证据不足：${counts[STATUS.INSUFFICIENT] ?? 0}`, '', '| 编号 | 状态 | 关联轮次 | 原因 |', '| --- | --- | --- | --- |'];
  for (const row of rows) lines.push(`| ${row.id} | ${row.status} | ${(row.rounds ?? []).join(' ') || '—'} | ${row.reason ?? ''} |`);
  return `${lines.join('\n')}\n`;
}
