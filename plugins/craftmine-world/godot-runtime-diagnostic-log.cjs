'use strict';

// This is an untrusted, bounded log, never an additional acceptance assertion.
const MAX_BYTES = 65536;
function diagnosticLog(evidence, claim) {
  if (!evidence || evidence.format !== 'craftmine.godot-runtime-check/1' || evidence.scope !== 'base-startup' ||
      !['jobId','worldId','buildId','inputHash'].every(key => typeof claim?.[key] === 'string' && evidence[key] === claim[key])) return undefined;
  let truncated = false;
  const text = value => {
    if (typeof value !== 'string') return null;
    if (value.length > 1024) truncated = true;
    return value.slice(0,1024)
      .replace(/\bBearer\s+[^\s"']+/gi,'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]+/g,'[redacted]')
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[=:]\s*["']?)[^\s"'&,}]+/gi,'$1[redacted]')
      .replace(/(?:file:\/\/\/)?\b[A-Za-z]:[\\/][^\r\n"'<>]*?(?=:\s|["'\r\n<>]|$)/g,'[local-path]')
      .replace(/\/(?:Users|home|private|tmp)\/[^\s"'<>]+/g,'[local-path]')
      .replace(/https?:\/\/[^\s"'<>]+/g, value => { try { const url = new URL(value); return `${url.protocol}//${url.host}/[runtime-url]`; } catch { return '[url]'; } });
  };
  const list = (values, limit) => {
    if (!Array.isArray(values)) return [];
    if (values.length > limit) truncated = true;
    return values.slice(0,limit).filter(value => typeof value === 'string').map(text);
  };
  const flag = value => typeof value === 'boolean' ? value : null;
  const observations = Array.isArray(evidence.diagnostics) ? evidence.diagnostics : [];
  const phase = value => typeof value === 'string' && value.startsWith('[phase] ');
  const report = {
    format:'craftmine.godot-runtime-diagnostic/1', diagnosticOnly:true,
    jobId:claim.jobId, worldId:claim.worldId, buildId:claim.buildId, inputHash:claim.inputHash,
    error:text(evidence.error),
    ready:{ok:flag(evidence.ready?.ok),instanceId:text(evidence.ready?.instanceId)},
    isolation:{offscreen:flag(evidence.isolation?.offscreen),focusable:flag(evidence.isolation?.focusable),visible:flag(evidence.isolation?.visible)},
    errors:{runtime:list(evidence.errors?.runtime,16),console:list(evidence.errors?.console,16),renderer:text(evidence.errors?.renderer)},
    diagnostics:list([...observations.filter(phase),...observations.filter(value=>!phase(value))],64),truncated:false,
  };
  // Keep the first cause and first stage observations; discard the newest tail
  // when UTF-8 expansion reaches the total bound.
  while (Buffer.byteLength(JSON.stringify({...report,truncated}), 'utf8') > MAX_BYTES) {
    truncated = true;
    const field = [report.diagnostics, report.errors.console, report.errors.runtime].find(values => values.length);
    if (!field) return undefined;
    field.pop();
  }
  report.truncated = truncated;
  return JSON.stringify(report);
}
module.exports = {diagnosticLog, MAX_BYTES};
