// Trusted fixture regression tests; real headless Godot, isolated project/profile.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createGodotProbeEnvironment} from '../../toolchain.mjs';
const bases = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(bases, '../../..');
fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
const out = fs.mkdtempSync(path.join(root, 'test-results', 'audit-base-save-'));
const env = await createGodotProbeEnvironment(out);
const cases = {
  'first-person': `
var state = WorldState.new()
state.world_id = "own"
var foreign = {"format": WorldState.FORMAT, "worldId": "other", "stateVersion": 1, "base": "first-person", "player": {}, "equipment": {}, "inventory": {}, "targets": [], "interactables": [], "quests": {}}
assert(state.apply(foreign) == "State belongs to another world")
var store = SaveStore.new()
store.world_id = "backup-test"
var payload = {"format": SaveStore.FORMAT, "worldId": store.world_id, "stateVersion": 1}
assert(store.save(payload).is_empty())
var dir = DirAccess.open(store.directory())
assert(dir.rename("state.json", "state.json.bak") == OK)
assert(dir.make_dir("state.json") == OK)
assert(not store.save(payload).is_empty())
assert(dir.file_exists("state.json.bak"))
store.free()
state.free()
`,
  'top-down/worlds/town': `
var state = WorldState.create("audit-own", {})
state.coins = 17
assert(SaveSystem.save(state).ok)
var target = SaveSystem.progress_path(state.world_id)
var before = FileAccess.get_file_as_string(target)
assert(DirAccess.make_dir_absolute(target + ".tmp") == OK)
state.coins = 99
assert(not SaveSystem.save(state).ok)
assert(FileAccess.get_file_as_string(target) == before)
assert(DirAccess.remove_absolute(target + ".tmp") == OK)
assert(DirAccess.rename_absolute(target, target + ".bak") == OK)
assert(SaveSystem.restore_into(state).ok and state.coins == 17)
var game = load("res://scripts/base/game.gd").new()
game.state = state
game.boot_error = "Rejected progress"
game.world = {"autosaveOnExit": true}
game.mark_dirty()
assert(not game.save().ok and game._dirty)
game._autosave()
assert(not FileAccess.file_exists(target))
game.free()
`,
  'mining-sandbox/worlds/mine-camp': `
var state = MiningWorldState.new()
state.world_id = "audit-own"
var good = state.to_dict()
assert(state.from_dict(good, "audit-own").ok)
var before = JSON.stringify(state.to_dict())
for field in ["worldId", "stateVersion", "inventory", "chunkIndex", "player"]:
	var bad = good.duplicate(true)
	bad[field] = "foreign" if field == "worldId" else "invalid"
	assert(not state.from_dict(bad, "audit-own").ok)
assert(JSON.stringify(state.to_dict()) == before)
var missing = {"format": MiningWorldState.STATE_FORMAT, "worldId": "audit-own", "stateVersion": 1}
assert(not state.from_dict(missing, "audit-own").ok)
var revision_only = good.duplicate(true)
revision_only.chunkIndex = {"0_0": {"revision": 2, "file": "", "sha256": "", "bytes": 0, "cells": 0}}
assert(state.from_dict(revision_only, "audit-own").ok)
var contradictory = good.duplicate(true)
contradictory.chunkIndex = {"0_0": {"revision": 2, "file": "", "sha256": "", "bytes": 0, "cells": 5}}
assert(not state.from_dict(contradictory, "audit-own").ok)
var escaping = good.duplicate(true)
escaping.chunkIndex = {"0_0": {"revision": 1, "file": "../escape.json", "sha256": "0".repeat(64), "bytes": 1, "cells": 1}}
assert(not state.from_dict(escaping, "audit-own").ok)
state.ledger_record("auto:1", "dig", {"ok": true}, true, 1024)
assert(state.ledger_lookup("auto:1").is_empty())
state.ledger_record("req-1", "dig", {"ok": true}, true, 1024)
assert(not state.ledger_lookup("req-1").is_empty())
`,
  'side-view': `
var state = WorldState.create("audit-own", 1)
state.grant_ability("double_jump")
var good = state.to_dict()
var before = state.to_canonical_json()
for field in ["worldId", "abilities", "rooms", "inventory", "player", "stateVersion"]:
	var bad = good.duplicate(true)
	bad[field] = "foreign" if field == "worldId" else "invalid"
	assert(not state.apply_dict(bad).ok)
	assert(state.to_canonical_json() == before)
var missing = {"format": WorldState.FORMAT, "worldId": state.world_id, "stateVersion": 1}
assert(not state.apply_dict(missing).ok and state.to_canonical_json() == before)
assert(state.apply_dict(good).ok)
var store = SaveStore.create(state.world_id)
assert(store.save(state).saved)
var bad = good.duplicate(true)
bad.worldId = "other"
var file = FileAccess.open(store.state_path(), FileAccess.WRITE)
file.store_string(JSON.stringify(bad))
file.close()
assert(not store.load_into(state).loaded and state.to_canonical_json() == before)
`,
};
const checks = [];
const ids=[];
for(const name of ['instance-a','instance-b']) {
  const destination=path.join(out,name);
  const result=spawnSync(process.execPath,[path.join(bases,'side-view/tools/new-world.mjs'),'--world','ruins','--out',destination],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  ids.push(JSON.parse(fs.readFileSync(path.join(destination,'worlds/default.json'),'utf8')).instanceId);
}
assert.notEqual(ids[0],ids[1]);
const protectedFile=path.join(out,'instance-a','keep.txt');
fs.writeFileSync(protectedFile,'preserve');
const overwrite=spawnSync(process.execPath,[path.join(bases,'side-view/tools/new-world.mjs'),'--world','ruins','--out',path.join(out,'instance-a'),'--force'],{encoding:'utf8',windowsHide:true});
assert.notEqual(overwrite.status,0);
assert.equal(fs.readFileSync(protectedFile,'utf8'),'preserve');
checks.push({base:'side-view-materializer',passed:true,distinctInstanceIds:ids});
for (const [base, script] of Object.entries(cases)) {
  const label = base.split('/')[0];
  const project = path.join(out, label);
  if (base === 'side-view') {
    // Isolate persistence classes while retaining their real resource paths.
    // The full base import below must also exit without resource leaks.
    fs.mkdirSync(path.join(project,'scripts/runtime'), {recursive:true});
    fs.writeFileSync(path.join(project,'project.godot'), 'config_version=5\n');
    for(const file of ['world_state.gd','save_store.gd']) fs.copyFileSync(path.join(bases,base,'scripts/runtime',file),path.join(project,'scripts/runtime',file));
  } else fs.cpSync(path.join(bases, base), project, {recursive:true, filter:p=>path.basename(p) !== '.godot'});
  // Unit fixtures load classes only: no gameplay autoloads or live world boot.
  await env.run(label+'-import', ['--path', project, '--editor', '--import']);
  fs.writeFileSync(path.join(project, 'audit.gd'), 'extends SceneTree\nfunc _initialize():\n'+script.trim().split('\n').map(l=>'\t'+l).join('\n')+'\n\tprint("AUDIT_PASS")\n\tquit(0)\n');
  // Keep autoload declarations for compile-time names; scripts use isolated user://.
  const output = await env.run(label+'-state', ['--path', project, '--script', 'res://audit.gd']);
  if (!output.includes('AUDIT_PASS')) throw Error(label+' missing assertions');
  checks.push({base,passed:true});
  console.log('PASS '+label);
}
const bootProject=path.join(out,'side-view-boot');
fs.cpSync(path.join(bases,'side-view'),bootProject,{recursive:true,filter:p=>path.basename(p)!=='.godot'});
const bootEnv={...process.env,APPDATA:path.join(out,'profile/appdata'),LOCALAPPDATA:path.join(out,'profile/localappdata'),USERPROFILE:path.join(out,'profile/userprofile'),TEMP:path.join(out,'profile/temp'),TMP:path.join(out,'profile/tmp'),CRAFTMINE_SIDEVIEW_WORLD:'ruins',CRAFTMINE_SIDEVIEW_SAVE_DIR:path.join(out,'boot-saves')};
delete bootEnv.CRAFTMINE_SIDEVIEW_RESET;
delete bootEnv.CRAFTMINE_SIDEVIEW_INPUT_PLAN;
delete bootEnv.CRAFTMINE_SIDEVIEW_INSTANCE_ID;
const imported=spawnSync(env.executable,['--headless','--path',bootProject,'--import'],{env:bootEnv,encoding:'utf8',windowsHide:true,timeout:60000});
const importLog=imported.stdout+imported.stderr;
fs.writeFileSync(path.join(out,'side-view-full-import.log'),importLog);
assert.equal(imported.status,0);
assert.ok(!/SCRIPT ERROR|Parse Error|ERROR:|leaked at exit/.test(importLog));
const rejectedSave=path.join(bootEnv.CRAFTMINE_SIDEVIEW_SAVE_DIR,'ruins/state.json');
fs.mkdirSync(path.dirname(rejectedSave),{recursive:true});
const rejectedBytes='{"format":"craftmine.godot-sideview-state/1","stateVersion":99}';
fs.writeFileSync(rejectedSave,rejectedBytes);
const boot=spawnSync(env.executable,['--headless','--path',bootProject,'--quit-after','30'],{env:bootEnv,encoding:'utf8',windowsHide:true,timeout:60000});
fs.writeFileSync(path.join(out,'side-view-rejected-boot.log'),boot.stdout+boot.stderr);
assert.equal(boot.status,3);
assert.equal(fs.readFileSync(rejectedSave,'utf8'),rejectedBytes);
checks.push({base:'side-view-rejected-boot',passed:true,exitCode:boot.status});
fs.writeFileSync(path.join(out,'report.json'), JSON.stringify({checks,runs:env.runs,realModelCalls:0,knownImportDiagnostics:importLog.split(/\r?\n/).filter(l=>/ERROR:|WARNING:/.test(l))},null,2));
console.log(out);
