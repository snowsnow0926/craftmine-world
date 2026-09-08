// 上下文预算（P4）：先算清楚窗口能装多少，再决定「去重 / 压缩 / 分块」。
// 所有 token 数字都区分 estimated 与 reported：没有分词器就不假装精确。
export const BUDGET_FORMAT = 'craftmine.context-budget/1';
export const BUDGET_DEFAULTS = Object.freeze({ soft: 0.7, compact: 0.9, target: 0.5, shares: Object.freeze({ rules: 0.2, scene: 0.35, task: 0.15, history: 0.3 }) });

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw Error(message); };
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

// 保守估算：中日韩字符按 1 token、其余按 4 字符 1 token，宁可高估不低估。
export function estimateTokens(value) {
  const text = String(value ?? '');
  let cjk = 0;
  for (const character of text) if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(character)) cjk += 1;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

export function contextBudget({ window: windowTokens, reserveOutput = 6000, reserveTools = 6000, reserveSlack = 4000, cap = null } = {}) {
  need(positive(windowTokens), '上下文窗口必须是正数');
  for (const [name, value] of [['reserveOutput', reserveOutput], ['reserveTools', reserveTools], ['reserveSlack', reserveSlack]])
    need(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${name} 必须是非负数`);
  const usable = windowTokens - reserveOutput - reserveTools - reserveSlack;
  need(usable > 0, '预留之后没有可用输入空间：请缩小预留或换更大的窗口');
  const available = cap === null ? usable : Math.min(usable, cap);
  return {
    format: BUDGET_FORMAT,
    window: windowTokens, reserves: { output: reserveOutput, tools: reserveTools, slack: reserveSlack },
    available, capped: cap !== null && cap < usable,
    softAt: Math.floor(available * BUDGET_DEFAULTS.soft),
    compactAt: Math.floor(available * BUDGET_DEFAULTS.compact),
    targetAt: Math.floor(available * BUDGET_DEFAULTS.target),
  };
}

// 分配：先满足必保留段，再按份额给可选段；份额不够时允许挪用其他段的余量。
export function allocate({ budget, segments = [] } = {}) {
  need(budget && positive(budget.available), '分配需要一份预算');
  need(Array.isArray(segments), '分配需要 segments 数组');
  const measured = segments.map(segment => ({
    ...segment,
    tokens: Number.isFinite(segment.tokens) ? segment.tokens : estimateTokens(segment.text),
    share: segment.share || 'task',
  }));
  need(measured.every(segment => BUDGET_DEFAULTS.shares[segment.share] !== undefined), `段落份额无效：${measured.map(segment => segment.share).join('、')}`);
  const mandatory = measured.filter(segment => segment.mandatory);
  const optional = measured.filter(segment => !segment.mandatory);
  const mandatoryTokens = mandatory.reduce((total, segment) => total + segment.tokens, 0);
  if (mandatoryTokens > budget.available) {
    return {
      format: BUDGET_FORMAT, withinBudget: false, action: 'split',
      allowances: mandatory.map(segment => ({ id: segment.id, tokens: segment.tokens, allowed: segment.tokens })),
      dropped: optional.map(segment => segment.id), mandatoryTokens, available: budget.available,
      detail: `必保留内容 ${mandatoryTokens} 超过可用输入 ${budget.available}：必须分块或外置，不能硬塞`,
    };
  }
  const allowances = mandatory.map(segment => ({ id: segment.id, tokens: segment.tokens, allowed: segment.tokens, share: segment.share }));
  let left = budget.available - mandatoryTokens;
  const byShare = {};
  for (const segment of optional) (byShare[segment.share] ||= []).push(segment);
  const dropped = [], truncated = [];
  for (const [share, list] of Object.entries(byShare)) {
    let quota = Math.floor(budget.available * BUDGET_DEFAULTS.shares[share]);
    for (const segment of list) {
      const allowed = Math.max(0, Math.min(segment.tokens, quota, left));
      if (allowed > 0) {
        allowances.push({ id: segment.id, tokens: segment.tokens, allowed, share });
        if (allowed < segment.tokens) truncated.push(segment.id);
        quota -= allowed; left -= allowed;
      } else dropped.push(segment.id);
    }
  }
  const total = allowances.reduce((sum, entry) => sum + entry.allowed, 0);
  const withinBudget = dropped.length === 0 && truncated.length === 0;
  return {
    format: BUDGET_FORMAT, withinBudget, action: withinBudget ? 'none' : 'dedupe',
    allowances, dropped, truncated, mandatoryTokens, available: budget.available,
    detail: withinBudget ? '全部内容都在预算内' : `空间不够，先按份额去重/外置：${[...dropped, ...truncated].join('、')}`,
  };
}

export function measure({ budget, segments = [], reported = null } = {}) {
  const estimated = segments.reduce((total, segment) => total + (Number.isFinite(segment.tokens) ? segment.tokens : estimateTokens(segment.text)), 0);
  const real = Number.isFinite(reported) ? reported : null;
  const used = real ?? estimated;
  const action = used > budget.compactAt ? 'compact' : used > budget.softAt ? 'dedupe' : 'none';
  return {
    format: BUDGET_FORMAT,
    estimated, reported: real, used, source: real === null ? 'estimated' : 'reported',
    budget, action,
    detail: action === 'none' ? '在软阈值内' : action === 'dedupe' ? `已到软阈值 ${budget.softAt}：先做 L0 去重与外置` : `已到压缩阈值 ${budget.compactAt}：在安全边界做 L1/L2 并重建`,
  };
}

export function budgetText(report) {
  return `输入估算 ${report.estimated} token${report.reported === null ? '（估算，未回报）' : `，后端回报 ${report.reported}`}；可用 ${report.budget.available}；软阈值 ${report.budget.softAt}；压缩阈值 ${report.budget.compactAt}；动作 ${report.action}。`;
}
