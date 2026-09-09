// Base/version-keyed retrieval for L4 strategies.
//
// Two rules make this more than a tag search:
//   1. an entry that is not compatible with the running engine, base and state
//      format is excluded and the reason is reported — never silently returned;
//   2. an entry whose content hash cannot be resolved right now is excluded, so
//      a strategy cannot reuse "a work that only exists as a pointer".
//
// The index is data. It does not call a model, and it does not decide what to do
// with the results; the tool/context layer does that.
import { STRATEGY_ENTRY_FORMAT, ENTRY_KINDS, isPlain, need } from './formats.mjs';
import { validateContentRef, resolveContentRef } from '../extensions/content-ref.mjs';
import { satisfiesSemver, parseSemver } from '../extensions/formats.mjs';

function validateEntry(raw, index) {
  const errors = [];
  if (!isPlain(raw)) return { ok: false, errors: [`entry[${index}] 必须是对象`] };
  if (raw.format !== STRATEGY_ENTRY_FORMAT) errors.push(`entry[${index}].format 必须是 ${STRATEGY_ENTRY_FORMAT}`);
  if (typeof raw.entryId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw.entryId)) errors.push(`entry[${index}].entryId 不合法`);
  if (!ENTRY_KINDS.includes(raw.entryKind)) errors.push(`entry[${index}].entryKind 必须是 ${ENTRY_KINDS.join('、')}`);
  const ref = validateContentRef(raw.contentRef);
  if (!ref.ok) ref.errors.forEach(message => errors.push(`entry[${index}].contentRef：${message}`));
  if (raw.tags !== undefined && !Array.isArray(raw.tags)) errors.push(`entry[${index}].tags 必须是数组`);
  return errors.length ? { ok: false, errors } : { ok: true, errors, entry: { ...raw, contentRef: ref.ref, tags: Array.isArray(raw.tags) ? raw.tags : [] } };
}

function baseRangeFor(entryRef) {
  const parsed = parseSemver(entryRef.baseVersion);
  if (!parsed) return null;
  return `>=${entryRef.baseVersion} <${parsed.major + 1}.0.0`;
}

export function createRetrievalIndex({ entries = [], resolveContent = null } = {}) {
  const validated = [];
  const rejected = [];
  entries.forEach((raw, index) => {
    const result = validateEntry(raw, index);
    if (result.ok) validated.push(result.entry);
    else rejected.push({ entryId: raw?.entryId ?? null, errors: result.errors });
  });

  /**
   * @param {object} query { baseId, baseVersion, stateFormat, engineVersion, tags?, limit?, allowUnverified? }
   */
  function query({ baseId, baseVersion, stateFormat, engineVersion, tags = [], limit = 10, allowUnverified = false } = {}) {
    need(typeof baseId === 'string' && baseId.length > 0, '检索必须指定 baseId');
    need(typeof baseVersion === 'string' && baseVersion.length > 0, '检索必须指定 baseVersion');
    need(typeof stateFormat === 'string' && stateFormat.length > 0, '检索必须指定 stateFormat');
    need(typeof engineVersion === 'string' && engineVersion.length > 0, '检索必须指定 engineVersion');
    const wanted = new Set(tags);

    const excluded = [];
    const items = [];
    for (const entry of validated) {
      const ref = entry.contentRef;
      const reason = (code, detail) => excluded.push({ entryId: entry.entryId, code, detail });

      if (ref.engineVersion !== engineVersion) { reason('engine-mismatch', `条目 ${ref.engineVersion} / 目标 ${engineVersion}`); continue; }
      if (ref.baseId !== baseId) { reason('base-mismatch', `条目底座 ${ref.baseId} / 目标 ${baseId}`); continue; }
      if (ref.stateFormat !== stateFormat) { reason('state-format-mismatch', `条目状态格式 ${ref.stateFormat} / 目标 ${stateFormat}`); continue; }
      const range = baseRangeFor(ref);
      if (!range || !satisfiesSemver(baseVersion, range)) { reason('base-version-incompatible', `条目底座 ${ref.baseVersion} / 目标 ${baseVersion}`); continue; }
      if (wanted.size && !entry.tags.some(tag => wanted.has(tag))) { reason('tag-miss', `条目标签 ${entry.tags.join('、') || '无'}`); continue; }

      const resolution = resolveContentRef(ref, resolveContent);
      if (!resolution.ok) {
        if (allowUnverified && resolution.reason === 'no-resolver') {
          items.push({ ...entry, verified: false, verification: resolution.detail });
          continue;
        }
        reason('unresolved-content', resolution.detail);
        continue;
      }

      const overlap = entry.tags.filter(tag => wanted.has(tag)).length;
      const kindRank = entry.entryKind === 'experience' ? 0 : entry.entryKind === 'work' ? 1 : 2;
      items.push({ ...entry, verified: true, overlap, kindRank });
    }

    items.sort((a, b) => b.overlap - a.overlap || a.kindRank - b.kindRank || String(a.entryId).localeCompare(String(b.entryId)));
    return {
      format: 'craftmine.godot-strategy-retrieval/1',
      query: { baseId, baseVersion, stateFormat, engineVersion, tags: [...wanted] },
      items: items.slice(0, limit).map(item => ({
        entryId: item.entryId,
        entryKind: item.entryKind,
        contentRef: item.contentRef,
        summary: item.summary ?? '',
        tags: item.tags,
        outcome: item.outcome ?? null,
        verified: item.verified,
      })),
      excluded,
      invalid: rejected,
      summary: `命中 ${Math.min(items.length, limit)} 条，排除 ${excluded.length} 条，无效条目 ${rejected.length} 条`,
    };
  }

  return { entries: validated, invalid: rejected, query, size: validated.length };
}
