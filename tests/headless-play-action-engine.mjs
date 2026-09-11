// Actual pinned engine, private profile, no OS events or foreground window.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
fs.mkdirSync('test-results',{recursive:true});
const output=fs.mkdtempSync(path.resolve('test-results/headless-play-action-'));
const project=path.join(output,'project');
materializeBase({baseId:'creation-sandbox',worldId:'play-action-fixture',out:project});
fs.copyFileSync('tests/fixtures/headless-play-action-driver.gd',path.join(project,'driver.gd'));
const probe=await createGodotProbeEnvironment(output);
await probe.run('import',['--editor','--path',project,'--import']);
const text=await probe.run('events',['--path',project,'--script','res://driver.gd']);
const result=JSON.parse(text.split(/\r?\n/).find(line=>line.startsWith('PLAY_ACTION_RESULTS=')).slice('PLAY_ACTION_RESULTS='.length));
assert.ok(result.checks.every(check=>check.passed));
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({engine:probe.actualVersion,...result,limits:['Repository-authored event fixture, not pet gameplay acceptance','Native headless validates the pinned engine Input chain; Web export wiring requires separate integration']},null,2));
console.log(JSON.stringify({passed:result.checks.length,output,engine:probe.actualVersion}));
