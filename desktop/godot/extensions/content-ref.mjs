// Content references shared by L3 part manifests and L4 retrieval entries.
//
// Contract with the version-management (M) and asset-library (N) plans: a
// reference is usable only when it names a concrete content version AND a
// content hash that can be resolved right now. A "pointer only" reference (an
// id with no hash, or a hash the resolver cannot produce) is refused instead of
// silently retrieved, so a part or a strategy can never be built on content that
// only exists as a dangling pointer.
import { createHash } from 'node:crypto';
import { CONTENT_REF_FORMAT, need, isPlain, SHA256_PATTERN } from './formats.mjs';

export const CONTENT_REF_FIELDS = Object.freeze([
  'contentId', 'contentVersion', 'contentHash', 'baseId', 'baseVersion', 'stateFormat', 'engineVersion',
]);

export function hashContent(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Hashes are stored as bare lowercase hex, matching the rest of the repo
// (`{path, bytes, sha256}` file records, `app/harness/contracts.mjs`
// contentHash). A legacy "sha256:" prefix is accepted on input and normalised
// away so old records stay readable.
export function normalizeContentHash(value) {
  const text = String(value ?? '').trim();
  const hex = text.startsWith('sha256:') ? text.slice('sha256:'.length) : text;
  return SHA256_PATTERN.test(hex) ? hex : null;
}

export function validateContentRef(raw) {
  const errors = [];
  if (!isPlain(raw)) return { ok: false, errors: ['内容引用必须是对象'], ref: null };
  for (const field of ['contentId', 'contentVersion', 'baseId', 'baseVersion', 'stateFormat', 'engineVersion']) {
    const value = raw[field];
    if (typeof value !== 'string' || value.trim().length === 0) errors.push(`内容引用缺少 ${field}`);
  }
  if (typeof raw.contentId === 'string' && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw.contentId)) {
    errors.push(`内容引用 contentId 不合法：${raw.contentId}`);
  }
  const hash = normalizeContentHash(raw.contentHash);
  if (!hash) errors.push('内容引用缺少可校验的 contentHash（只存在指针的作品不能检索）');
  if (errors.length) return { ok: false, errors, ref: null };
  return {
    ok: true,
    errors,
    ref: {
      format: CONTENT_REF_FORMAT,
      contentId: raw.contentId,
      contentVersion: raw.contentVersion,
      contentHash: hash,
      baseId: raw.baseId,
      baseVersion: raw.baseVersion,
      stateFormat: raw.stateFormat,
      engineVersion: raw.engineVersion,
      assetId: typeof raw.assetId === 'string' ? raw.assetId : null,
      source: typeof raw.source === 'string' ? raw.source : null,
    },
  };
}

// `resolver(ref)` must return { found: boolean, bytes?: string|Buffer, hash?: string }.
// Anything the resolver cannot confirm is a refusal, never an optimistic pass.
export function resolveContentRef(ref, resolver) {
  const validation = validateContentRef(ref);
  if (!validation.ok) return { ok: false, reason: 'invalid-ref', detail: validation.errors.join('；') };
  if (typeof resolver !== 'function') {
    return { ok: false, reason: 'no-resolver', detail: '没有内容解析器，无法确认内容是否真的存在' };
  }
  let resolved;
  try {
    resolved = resolver(validation.ref);
  } catch (error) {
    return { ok: false, reason: 'resolver-error', detail: error.message };
  }
  if (!isPlain(resolved) || resolved.found !== true) {
    return { ok: false, reason: 'missing-content', detail: `内容 ${validation.ref.contentId}@${validation.ref.contentVersion} 在库中不存在` };
  }
  const actual = resolved.hash ? normalizeContentHash(resolved.hash)
    : resolved.bytes !== undefined ? hashContent(resolved.bytes)
      : null;
  if (!actual) return { ok: false, reason: 'unverifiable-content', detail: '解析器没有返回内容哈希，不能证明引用可用' };
  if (actual !== validation.ref.contentHash) {
    return { ok: false, reason: 'hash-mismatch', detail: `内容哈希不符：期望 ${validation.ref.contentHash}，实际 ${actual}` };
  }
  return { ok: true, reason: 'resolved', detail: `${validation.ref.contentId}@${validation.ref.contentVersion} 已按哈希确认`, ref: validation.ref };
}

export function needResolvableContentRef(ref, resolver) {
  const result = resolveContentRef(ref, resolver);
  need(result.ok, result.detail);
  return result.ref;
}
