// Compatibility gate for L3 part packages.
//
// The gate is deliberately narrow: engine version, host ABI version, base id,
// base version range and state format must all match exactly. A part that was
// never validated against the running engine/base must be refused, not "tried
// and hopefully it works". Native parts additionally need an external
// validation record produced by the sandbox/executor/performance owners
// (tasks B/C/K); this module cannot create that record itself.
import { PART_COMPAT_FORMAT, PART_KINDS, satisfiesSemver, isPlain } from './formats.mjs';
import { requiresNativeValidation, licenseReady } from './manifest.mjs';
import { resolveContentRef } from './content-ref.mjs';

function check(name, ok, detail) {
  return { name, passed: Boolean(ok), detail };
}

/**
 * @param {object} manifest  validated manifest (see manifest.mjs)
 * @param {object} target    { baseId, baseVersion, stateFormat, engineVersion, apiVersion? }
 * @param {object} options   { nativeValidation, resolveContent, requireLicense }
 */
export function checkPartCompatibility(manifest, target, { nativeValidation = null, resolveContent = null, requireLicense = false } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(check(name, ok, detail));

  add('清单已校验', isPlain(manifest) && manifest.format === 'craftmine.godot-part-manifest/1', '清单格式正确');
  add('部件类型受支持', PART_KINDS.includes(manifest?.partKind), `partKind=${manifest?.partKind}`);

  const engineOk = isPlain(target) && target.engineVersion === manifest?.engine?.version;
  add('引擎版本一致', engineOk, `部件要求 ${manifest?.engine?.version}，目标 ${target?.engineVersion}`);

  const apiOk = target?.apiVersion === undefined || target.apiVersion === manifest?.apiVersion;
  add('宿主 ABI 版本一致', apiOk, `部件要求 ${manifest?.apiVersion}，目标 ${target?.apiVersion ?? '未声明'}`);

  const bases = Array.isArray(manifest?.compatibleBases) ? manifest.compatibleBases : [];
  const baseEntry = bases.find(item => item.baseId === target?.baseId) || null;
  add('底座已声明', Boolean(baseEntry), baseEntry ? `声明支持 ${baseEntry.baseId}` : `部件没有声明支持底座 ${target?.baseId}`);

  const versionOk = Boolean(baseEntry) && satisfiesSemver(target?.baseVersion, baseEntry.baseVersion);
  add('底座版本落在范围内', versionOk, baseEntry ? `范围 ${baseEntry.baseVersion}，目标 ${target?.baseVersion}` : '无底座声明');

  const stateOk = Boolean(baseEntry) && baseEntry.stateFormat === target?.stateFormat;
  add('状态格式一致', stateOk, baseEntry ? `部件要求 ${baseEntry.stateFormat}，目标 ${target?.stateFormat}` : '无底座声明');

  if (requiresNativeValidation(manifest)) {
    const record = isPlain(nativeValidation) && typeof nativeValidation.by === 'string' && nativeValidation.by.trim().length > 0
      && typeof nativeValidation.at === 'string' && nativeValidation.at.trim().length > 0
      && typeof nativeValidation.harness === 'string' && nativeValidation.harness.trim().length > 0;
    add('原生专项验证记录', record, record
      ? `${nativeValidation.by} 于 ${nativeValidation.at} 通过 ${nativeValidation.harness}`
      : '原生部件必须由 B/C/K 的专项验证签名后才能装载');
  }

  const contentResults = (manifest?.contentRefs || []).map(ref => resolveContentRef(ref, resolveContent));
  const contentOk = contentResults.every(result => result.ok);
  if (contentResults.length) {
    add('内容引用可解析', contentOk, contentOk
      ? `${contentResults.length} 条内容引用均已按哈希确认`
      : contentResults.filter(result => !result.ok).map(result => result.detail).join('；'));
  }

  if (requireLicense) {
    const ok = licenseReady(manifest);
    add('许可可用于发行', ok, ok ? `SPDX ${manifest.license.spdx}` : `SPDX ${manifest?.license?.spdx} 未确认，发行包不得包含`);
  }

  const failed = checks.filter(item => !item.passed);
  return {
    format: PART_COMPAT_FORMAT,
    passed: failed.length === 0,
    checks,
    contentResults,
    summary: failed.length
      ? `不兼容：${failed.map(item => `${item.name}（${item.detail}）`).join('；')}`
      : `${checks.length} 项兼容检查全部通过`,
  };
}

export function assertCompatible(manifest, target, options) {
  const report = checkPartCompatibility(manifest, target, options);
  if (!report.passed) throw new Error(report.summary);
  return report;
}
