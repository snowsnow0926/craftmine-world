import { resolveLedger } from './ledger.mjs';

// This is the dated acceptance authorization, not a product/provider setting.
// Preserve the initial 16 and phase-two 34 immutable admissions separately.

export const P8_CASE_IDS = Object.freeze(['hammer', 'dog']);
export const CASE_ENV_SINGULAR = 'CRAFTMINE_P8_CASE';
export const CASE_ENV_LIST = 'CRAFTMINE_P8_CASES';

function parseSingle(value) {
  if (typeof value !== 'string' || !P8_CASE_IDS.includes(value.trim()) || value.trim() !== value) throw Error('P8_INVALID_CASE_SELECTION');
  return value;
}
function parseList(value) {
  if (typeof value !== 'string') throw Error('P8_INVALID_CASE_SELECTION');
  const parts = value.split(',').map(entry => entry.trim());
  // An empty segment is refused rather than silently dropping a case: a mistyped
  // pair must never become a single-case run that looks deliberate.
  if (!parts.length || parts.some(entry => !entry) || parts.some(entry => !P8_CASE_IDS.includes(entry)) || new Set(parts).size !== parts.length) throw Error('P8_INVALID_CASE_SELECTION');
  return parts;
}

/** Read `--case <id>` out of this driver's own argv. The generic parameter
 * parser is never extended: the driver removes its own flag before handing the
 * rest on, so an unknown-argument failure stays meaningful. */
export function stripCaseArgument(argv) {
  const rest = [];
  let found;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--case' || token.startsWith('--case=')) {
      const value = token === '--case' ? argv[++index] : token.slice('--case='.length);
      if (found !== undefined) throw Error('P8_AMBIGUOUS_CASE_SELECTION:--case');
      if (value === undefined || value === '' || value.startsWith('--')) throw Error('P8_INVALID_CASE_SELECTION:--case');
      found = value;
      continue;
    }
    rest.push(token);
  }
  return { argv: rest, value: found };
}

/** Which cases this process runs. A single-case run is a first-class, explicit
 * request so two agents can own one case each, and so its own result can never
 * be read as "both cases passed". At most one selection mechanism may be used. */
export function p8CaseSelection({ argv = [], env = {} } = {}) {
  const { value: fromArgv } = stripCaseArgument(argv);
  const configured = [['--case', fromArgv], [CASE_ENV_SINGULAR, env[CASE_ENV_SINGULAR]], [CASE_ENV_LIST, env[CASE_ENV_LIST]]].filter(([, value]) => value !== undefined);
  if (configured.length > 1) throw Error('P8_AMBIGUOUS_CASE_SELECTION:' + configured.map(([source]) => source).join('+'));
  if (!configured.length) return { cases: [...P8_CASE_IDS], source: 'default' };
  const [source, value] = configured[0];
  if (source === CASE_ENV_LIST) return { cases: parseList(value), source };
  return { cases: [parseSingle(value)], source };
}

/** Environment-only convenience kept for callers that never pass argv. */
export function p8Cases(env = {}) {
  return p8CaseSelection({ env }).cases;
}

/** Authorization + journal identity for one run. `options.out` is this run's own
 * output directory and is required by the parallel phase, which never shares a
 * journal with another concurrent run. */
export function p8Authorization(env, root, options = {}) {
  const ledger = resolveLedger({ env: env ?? {}, root, out: options.out });
  const selection = p8CaseSelection({ argv: options.argv ?? [], env: env ?? {} });
  return {
    phase: ledger.phase,
    requestLimit: ledger.requestLimit,
    previousPhaseAdmissions: ledger.previousPhaseAdmissions,
    declaredEarlierPhases: ledger.declaredEarlierPhases,
    phaseOneAdmissions: ledger.phaseOneAdmissions,
    journalPath: ledger.journalPath,
    mode: ledger.mode,
    historical: ledger.historical,
    historicalTotal: ledger.historicalTotal,
    ownership: ledger.ownership,
    cases: selection.cases,
    caseSelection: selection,
  };
}
