import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cityNavigationRepairPins, planCityCompanionNavigationUpgrade} from '../desktop/plan-city-companion-navigation-upgrade.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const [source, initial, godot] = process.argv.slice(2).map(value => path.resolve(value));
assert.ok(source && initial && godot, 'Pass an extracted original demo source, initial.json and headless Godot executable.');
const files = Object.keys(cityNavigationRepairPins).map(name => ({path: name, text: fs.readFileSync(path.join(source, name), 'utf8')}));
const plan = planCityCompanionNavigationUpgrade({repository, files});
assert.throws(() => planCityCompanionNavigationUpgrade({repository, files: files.map((file, index) => index ? file : {...file, text: file.text + '\n# custom edit'})}), /SOURCE_CHANGED/);
assert.throws(() => planCityCompanionNavigationUpgrade({repository, files: [files[0], files[0], ...files.slice(2)]}), /SOURCE_CHANGED/);
const out = fs.mkdtempSync(path.join(repository, 'test-results/city-navigation-'));
const project = path.join(out, 'source');
fs.cpSync(source, project, {recursive: true, filter: name => !name.split(path.sep).includes('.godot')});
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const addon = 'addons/cw.module.approved-pomeranian/companion.gd';
const originalAddon = sha(path.join(project, addon));
fs.writeFileSync(path.join(project, plan.operations[0].path), plan.operations[0].text);
fs.copyFileSync(initial, path.join(project, 'navigation-initial.json'));
fs.copyFileSync(path.join(repository, 'tests/fixtures/city-companion-navigation-acceptance.gd'), path.join(project, 'navigation-acceptance.gd'));
for (const [name, args] of [['import', ['--editor', '--import']], ['walk', ['--fixed-fps', '60', '--script', 'res://navigation-acceptance.gd']], ['cold', ['--fixed-fps', '60', '--script', 'res://navigation-acceptance.gd', '--', '--cold']]]) {
  const log = fs.openSync(path.join(out, name + '.log'), 'w');
  const result = spawnSync(godot, ['--headless', '--path', project, ...args], {windowsHide: true, stdio: ['ignore', log, log], timeout: 120000});
  fs.closeSync(log);
  assert.equal(result.error, undefined, name + ': ' + String(result.error));
  assert.equal(result.status, 0, name + ': see ' + path.join(out, name + '.log'));
  assert.doesNotMatch(fs.readFileSync(path.join(out, name + '.log'), 'utf8'), /SCRIPT ERROR:|ERROR:|WARNING:/, name);
}
assert.equal(sha(path.join(project, addon)), originalAddon, 'Published v2 bytes stay unchanged');
const reports = ['navigation-report.json', 'navigation-cold-report.json'].map(name => JSON.parse(fs.readFileSync(path.join(project, name), 'utf8')));
for (const report of reports) assert.deepEqual(report.failures, []);
console.log(JSON.stringify({out, role: 'deterministic-engine-regression', assertions: reports.reduce((sum, report) => sum + report.checks.length, 0), maxStep: reports[0].detail.maxStep, modelCalls: 0}));
