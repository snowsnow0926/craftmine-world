/** Fixed read tool probe, reachable only through the protected parent controller. */
export function validatePerformanceAcceptance(request: Record<string, unknown>, enabled: boolean) {
  if (!enabled || Object.keys(request).sort().join(',') !== 'id,method,payload,type' ||
    request.type !== 'craftmine-headless' || request.method !== 'godotPerformanceTool')
    throw Error('HEADLESS_PERFORMANCE_CONTROLLER_REQUIRED');
  const payload = request.payload as Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    Object.keys(payload).sort().join(',') !== 'sessionId,worldId' ||
    !['sessionId','worldId'].every(key => typeof payload[key] === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(payload[key] as string)))
    throw Error('HEADLESS_PERFORMANCE_IDENTITY_REQUIRED');
  return payload as {sessionId: string; worldId: string};
}
