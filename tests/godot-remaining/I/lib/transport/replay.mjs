// Replay transport for task I.
//
// Replay exists to prove the runner, the frozen assertions and the evidence
// pipeline work — not to prove the model works. Every replay round is reported
// with mode=replay, and a replay fixture can never satisfy a human-review
// assertion, so 人工手感 stays unverified by construction.
import fs from 'node:fs';
import path from 'node:path';

export const REPLAY_FORMAT = 'craftmine.i.replay-fixture/1';

export function loadFixture(fixturesDir, roundId) {
  const file = path.join(fixturesDir, `${roundId}.json`);
  if (!fs.existsSync(file)) return null;
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fixture.format !== REPLAY_FORMAT) throw new Error(`${file}: unexpected format ${fixture.format}`);
  if (fixture.roundId !== roundId) throw new Error(`${file}: roundId ${fixture.roundId} does not match ${roundId}`);
  return { file, ...fixture };
}

export function replayRound(fixture) {
  if (!fixture) return { observation: null, usage: null, failures: [], note: 'no replay fixture for this round' };
  return {
    observation: fixture.observation ?? null,
    usage: fixture.observation?.usage ?? null,
    failures: fixture.failures ?? [],
    interventions: fixture.humanInterventions ?? [],
    note: fixture.note ?? null,
  };
}

export function listFixtures(fixturesDir) {
  if (!fs.existsSync(fixturesDir)) return [];
  return fs.readdirSync(fixturesDir).filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, '')).sort();
}
