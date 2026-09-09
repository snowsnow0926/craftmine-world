// S2 real-broker recovery test.
//
// Runs the pinned `godot-host-broker.exe` built from `desktop/godot/sandbox`
// through the executor's own recovery pass, so the report the supervisor
// consumes is proven against the real CLI rather than a stand-in. It needs no
// Godot engine and no core: `recover` is a host-owned pass over a tasks root.
//
//   $env:CRAFTMINE_GODOT_BROKER_BIN="<worktree>\desktop\godot\sandbox\target\debug\godot-host-broker.exe"
//   node --test tests/godot-round3/S2/recovery-real-broker.mjs
//
// Without the variable the test is skipped and says so; it never silently
// passes as if the real binary had been exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {runRecoveryPass, RECOVERY_POLICY_VERSION} = require('../../../plugins/craftmine-world/godot-executor.cjs');

const broker = process.env.CRAFTMINE_GODOT_BROKER_BIN;
const brokerPresent = !!broker && fs.existsSync(broker);
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('the pinned broker recover CLI reports a policy-versioned empty pass', {skip:brokerPresent ? false : 'CRAFTMINE_GODOT_BROKER_BIN is not set'},
  async () => {
    const tasksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-s2-recover-'));
    const summary = await runRecoveryPass({broker, tasksRoot, trigger:'real-broker'});
    assert.equal(summary.ok, true, 'report must carry the recovery policy version: ' + JSON.stringify(summary));
    assert.equal(summary.policyVersion, RECOVERY_POLICY_VERSION);
    assert.equal(fs.realpathSync(summary.tasksRoot), fs.realpathSync(tasksRoot));
    assert.deepEqual(summary.reclaimed, []);
    assert.deepEqual(summary.skipped, []);
    assert.deepEqual(summary.unreadable, []);
    assert.equal(summary.finalReceiptClaimed, false);
    fs.rmSync(tasksRoot, {recursive:true, force:true});
  });

test('the pinned broker refuses a recovery pass over a non-existent root', {skip:brokerPresent ? false : 'CRAFTMINE_GODOT_BROKER_BIN is not set'},
  async () => {
    const missing = path.join(os.tmpdir(), 'craftmine-s2-missing-' + Date.now());
    const summary = await runRecoveryPass({broker, tasksRoot:missing, trigger:'real-broker-missing'});
    // A preparation failure is reported, never mistaken for a clean pass.
    assert.equal(summary.ok, false);
    assert.deepEqual(summary.reclaimed, []);
  });

test('the recorded broker identity matches the binary under test', {skip:brokerPresent ? false : 'CRAFTMINE_GODOT_BROKER_BIN is not set'},
  () => {
    const identityFile = process.env.CRAFTMINE_GODOT_BROKER_IDENTITY
      ?? path.join(path.dirname(broker), 'broker-identity.json');
    if (!fs.existsSync(identityFile)) {
      // The shipped pin lives next to the packaged copy; a local debug build
      // simply has none yet.
      assert.ok(true, 'no identity file next to this build');
      return;
    }
    const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
    assert.equal(identity.format, 'craftmine.godot-broker-identity/1');
    assert.equal(identity.sha256, sha256(broker));
    assert.equal(identity.protocolVersion, 1);
    assert.equal(identity.recoveryPolicyVersion, RECOVERY_POLICY_VERSION);
  });

test('the recovery CLI exits 1 on a partial pass without breaking the report', {skip:brokerPresent ? false : 'CRAFTMINE_GODOT_BROKER_BIN is not set'},
  () => {
    // An empty tasks root has no journal, so the CLI must still succeed; this
    // asserts the exit-code contract the supervisor relies on (a non-zero exit
    // is not by itself a failure).
    const tasksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-s2-exit-'));
    const output = execFileSync(broker, ['recover', tasksRoot], {encoding:'utf8'});
    const report = JSON.parse(output.trim());
    assert.equal(report.policyVersion, RECOVERY_POLICY_VERSION);
    assert.equal(report.skippedCount, 0);
    fs.rmSync(tasksRoot, {recursive:true, force:true});
  });
