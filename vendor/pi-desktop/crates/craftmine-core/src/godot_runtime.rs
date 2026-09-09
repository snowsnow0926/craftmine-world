//! Private host access to applied exports and lossless Godot play progress.
//! Paths come from the core's build store; game documents never grant file access.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{digest, godot_builds, godot_jobs, godot_projects, worlds, TaskJournal};

pub(super) const PROGRESS_FORMAT: &str = "craftmine.godot-progress/1";
pub(super) const PROGRESS_BYTES: usize = 1024 * 1024;

#[cfg(test)]
#[path = "godot_runtime_tests.rs"]
mod tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Progress {
    format: String,
    world_id: String,
    base_id: String,
    base_version: String,
    state_version: u32,
    body: Value,
}

pub(super) fn validate_progress(snapshot: &Value) -> Result<()> {
    ensure!(serde_json::to_vec(snapshot)?.len() <= PROGRESS_BYTES, "GODOT_PROGRESS_TOO_LARGE");
    let progress: Progress = serde_json::from_value(snapshot.clone()).context("INVALID_GODOT_PROGRESS")?;
    worlds::validate_id(&progress.world_id)?;
    worlds::validate_id(&progress.base_id)?;
    ensure!(progress.format == PROGRESS_FORMAT && progress.state_version > 0
        && !progress.base_version.is_empty() && progress.base_version.len() <= 80
        && progress.base_version.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        && progress.body.is_object(), "INVALID_GODOT_PROGRESS");
    if let Some(body_world) = progress.body.get("worldId") {
        ensure!(body_world == &progress.world_id, "GODOT_PROGRESS_WORLD_MISMATCH");
    }
    Ok(())
}

