import assert from "node:assert/strict";
import {register} from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {initStatusToCreation} = await import("../electron/main/godot-world-creation.ts");

// Contract fixture for godot_worlds.rs::godot_world_init_status. The core's
// job branch maps failed to GODOT_JOB_FAILED, and cancelled/interrupted to
// status=failed with GODOT_JOB_ENDED when no persisted reason is present.
// This is a projection test, not a real executor/engine acceptance receipt.
const coreStatus = reason => ({
  format: "craftmine.godot-world-init/1", initId: `gwinit-${"b".repeat(64)}`, worldId: "world-stage",
  title: "Stage contract", baseId: "first-person", baseBuild: "base-contract",
  status: "failed", reason, playable: false, applicationId: null, candidateId: null,
  projectRevision: 1, worldRevision: 0, formalBuildId: "base-contract",
  initialSnapshotHash: "a".repeat(64), createdAt: 1788998400000,
});

for (const [reason, origin] of [["GODOT_JOB_FAILED", "failed build/check"], ["GODOT_JOB_ENDED", "cancelled or interrupted job"]]) {
  test(`core ${origin} fallback fails the build stage, not project creation`, () => {
    const result = initStatusToCreation(coreStatus(reason));
    assert.equal(result.state, "failed");
    assert.deepEqual(result.creation.stages.map(({id, status}) => [id, status]), [
      ["materialize", "passed"], ["project", "passed"], ["build", "failed"], ["confirm", "pending"],
    ]);
    assert.equal(result.creation.stage, "build");
    assert.equal(result.creation.error.stage, "build");
    assert.equal(result.creation.error.code, reason);
    assert.deepEqual(result.creation.actions, ["retry", "details"]);
    assert.notEqual(result.creation.progress, 100);
  });
}

for (const reason of ["GODOT_PROJECT_MISSING", "GODOT_JOB_FAILED_UNKNOWN", "Unclassified failure", null]) {
  test(`an unclassified or project failure (${reason}) is not promoted by status or an existing project`, () => {
    const result = initStatusToCreation(coreStatus(reason));
    assert.equal(result.state, "failed");
    assert.equal(result.creation.stage, "project");
    assert.equal(result.creation.error.stage, "project");
    assert.deepEqual(result.creation.stages.map(stage => stage.status), ["passed", "failed", "pending", "pending"]);
    assert.equal(result.creation.error.code, reason ?? "GODOT_WORLD_INIT_FAILED");
  });
}

test("unknown nonterminal status with a job-like reason does not invent failure or success", () => {
  const result = initStatusToCreation({...coreStatus("GODOT_JOB_FAILED"), status: "unrecognized"});
  assert.equal(result.state, "initializing");
  assert.equal(result.creation.error, null);
  assert.deepEqual(result.creation.stages.map(stage => stage.status), ["pending", "pending", "pending", "pending"]);
});
