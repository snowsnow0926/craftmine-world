// Coverage and integrity checks over the frozen acceptance set.
// These run before any round: a set that silently lost a story, an assertion or
// a second round must fail loudly instead of reporting a smaller denominator.
import { indexAssertions, roundsOf } from './frozen.mjs';
import { OP_NAMES, SET_OPS, ASSERTION_KINDS } from './assert-dsl.mjs';

export const COVERAGE_FORMAT = 'craftmine.i.coverage/1';

export const REQUIRED_CATEGORIES = 10;
export const REQUIRED_ROUNDS_PER_CATEGORY = 2;

function checkCheck(check, problems, assertionId) {
  if (!check || typeof check !== 'object') { problems.push(`${assertionId}: check is not an object`); return; }
  if (Array.isArray(check.all) || Array.isArray(check.any) || Array.isArray(check.none)) {
    const list = check.all ?? check.any ?? check.none;
    if (!list.length) problems.push(`${assertionId}: empty composite check`);
    list.forEach(child => checkCheck(child, problems, assertionId));
    return;
  }
  if (check.not) { checkCheck(check.not, problems, assertionId); return; }
  if (check.check) {
    if (!SET_OPS.includes(check.op)) problems.push(`${assertionId}: set op must be one of ${SET_OPS.join('/')}, got ${JSON.stringify(check.op)}`);
    checkCheck(check.check, problems, assertionId);
    return;
  }
  if (!OP_NAMES.includes(check.op)) problems.push(`${assertionId}: unknown op ${JSON.stringify(check.op)}`);
  if (typeof check.path !== 'string' || check.path.length === 0) problems.push(`${assertionId}: missing path`);
}

export function checkCoverage({ set, assertions, ledgers, scoring }) {
  const problems = [];
  const rounds = roundsOf(set);
  const byId = indexAssertions(assertions);

  if (set.categories.length < REQUIRED_CATEGORIES) problems.push(`only ${set.categories.length} requirement categories, need at least ${REQUIRED_CATEGORIES}`);
  for (const category of set.categories) {
    if (category.rounds.length < REQUIRED_ROUNDS_PER_CATEGORY) problems.push(`${category.id}: ${category.rounds.length} rounds, need at least ${REQUIRED_ROUNDS_PER_CATEGORY}`);
    if (!category.stories?.length && !category.extraRequirements?.length) problems.push(`${category.id}: no story mapping and no extra requirement`);
    for (const round of category.rounds) {
      if (!round.prompt || round.prompt.length < 40) problems.push(`${round.id}: prompt missing or too short to be a real request`);
      if (!round.mustObserve?.length) problems.push(`${round.id}: no mustObserve list`);
      if (!round.assertions?.length) problems.push(`${round.id}: no assertions`);
      for (const id of round.assertions ?? []) {
        const assertion = byId.get(id);
        if (!assertion) { problems.push(`${round.id}: unknown assertion ${id}`); continue; }
        if (assertion.round !== round.id) problems.push(`${assertion.id}: round mismatch (${assertion.round} vs ${round.id})`);
        if (!ASSERTION_KINDS.includes(assertion.kind ?? 'machine')) problems.push(`${assertion.id}: unknown kind ${JSON.stringify(assertion.kind)}`);
        if ((assertion.kind ?? 'machine') === 'machine') checkCheck(assertion.check, problems, assertion.id);
        if (assertion.source && !assertion.source.length) problems.push(`${assertion.id}: empty source`);
      }
    }
  }

  // Reverse check: an assertion belonging to a round must be listed by that
  // round, otherwise it silently stops participating in the verdict.
  for (const assertion of assertions.assertions) {
    const round = rounds.find(item => item.id === assertion.round);
    if (!round) { problems.push(`orphan assertion ${assertion.id} (round ${assertion.round})`); continue; }
    if (!(round.assertions ?? []).includes(assertion.id)) problems.push(`${assertion.id}: not listed by its round ${assertion.round}`);
  }

  // Every Godot story A01–A17 must be covered by at least one round.
  const coveredStories = new Set(set.categories.flatMap(category => category.stories ?? []));
  for (const item of ledgers.godot.items) {
    if (!item.rounds?.length) problems.push(`${item.id}: not linked to any round`);
    if (!coveredStories.has(item.id)) problems.push(`${item.id}: not covered by any category`);
  }
  for (const group of ['version', 'assets']) {
    for (const item of ledgers[group].items) {
      if (!item.rounds?.length) problems.push(`${item.id}: not linked to any round (${group})`);
    }
  }

  // The hard conditions of the plan must stay hard in the scoring file.
  const hard = scoring.hardConditions ?? [];
  for (const required of ['数据正确性', '需求必需断言', '隔离', '应用事务']) {
    if (!hard.some(condition => String(condition).includes(required))) problems.push(`scoring.hardConditions lost ${required}`);
  }
  if (!(scoring.metrics ?? []).some(metric => String(metric.sampling ?? '').includes('两轮'))) problems.push('scoring.metrics lost the two-round sampling rule');
  if (!(scoring.noNormalization ?? []).length) problems.push('scoring.noNormalization is empty');

  return { format: COVERAGE_FORMAT, ok: problems.length === 0, problems, categories: set.categories.length, rounds: rounds.length, assertions: assertions.assertions.length, stories: { godot: ledgers.godot.items.length, version: ledgers.version.items.length, assets: ledgers.assets.items.length } };
}
