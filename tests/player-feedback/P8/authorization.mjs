import path from 'node:path';

// This is the dated acceptance authorization, not a product/provider setting.
// Preserve the initial 16 and phase-two 34 immutable admissions separately.
export function p8Authorization(env, root) {
  const phase = env.CRAFTMINE_P8_AUTHORIZATION_PHASE;
  if (phase === undefined) return { phase: 'initial-16', requestLimit: 16, previousPhaseAdmissions: 0, journalPath: path.join(root, 'test-results/p8-authorized-20260910.ndjson') };
  if (phase !== 'unlimited-20260910') throw Error('P8_UNKNOWN_AUTHORIZATION_PHASE');
  if (!path.isAbsolute(root) || path.dirname(root) === root) throw Error('P8_SOURCE_ROOT_REQUIRED');
  return { phase, requestLimit: null, previousPhaseAdmissions: 50, journalPath: path.join(path.dirname(root), 'p8-unlimited-20260910.ndjson') };
}