pub(super) fn validate_binding(world: &worlds::WorldDocument, id: Option<&str>) -> Result<()> {
    if world.snapshot["format"] != PROGRESS_FORMAT { return Ok(()); }
    validate_progress(&world.snapshot)?;
    ensure!(world.build["scene"]["format"] == "craftmine.godot-scene/1"
        && world.build["godot"].is_object()
        && world.build["scene"]["baseId"] == world.snapshot["baseId"], "GODOT_PROGRESS_BASE_MISMATCH");
    if let Some(id) = id {
        ensure!(world.snapshot["worldId"] == id, "GODOT_PROGRESS_WORLD_MISMATCH");
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DescribeArgs { world_id: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveArgs {
    world_id: String,
    build_id: String,
    revision: u64,
    runner_receipt: RunnerReceipt,
    snapshot: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunnerReceipt {
    format: String,
    world_id: String,
    build_id: String,
    instance_id: String,
    snapshot_text: String,
    snapshot_sha256: String,
    bytes: usize,
}

// Godot encodes integral floats as `1.0`; JavaScript re-encodes them as `1`.
// Compare JSON values without making serialization spelling an identity check.
// Do not conflate distinct large integers through lossy f64 conversion.
fn same_json(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) if a != b => {
            match (a.as_f64(), b.as_f64()) {
                (Some(a), Some(b)) => a == b && a.abs() <= 9_007_199_254_740_991.0,
                _ => false,
            }
        }
        (Value::Array(a), Value::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a,b)| same_json(a,b)),
        (Value::Object(a), Value::Object(b)) => a.len() == b.len()
            && a.iter().all(|(key,a)| b.get(key).is_some_and(|b| same_json(a,b))),
        _ => left == right,
    }
}

impl TaskJournal {
    /// Only an applied, integrity-checked build is a runnable formal world.
    /// This is not an executor attestation or proof of model-created gameplay.
    pub fn godot_runtime_describe(&self, args: &Value) -> Result<Value> {
        let args: DescribeArgs = serde_json::from_value(args.clone())?;
        let current = worlds::read(&self.db, &args.world_id)?;
        match current.world.build["scene"]["format"].as_str() {
            Some("craftmine.scene/1" | "craftmine.scene/2" | "craftmine.scene/3") => return Ok(Value::Null),
            Some("craftmine.godot-scene/1") => {},
            _ => return Err(anyhow::anyhow!("UNSUPPORTED_WORLD_RUNTIME")),
        }
        ensure!(current.world.snapshot["format"] == PROGRESS_FORMAT, "GODOT_PROGRESS_MIGRATION_REQUIRED");
        validate_binding(&current.world, Some(&args.world_id))?;
        let build = current.world.build["id"].as_str().context("INVALID_GODOT_BUILD")?;
        godot_builds::valid_build_id(build)?;
        let (base_id, engine, renderer, target): (String, String, String, String) = self.db.query_row(
            "SELECT base_id,engine_version,renderer,target FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
            params![args.world_id, build], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        ).context("GODOT_BUILD_NOT_FOUND")?;
        ensure!(current.world.snapshot["baseId"] == base_id
            && current.world.build["godot"]["engineVersion"] == engine
            && current.world.build["godot"]["renderer"] == renderer
            && current.world.build["godot"]["target"] == target
            && engine == godot_builds::engine_version() && target == "web", "GODOT_BUILD_IDENTITY_MISMATCH");
        let applied: Option<(String, String, String, String)> = self.db.query_row(
            "SELECT a.input,a.input_hash,a.output,a.output_hash FROM craftmine_godot_applications a
             WHERE a.world_id=?1 AND a.build_id=?2 AND a.status='applied' ORDER BY a.updated_at DESC LIMIT 1",
            params![args.world_id, build], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        ).optional()?;
        let (input, input_hash, output, output_hash) = applied.context("GODOT_BUILD_NOT_APPLIED")?;
        ensure!(digest(&input) == input_hash && digest(&output) == output_hash, "CORRUPT_GODOT_APPLICATION");
        let input: Value = serde_json::from_str(&input)?;
        let output: Value = serde_json::from_str(&output)?;
        ensure!(input["worldId"] == args.world_id && input["buildId"] == build
            && output["inputHash"] == input_hash && output["launch"]["passed"] == true
            && output["launch"]["buildId"] == build, "CORRUPT_GODOT_APPLICATION");
        let candidate = godot_jobs::read_candidate(&self.db, input["candidateId"].as_str().context("CORRUPT_GODOT_APPLICATION")?)?;
        let job = godot_jobs::read_job(&self.db, input["checkJobId"].as_str().context("CORRUPT_GODOT_APPLICATION")?)?;
        ensure!(candidate["worldId"] == args.world_id && candidate["buildId"] == build
            && candidate["status"] == "applied" && candidate["checkJobId"] == input["checkJobId"]
            && candidate["checkOutputHash"] == input["checkOutputHash"]
            && job["status"] == "passed" && job["outputHash"] == input["checkOutputHash"], "GODOT_BUILD_NOT_APPLIED");
        // Source head may have advanced since application. Formal builds remain
        // runnable independently of a newer draft; only their own artifacts count.
        let root = godot_builds::build_root(&self.directory, &args.world_id, build, false)?.join("artifacts");
        ensure!(godot_projects::ordinary(&root, "GODOT_ARTIFACT_MISSING")?.is_dir(), "GODOT_ARTIFACT_MISSING");
        let artifacts = godot_jobs::verified_artifacts(&self.db, &args.world_id, build, &root)?;
        let mut checked_artifacts = job["output"]["artifacts"].as_array().context("GODOT_ARTIFACT_MANIFEST_MISMATCH")?.clone();
        checked_artifacts.sort_by(|a,b| a["path"].as_str().cmp(&b["path"].as_str()));
        ensure!(artifacts == checked_artifacts, "GODOT_ARTIFACT_MANIFEST_MISMATCH");
        let entry = "web/index.html";
        ensure!(artifacts.iter().any(|item| item["path"] == entry), "GODOT_WEB_ENTRY_MISSING");
        let manifest = json!({"format":"craftmine.godot-artifacts/1","worldId":args.world_id,"buildId":build,"artifacts":artifacts});
        Ok(json!({"format":"craftmine.godot-runtime-descriptor/1","worldId":args.world_id,
            "buildId":build,"baseId":base_id,"revision":current.summary.revision,"contentHash":current.content_hash,
            "snapshot":current.world.snapshot,"build":current.world.build,
            "root":root.to_string_lossy(),"entry":entry,"threads":true,
            "artifactManifestHash":digest(&serde_json::to_string(&manifest)?),"artifacts":artifacts}))
    }

    /// The runner confirms a snapshot; only this SQLite transaction proves it is
    /// durable. The orchestrator must bind the runner receipt to its live instance.
    pub fn godot_runtime_save_progress(&mut self, args: &Value) -> Result<Value> {
        let args: SaveArgs = serde_json::from_value(args.clone())?;
        let receipt = args.runner_receipt;
        ensure!(receipt.format == "craftmine.godot-runner-receipt/1"
            && receipt.world_id == args.world_id && receipt.build_id == args.build_id
            && !receipt.instance_id.is_empty() && receipt.instance_id.len() <= 128
            && receipt.instance_id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_')),
            "GODOT_RUNNER_RECEIPT_MISMATCH");
        ensure!(receipt.snapshot_text.len() <= PROGRESS_BYTES, "GODOT_PROGRESS_TOO_LARGE");
        godot_projects::valid_hash(&receipt.snapshot_sha256)?;
        ensure!(receipt.bytes == receipt.snapshot_text.len()
            && receipt.snapshot_sha256 == digest(&receipt.snapshot_text)
            && same_json(&serde_json::from_str::<Value>(&receipt.snapshot_text).context("INVALID_GODOT_PROGRESS")?, &args.snapshot),
            "GODOT_SNAPSHOT_HASH_MISMATCH");
        ensure!(args.snapshot["format"] == PROGRESS_FORMAT && args.snapshot["worldId"] == args.world_id,
            "GODOT_PROGRESS_WORLD_MISMATCH");
        let current = self.world_save_progress(&args.world_id, args.revision, &args.build_id, &args.snapshot)?;
        Ok(json!({"receipt":{"format":"craftmine.godot-progress-receipt/1","worldId":args.world_id,
            "buildId":args.build_id,"revision":current.summary.revision,"contentHash":current.content_hash,
            "persistedAt":current.summary.updated_at,"snapshotHash":digest(&serde_json::to_string(&current.world.snapshot)?)}}))
    }
}
