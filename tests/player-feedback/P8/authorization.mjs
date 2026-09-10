import { resolveLedger } from './ledger.mjs';

// This is the dated acceptance authorization, not a product/provider setting.
// Preserve the initial 16 and phase-two 34 immutable admissions separately.

export const P8_CASE_IDS = Object.freeze(['hammer', 'dog']);

/** Which cases this process runs. A single-case run is a first-class, explicit
 * request so two agents can own one case each, and so its own result can never
 * be read as "both cases passed". */
export function p8Cases(env = {}) {
  const requested = env.CRAFTMINE_P8_CASES;
  if (requested === undefined) return [...P8_CASE_IDS];
  if (typeof requested !== 'string') throw Error('P8_INVALID_CASE_SELECTION');
  const parts = requested.split(',').map(value => value.trim());
  // An empty segment is refused rather than silently dropping a case: a mistyped
  // pair must never become a single-case run that looks deliberate.
  if (!parts.length || parts.some(value => !value) || parts.some(value => !P8_CASE_IDS.includes(value)) || new Set(parts).size !== parts.length) throw Error('P8_INVALID_CASE_SELECTION');
  return parts;
}
/** Authorization + ledger identity for one run. `options.out` is this run's own
 * output directory and is required by the parallel phase, which never shares a
 * ledger with another concurrent run. */
export function p8Authorization(env, root, options = {}) {
  const ledger = resolveLedger({ env: env ?? {}, root, out: options.out });
  return {
    phase: ledger.phase,
    requestLimit: ledger.requestLimit,
    previousPhaseAdmissions: ledger.previousPhaseAdmissions,
    declaredEarlierPhases: ledger.declaredEarlierPhases,
    journalPath: ledger.journalPath,
    mode: ledger.mode,
    historical: ledger.historical,
    historicalTotal: ledger.historicalTotal,
    ownership: ledger.ownership,
    cases: p8Cases(env ?? {}),
  };
}
