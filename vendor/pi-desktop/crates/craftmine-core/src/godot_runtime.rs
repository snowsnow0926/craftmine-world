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
struct CandidateArgs { world_id: String, application_id: String, token: String }

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
    fn runtime_artifacts(&self, world: &str, build: &str, job: &Value) -> Result<Value> {
        let root = godot_builds::build_root(&self.directory, world, build, false)?.join("artifacts");
        ensure!(godot_projects::ordinary(&root, "GODOT_ARTIFACT_MISSING")?.is_dir(), "GODOT_ARTIFACT_MISSING");
        let artifacts = godot_jobs::verified_artifacts(&self.db, world, build, &root)?;
        let mut checked = job["output"]["artifacts"].as_array().context("GODOT_ARTIFACT_MANIFEST_MISMATCH")?.clone();
        checked.sort_by(|a,b| a["path"].as_str().cmp(&b["path"].as_str()));
        ensure!(artifacts == checked, "GODOT_ARTIFACT_MANIFEST_MISMATCH");
        let entry = "web/index.html";
        ensure!(artifacts.iter().any(|item| item["path"] == entry), "GODOT_WEB_ENTRY_MISSING");
        let manifest = json!({"format":"craftmine.godot-artifacts/1","worldId":world,"buildId":build,"artifacts":artifacts});
        Ok(json!({"root":root.to_string_lossy(),"entry":entry,"threads":true,
            "artifactManifestHash":digest(&serde_json::to_string(&manifest)?),"artifacts":artifacts}))
    }

    /// Only an applied, integrity-checked build is a runnable formal world.
    /// This is not an executor attestation or proof of model-created gameplay.
    pub fn godot_runtime_describe(&self, args: &Value) -> Result<Value> {
        self.runtime_describe_impl(args, true)
    }

    pub(super) fn runtime_describe_impl(&self, args: &Value, verify_artifacts: bool) -> Result<Value> {
        let args: DescribeArgs = serde_json::from_value(args.clone())?;
        let current = worlds::read(&self.db, &args.world_id)?;
        match current.world.build["scene"]["format"].as_str() {
            Some("craftmine.scene/1" | "craftmine.scene/2" | "craftmine.scene/3") => return Ok(Value::Null),
            Some("craftmine.godot-scene/1") => {
                // A world created through the initialisation transaction is not
                // runnable until a real application confirmed its first launch.
                if let Some(init) = super::godot_worlds::read(&self.db, &args.world_id)? {
                    ensure!(
                        init["status"] == "confirmed",
                        "GODOT_WORLD_NOT_INITIALIZED"
                    );
                }
            }
            _ => return Err(anyhow::anyhow!("UNSUPPORTED_WORLD_RUNTIME")),
        }
        ensure!(current.world.snapshot["format"] == PROGRESS_FORMAT, "GODOT_PROGRESS_MIGRATION_REQUIRED");
        validate_binding(&current.world, Some(&args.world_id))?;
        let build = current.world.build["id"].as_str().context("INVALID_GODOT_BUILD")?;
        godot_builds::valid_build_id(build)?;
        // A copied world shares its source's immutable build copy, so the owning
        // store and the launch evidence come from the source world. The copy is
        // still reported under its own world id.
        let copy: Option<String> = self
            .db
            .query_row(
                "SELECT source_world_id FROM craftmine_godot_world_copies
                 WHERE target_world_id=?1 AND source_build_id=?2",
                params![args.world_id, build],
                |row| row.get(0),
            )
            .optional()?;
        let owner = copy.clone().unwrap_or_else(|| args.world_id.clone());
        let (base_id, engine, renderer, target): (String, String, String, String) = self.db.query_row(
            "SELECT base_id,engine_version,renderer,target FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
            params![owner, build], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        ).context("GODOT_BUILD_NOT_FOUND")?;
        ensure!(current.world.snapshot["baseId"] == base_id
            && current.world.build["godot"]["engineVersion"] == engine
            && current.world.build["godot"]["renderer"] == renderer
            && current.world.build["godot"]["target"] == target
            && engine == godot_builds::engine_version() && target == "web", "GODOT_BUILD_IDENTITY_MISMATCH");
        let applied: Option<(String, String, String, String)> = self.db.query_row(
            "SELECT a.input,a.input_hash,a.output,a.output_hash FROM craftmine_godot_applications a
             WHERE a.world_id=?1 AND a.build_id=?2 AND a.status='applied' ORDER BY a.updated_at DESC LIMIT 1",
            params![owner, build], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        ).optional()?;
        let (input, input_hash, output, output_hash) = applied.context("GODOT_BUILD_NOT_APPLIED")?;
        ensure!(digest(&input) == input_hash && digest(&output) == output_hash, "CORRUPT_GODOT_APPLICATION");
        let input: Value = serde_json::from_str(&input)?;
        let output: Value = serde_json::from_str(&output)?;
        ensure!(input["worldId"] == owner && input["buildId"] == build
            && output["inputHash"] == input_hash && output["launch"]["passed"] == true
            && output["launch"]["buildId"] == build, "CORRUPT_GODOT_APPLICATION");
        let candidate = godot_jobs::read_candidate(&self.db, input["candidateId"].as_str().context("CORRUPT_GODOT_APPLICATION")?)?;
        let job = godot_jobs::read_job(&self.db, input["checkJobId"].as_str().context("CORRUPT_GODOT_APPLICATION")?)?;
        ensure!(candidate["worldId"] == owner && candidate["buildId"] == build
            && candidate["status"] == "applied" && candidate["checkJobId"] == input["checkJobId"]
            && candidate["checkOutputHash"] == input["checkOutputHash"]
            && job["status"] == "passed" && job["outputHash"] == input["checkOutputHash"], "GODOT_BUILD_NOT_APPLIED");
        // Source head may have advanced since application. Formal builds remain
        // runnable independently of a newer draft; only their own artifacts count.
        let mut descriptor = if verify_artifacts { self.runtime_artifacts(&owner, build, &job)? } else { json!({}) };
        descriptor.as_object_mut().unwrap().extend(json!({"format":"craftmine.godot-runtime-descriptor/1","phase":"formal","worldId":args.world_id,
            "buildId":build,"baseId":base_id,"revision":current.summary.revision,"contentHash":current.content_hash,
            "snapshot":current.world.snapshot,"build":current.world.build,
            "copiedFromWorldId":copy}).as_object().unwrap().clone());
        Ok(descriptor)
    }

    /// Repair uses the exact applied source, never a newer unpublished head.
    /// Skipping artifact I/O here never skips application/check integrity.
    pub fn godot_world_rebuild_plan(&self, args: &Value) -> Result<Value> {
        let _lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let request: DescribeArgs = serde_json::from_value(args.clone())?;
        let metadata = self.runtime_describe_impl(args, false)?;
        ensure!(!metadata.is_null(), "GODOT_REBUILD_NOT_SUPPORTED");
        let availability = self.godot_runtime_describe(args);
        let reason = availability.err().map(|error| error.to_string());
        if let Some(reason) = &reason {
            ensure!(["GODOT_STORAGE_UNAVAILABLE", "GODOT_ARTIFACT_MISSING", "CORRUPT_GODOT_ARTIFACT",
                "GODOT_ARTIFACT_MANIFEST_MISMATCH", "GODOT_WEB_ENTRY_MISSING"]
                .iter().any(|code| reason.starts_with(code)), "GODOT_REBUILD_UNSAFE: {reason}");
        }
        let world = worlds::read(&self.db, &request.world_id)?;
        let build = metadata["buildId"].as_str().context("INVALID_GODOT_BUILD")?;
        let owner = metadata["copiedFromWorldId"].as_str().unwrap_or(&request.world_id);
        let (content, branch, revision): (Option<String>, String, i64) = self.db.query_row(
            "SELECT content_oid,branch_id,source_revision FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
            params![owner, build], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        // Older applied builds predate Git. Their migration map names the exact
        // legacy revision, unlike the repository's potentially newer main head.
        let (store, layout) = self.content_layout(&request.world_id)?;
        let content_oid = if owner != request.world_id {
            let copied = store.git().ref_value(&layout.git_dir, &super::godot_worlds::copied_formal_ref(&request.world_id, build))?
                .context("GODOT_REBUILD_SOURCE_TRANSFER_REQUIRED")?;
            self.verify_copied_formal_source(owner, build, &store, &layout, &copied)?;
            copied
        } else { match content {
            Some(value) => value,
            None => self.db.query_row("SELECT commit_oid FROM craftmine_content_revision_map WHERE world_id=?1 AND legacy_revision=?2",
                params![owner, revision], |row| row.get(0)).optional()?.context("GODOT_REBUILD_SOURCE_NOT_INDEXED")?,
        }};
        let tree = store.commit_tree_oid(&layout, &content_oid).context("GODOT_REBUILD_SOURCE_NOT_AVAILABLE")?;
        let rebuild_branch = format!("restore-{}", &digest(&format!("{}|{build}", request.world_id))[..24]);
        let rebuild_content = store.branch_head(&layout, &rebuild_branch)?;
        if let Some(head) = &rebuild_content {
            ensure!(store.commit_tree_oid(&layout, head)? == tree, "GODOT_REBUILD_BRANCH_CHANGED");
        }
        Ok(json!({"format":"craftmine.godot-rebuild-plan/1","worldId":request.world_id,
            "rebuildRequired":reason.is_some(),"reason":reason,"formalBuildId":build,
            "worldRevision":world.summary.revision,"snapshotHash":digest(&serde_json::to_string(&world.world.snapshot)?),
            "repoId":layout.repo_id,"contentOid":content_oid,"branchId":branch,
            "rebuildBranchId":rebuild_branch,"rebuildContentOid":rebuild_content}))
    }

    /// A prepared candidate may be started in a separate host-owned instance,
    /// but is not the formal world and may not save through its progress route.
    pub fn godot_runtime_describe_candidate(&self, args: &Value) -> Result<Value> {
        let args: CandidateArgs = serde_json::from_value(args.clone())?;
        let receipt = super::godot_applications::read(&self.db, &args.application_id)?;
        let owner: Option<String> = self.db.query_row("SELECT token FROM craftmine_godot_applications WHERE id=?1",
            [&args.application_id], |row| row.get(0))?;
        ensure!(owner.as_deref() == Some(args.token.as_str()), "GODOT_APPLICATION_OWNER_MISMATCH");
        ensure!(receipt["status"] == "prepared", "GODOT_APPLICATION_INACTIVE");
        let input = &receipt["input"];
        ensure!(input["worldId"] == args.world_id, "PROJECT_WORLD_BINDING_MISMATCH");
        let current = worlds::read(&self.db, &args.world_id)?;
        ensure!(input["revision"] == current.summary.revision && input["worldHash"] == current.content_hash
            && input["snapshot"] == current.world.snapshot, "WORLD_REVISION_CONFLICT");
        ensure!(input["snapshot"]["format"] == PROGRESS_FORMAT, "GODOT_PROGRESS_MIGRATION_REQUIRED");
        let candidate = godot_jobs::require_ready_candidate(&self.db,
            input["candidateId"].as_str().context("CORRUPT_GODOT_APPLICATION")?, &args.world_id)?;
        ensure!(candidate["buildId"] == input["buildId"] && candidate["checkOutputHash"] == input["checkOutputHash"],
            "GODOT_CANDIDATE_STALE");
        let build = super::godot_applications::godot_build_document(&self.db, &candidate)?;
        let world = worlds::WorldDocument {build:build.clone(), snapshot:current.world.snapshot.clone(), extensions:current.world.extensions};
        validate_binding(&world, Some(&args.world_id))?;
        ensure!(build["godot"]["engineVersion"] == godot_builds::engine_version() && build["godot"]["target"] == "web",
            "GODOT_BUILD_IDENTITY_MISMATCH");
        let job = godot_jobs::read_job(&self.db, input["checkJobId"].as_str().context("CORRUPT_GODOT_APPLICATION")?)?;
        let build_id = input["buildId"].as_str().context("CORRUPT_GODOT_APPLICATION")?;
        let mut descriptor = self.runtime_artifacts(&args.world_id, build_id, &job)?;
        descriptor.as_object_mut().unwrap().extend(json!({"format":"craftmine.godot-runtime-descriptor/1","phase":"candidate",
            "worldId":args.world_id,"buildId":build_id,"baseId":candidate["baseId"],"revision":current.summary.revision,
            "contentHash":current.content_hash,"snapshot":world.snapshot,"build":build,
            "applicationId":args.application_id,"applicationInputHash":receipt["inputHash"]}).as_object().unwrap().clone());
        Ok(descriptor)
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
            "instanceId":receipt.instance_id,"snapshotSha256":receipt.snapshot_sha256,
            "persistedAt":current.summary.updated_at,"snapshotHash":digest(&serde_json::to_string(&current.world.snapshot)?)}}))
    }
}
