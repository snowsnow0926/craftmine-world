// 类型化记忆（P3）：把「记住一件事」拆成「有来源、有范围、有版本、能失效」的结构化记录。
// 一条经验如果说不出来源和适用范围，就不许进库；凭据和聊天原文永远不进库。
export const MEMORY_FORMAT = 'craftmine.memory/1';
export const MEMORY_KINDS = Object.freeze(['project-rule', 'verified-experience', 'task-history', 'workflow']);
export const MEMORY_STATUS = Object.freeze(['proposed', 'validated', 'needs_revalidation', 'retired']);
export const MEMORY_LIMITS = Object.freeze({ claim: 400, sourceRefs: 8, supersedes: 8, tags: 12 });

const ID_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]{0,47}$/;
const REF_PATTERN = /^[a-z][a-z0-9-]*:[^\s]{1,120}$/;
const SECRET_PATTERN = /(api[\s_-]?key|secret|password|passwd|token|credential)/i;
const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw Error(message); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function memoryRecord(input) {
  need(isPlain(input), '记忆记录必须是对象');
  const extra = Object.keys(input).filter(key => !['id', 'kind', 'scope', 'claim', 'status', 'sourceRefs', 'appliesTo', 'supersedes', 'supersededBy', 'tags', 'createdAt', 'lastVerifiedAt', 'retiredReason'].includes(key));
  need(!extra.length, `记忆记录包含不支持的字段：${extra.join('、')}`);
  need(ID_PATTERN.test(input.id || ''), '记忆 ID 无效，需要「类型:短名」的形式');
  need(MEMORY_KINDS.includes(input.kind), `记忆类型无效：${input.kind}；可用：${MEMORY_KINDS.join('、')}`);
  need(text(input.claim, MEMORY_LIMITS.claim), '记忆内容无效或过长');
  need(!SECRET_PATTERN.test(input.claim), '凭据不能写进记忆：请只记录做法，不记录密钥');
  need(isPlain(input.scope) && typeof input.scope.projectId === 'string' && input.scope.projectId.length > 0, '记忆必须声明作用项目');
  need(input.scope.moduleId === undefined || typeof input.scope.moduleId === 'string', '记忆的模块作用域无效');
  const status = input.status ?? 'proposed';
  need(MEMORY_STATUS.includes(status), `记忆状态无效：${status}`);
  need(Array.isArray(input.sourceRefs) && input.sourceRefs.length >= 1 && input.sourceRefs.length <= MEMORY_LIMITS.sourceRefs, '记忆必须至少有一个来源引用');
  for (const ref of input.sourceRefs) need(typeof ref === 'string' && REF_PATTERN.test(ref), `记忆来源引用无效：${ref}`);
  if (status === 'validated') {
    need(input.sourceRefs.some(ref => /^(task|evidence|user|test):/.test(ref)), '只有真实任务、证据、用户原话或测试才能把记忆标为 validated；猜测不算');
  }
  const appliesTo = input.appliesTo ?? {};
  need(isPlain(appliesTo), '记忆的适用范围无效');
  need(appliesTo.runtimeRange === undefined || typeof appliesTo.runtimeRange === 'string', '记忆的运行器范围无效');
  need(appliesTo.sourceHashes === undefined || (Array.isArray(appliesTo.sourceHashes) && appliesTo.sourceHashes.every(hash => typeof hash === 'string')), '记忆的源码哈希范围无效');
  const supersedes = input.supersedes ?? [];
  need(Array.isArray(supersedes) && supersedes.length <= MEMORY_LIMITS.supersedes, '记忆的替代关系无效');
  for (const id of supersedes) need(ID_PATTERN.test(id), `被替代的记忆 ID 无效：${id}`);
  const tags = input.tags ?? [];
  need(Array.isArray(tags) && tags.length <= MEMORY_LIMITS.tags && tags.every(tag => text(tag, 32)), '记忆标签无效');
  return {
    format: MEMORY_FORMAT,
    id: input.id, kind: input.kind,
    scope: { projectId: input.scope.projectId, ...(input.scope.moduleId ? { moduleId: input.scope.moduleId } : {}) },
    claim: input.claim.trim(), status,
    sourceRefs: [...input.sourceRefs],
    appliesTo: { ...appliesTo },
    supersedes: [...supersedes],
    ...(input.supersededBy ? { supersededBy: input.supersededBy } : {}),
    tags: [...tags],
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : null,
    lastVerifiedAt: Number.isFinite(input.lastVerifiedAt) ? input.lastVerifiedAt : null,
    ...(input.retiredReason ? { retiredReason: input.retiredReason } : {}),
  };
}

export function isActive(record) {
  return Boolean(record) && record.status !== 'retired' && !record.supersededBy;
}

export function supersede(previous, next) {
  const incoming = memoryRecord({ ...next, supersedes: [...new Set([...(next.supersedes || []), previous.id])] });
  return { next: incoming, previous: { ...previous, supersededBy: incoming.id } };
}

export function retire(record, { reason, at = null } = {}) {
  need(text(reason, 200), '停用记忆必须写明原因');
  return { ...record, status: 'retired', retiredReason: reason, lastVerifiedAt: at ?? record.lastVerifiedAt };
}

// 源码或运行器变了，旧经验就不能继续算「已验证」。
export function markStale(record, { sourceHashes = [], runtimeVersion = null } = {}) {
  const expected = record.appliesTo?.sourceHashes || [];
  const changed = expected.length > 0 && sourceHashes.length > 0 && !expected.some(hash => sourceHashes.includes(hash));
  const runtimeChanged = Boolean(record.appliesTo?.runtimeRange && runtimeVersion && !record.appliesTo.runtimeRange.includes(runtimeVersion));
  if (!changed && !runtimeChanged) return record;
  return { ...record, status: 'needs_revalidation' };
}

// 中文没有空格，按字切分才能召回；英文和数字按词切分。
const terms = value => [...new Set([...String(value || '').toLowerCase().matchAll(/[a-z0-9]+|[\u4e00-\u9fff]/g)]
  .map(match => match[0])
  .filter(term => term.length > 1 || /[\u4e00-\u9fff]/.test(term)))];

export function retrieve(records, { text: query = '', kind = null, projectId = null, moduleId = null, includeInactive = false, limit = 5 } = {}) {
  const wanted = new Set(terms(query));
  const scored = [];
  for (const record of records || []) {
    if (!includeInactive && !isActive(record)) continue;
    if (kind && record.kind !== kind) continue;
    if (projectId && record.scope?.projectId !== projectId) continue;
    if (moduleId && record.scope?.moduleId && record.scope.moduleId !== moduleId) continue;
    const haystack = new Set(terms([record.claim, ...(record.tags || [])].join(' ')));
    const hits = [...wanted].filter(term => haystack.has(term));
    const reasons = [];
    if (hits.length) reasons.push(`命中关键词：${hits.join('、')}`);
    if (record.status === 'validated') reasons.push('有已验证来源');
    if (record.kind === 'project-rule') reasons.push('用户明确约定');
    const score = hits.length * 2 + (record.status === 'validated' ? 1 : 0) + (record.kind === 'project-rule' ? 1 : 0);
    if (!wanted.size && !reasons.length) continue;
    if (wanted.size && hits.length === 0) continue;
    scored.push({ record, score, reasons, hit: hits.length });
  }
  scored.sort((a, b) => b.score - a.score || String(a.record.id).localeCompare(String(b.record.id)));
  return scored.slice(0, limit).map(entry => ({ ...entry.record, score: entry.score, reasons: entry.reasons }));
}
