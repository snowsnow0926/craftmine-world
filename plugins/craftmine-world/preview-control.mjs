// Only the retained product view owns candidate transactions. The main-window
// overlay carries this exact, short-lived identity back rather than applying a
// candidate ID against whatever world happens to be active later.
export function assertPreviewControl(request, state) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('INVALID_PREVIEW_CONTROL');
  if (request.action === 'state' && Object.keys(request).length === 1) return;
  if (!['apply', 'close'].includes(request.action) || Object.keys(request).sort().join(',') !== 'action,buildId,candidateId,previewId,worldId') throw Error('INVALID_PREVIEW_CONTROL');
  if (!state || !['worldId', 'candidateId', 'buildId', 'previewId'].every(key => typeof request[key] === 'string' && request[key] === state[key])) throw Error('PREVIEW_CHANGED');
  if (request.action === 'apply' ? state.applyDisabled : state.closeDisabled) throw Error('PREVIEW_BUSY');
}
