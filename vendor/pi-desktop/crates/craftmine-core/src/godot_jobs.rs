//! Isolated-executor gate, durable build/check jobs and candidate records.
//!
//! The core never starts Godot itself. A job can only be claimed after an
//! executor registered an isolation attestation for the locked engine version.
//! Without that registration the job is `blocked` and reports why.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;

use super::{
    digest,
    godot_builds::{self, build_root, engine_version},
    workspaces, worlds, TaskJournal, WorkspaceContext,
};

const LEASE_MILLIS: i64 = 120_000;
const QUEUE_TIMEOUT_MILLIS: i64 = 600_000;
// Exported engine wasm is substantially larger than a project source file.
pub(super) const ARTIFACT_FILE_BYTES: u64 = 256 * 1024 * 1024;
const ARTIFACT_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const ARTIFACT_COUNT: usize = 4096;

#[cfg(test)]
#[path = "godot_jobs_tests.rs"]
mod tests;

#[path = "godot_check_requirements.rs"]
pub(super) mod requirements;
#[cfg(test)]
#[path = "godot_check_requirements_tests.rs"]
mod requirements_tests;
#[cfg(test)]
#[path = "godot_controller_requirements_tests.rs"]
mod controller_requirements_tests;

/// Live isolation attestation of one executor process. It is intentionally not
/// durable: a restarted core requires the executor to prove itself again.
#[derive(Clone, Debug)]
pub(crate) struct Executor {
    pub(crate) engine_version: String,
    pub(crate) isolation: String,
    pub(crate) evidence_hash: String,
    pub(crate) capabilities: Value,
    pub(crate) registered_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegisterArgs {
    executor_id: String,
    attestation: Attestation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attestation {
    format: String,
    isolation: String,
    evidence_hash: String,
    engine_version: String,
    capabilities: Capabilities,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capabilities {
    import: bool,
    build: bool,
    check: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimArgs {
    job_id: String,
    token: String,
    executor_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProgressArgs {
    job_id: String,
    token: String,
    stage: String,
    percent: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TokenArgs {
    job_id: String,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckDescriptorArgs {
    job_id: String,
    token: String,
    artifacts: Vec<Artifact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeArgs {
    executor_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContinueArgs {
    world_id: String,
    tool_call_id: String,
    origin_job_id: String,
    context: WorkspaceContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UsageArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FinishArgs {
    job_id: String,
    token: String,
    output: JobResult,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobResult {
    format: String,
    input_hash: String,
    passed: bool,
    import: StageResult,
    compile: CompileResult,
    check: CheckResult,
    artifacts: Vec<Artifact>,
    engine: EngineResult,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StageResult {
    passed: bool,
    #[serde(default)]
    log: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompileResult {
    passed: bool,
    #[serde(default)]
    errors: Vec<String>,
    #[serde(default)]
    warnings: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckResult {
    passed: bool,
    /// Bounded untrusted observations, excluded from the pass/fail calculation.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "diagnostic_log")]
    diagnostic_log: Option<String>,
    #[serde(default)]
    assertions: Vec<Assertion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    defaults_snapshot: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress_migration: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    requirements_evidence: Option<Value>,
}

fn diagnostic_log<'de, D: serde::Deserializer<'de>>(deserializer: D) -> std::result::Result<Option<String>, D::Error> {
    let value = Option::<String>::deserialize(deserializer)?;
    if value.as_ref().is_some_and(|log| log.len() > 65_536) {
        return Err(serde::de::Error::custom("GODOT_DIAGNOSTIC_LOG_TOO_LARGE"));
    }
    Ok(value)
}

#[cfg(test)]
mod diagnostic_log_tests {
    use super::*;

    #[test]
    fn bounded_diagnostic_log_is_optional_non_scoring_and_roundtrips() {
        let old: CheckResult = serde_json::from_value(json!({"passed":true,"assertions":[]})).unwrap();
        assert!(serde_json::to_value(old).unwrap().get("diagnosticLog").is_none());
        for passed in [true, false] {
            let input = json!({"passed":passed,"assertions":[],"diagnosticLog":"{\"diagnosticOnly\":true,\"error\":\"GODOT_CHECK_TIMEOUT\"}"});
            let check: CheckResult = serde_json::from_value(input.clone()).unwrap();
            assert_eq!(check.passed, passed);
            assert_eq!(serde_json::to_value(check).unwrap(), input);
        }
    }

    #[test]
    fn diagnostic_log_limit_counts_utf8_bytes_and_rejects_non_text() {
        let accepted = json!({"passed":false,"diagnosticLog":"x".repeat(65_536)});
        assert!(serde_json::from_value::<CheckResult>(accepted).is_ok());
        let rejected = json!({"passed":false,"diagnosticLog":"犬".repeat(21_846)});
        let error = serde_json::from_value::<CheckResult>(rejected).err().unwrap().to_string();
        assert!(error.contains("GODOT_DIAGNOSTIC_LOG_TOO_LARGE"));
        assert!(serde_json::from_value::<CheckResult>(json!({"passed":false,"diagnosticLog":{}})).is_err());
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Assertion {
    id: String,
    passed: bool,
    #[serde(default)]
    detail: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Artifact {
    path: String,
    sha256: String,
    bytes: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EngineResult {
    version: String,
    isolation: String,
    evidence_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateReadArgs {
    world_id: String,
    candidate_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateListArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
    #[serde(default)]
    offset: usize,
    #[serde(default = "candidate_limit")]
    limit: usize,
}
fn candidate_limit() -> usize {
    16
}

pub(super) fn check_input(db: &Connection, job: &str) -> Result<Value> {
    let (body, hash): (Option<String>, Option<String>) = db.query_row(
        "SELECT check_input,check_input_hash FROM craftmine_godot_jobs WHERE id=?1", [job],
        |r| Ok((r.get(0)?, r.get(1)?)))?;
    let body = body.context("GODOT_CHECK_INPUT_REQUIRED")?;
    ensure!(hash.as_deref() == Some(digest(&body).as_str()), "GODOT_CHECK_INPUT_CORRUPT");
    Ok(serde_json::from_str(&body)?)
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_jobs (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
            task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), tool_call_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('build','check')), build_id TEXT NOT NULL,
            source_revision INTEGER NOT NULL, manifest_hash TEXT NOT NULL,
            asset_manifest_hash TEXT NOT NULL, base_id TEXT NOT NULL, base_build TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('blocked','queued','claimed','running','passed','failed','cancelled','interrupted')),
            blocked_reason TEXT, executor_id TEXT, run_token TEXT, stage TEXT,
            progress INTEGER NOT NULL DEFAULT 0, lease_expires_at INTEGER,
            output TEXT, output_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            UNIQUE(task_id,tool_call_id)
        );
        CREATE INDEX IF NOT EXISTS craftmine_godot_jobs_world ON craftmine_godot_jobs(world_id,created_at);
        CREATE TABLE IF NOT EXISTS craftmine_godot_candidates (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
            build_id TEXT NOT NULL, source_revision INTEGER NOT NULL, manifest_hash TEXT NOT NULL,
            asset_manifest_hash TEXT NOT NULL, base_id TEXT NOT NULL, base_build TEXT NOT NULL,
            check_job_id TEXT NOT NULL REFERENCES craftmine_godot_jobs(id), check_output_hash TEXT,
            status TEXT NOT NULL CHECK(status IN ('draft','ready','rejected','superseded','applied','failed')),
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS craftmine_godot_candidates_world ON craftmine_godot_candidates(world_id,created_at);",
    )?;
    // Jobs gained an explicit expiry reason and a continuation origin after the
    // first executor shipped; both are additive and safe to backfill as NULL.
    for (column, definition) in [
        ("interrupt_reason", "TEXT"),
        ("origin_job_id", "TEXT"),
        ("check_input", "TEXT"),
        ("check_input_hash", "TEXT"),
        ("check_requirements", "TEXT"),
        ("check_requirements_hash", "TEXT"),
    ] {
        let present: bool = db.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('craftmine_godot_jobs') WHERE name=?1",
            [column],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if !present {
            db.execute_batch(&format!(
                "ALTER TABLE craftmine_godot_jobs ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    // Core-measurable accounting per terminal execution. Model-side counters
    // (tokens, requests, compactions) are not observable here and stay unknown
    // instead of being reported as zero.
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_job_usage (
            job_id TEXT PRIMARY KEY REFERENCES craftmine_godot_jobs(id),
            world_id TEXT NOT NULL, task_id TEXT NOT NULL, origin_job_id TEXT,
            kind TEXT NOT NULL, outcome TEXT NOT NULL, wall_clock_ms INTEGER NOT NULL,
            source_bytes INTEGER NOT NULL DEFAULT 0, asset_bytes INTEGER NOT NULL DEFAULT 0,
            host_bytes INTEGER NOT NULL DEFAULT 0, artifact_bytes INTEGER NOT NULL DEFAULT 0,
            artifact_count INTEGER NOT NULL DEFAULT 0, build_files INTEGER NOT NULL DEFAULT 0,
            limits TEXT NOT NULL, recorded_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS craftmine_godot_job_usage_world
            ON craftmine_godot_job_usage(world_id,recorded_at);",
    )?;
    Ok(())
}

/// Model-side counters that the core cannot observe for a build/check job.
pub(super) const UNKNOWN_USAGE_FIELDS: [&str; 5] =
    ["modelTokens", "modelRequests", "compactions", "contextTokens", "serviceQuota"];

/// Persist accounting for every terminal job exactly once. Values are recomputed
/// from durable rows, so a repeated sweep cannot inflate or lose usage.
pub(super) fn settle_usage(db: &Connection) -> Result<usize> {
    let limits = json!({
        "buildFileCount":godot_builds::BUILD_FILE_COUNT,"buildFileBytes":godot_builds::BUILD_FILE_BYTES,
        "buildTotalBytes":godot_builds::BUILD_TOTAL,"artifactCount":ARTIFACT_COUNT,
        "artifactFileBytes":ARTIFACT_FILE_BYTES,"artifactTotalBytes":ARTIFACT_TOTAL_BYTES,
        "leaseMillis":LEASE_MILLIS,"queueTimeoutMillis":QUEUE_TIMEOUT_MILLIS,
        "unknown":UNKNOWN_USAGE_FIELDS
    });
    let changed = db.execute(
        "INSERT OR IGNORE INTO craftmine_godot_job_usage(job_id,world_id,task_id,origin_job_id,kind,
            outcome,wall_clock_ms,source_bytes,asset_bytes,host_bytes,artifact_bytes,artifact_count,
            build_files,limits,recorded_at)
         SELECT j.id,j.world_id,j.task_id,j.origin_job_id,j.kind,j.status,
            MAX(0,j.updated_at-j.created_at),
            COALESCE((SELECT SUM(f.bytes) FROM craftmine_godot_build_files f WHERE f.world_id=j.world_id
                AND f.build_id=j.build_id AND f.kind='source'),0),
            COALESCE((SELECT SUM(f.bytes) FROM craftmine_godot_build_files f WHERE f.world_id=j.world_id
                AND f.build_id=j.build_id AND f.kind='asset'),0),
            COALESCE((SELECT SUM(f.bytes) FROM craftmine_godot_build_files f WHERE f.world_id=j.world_id
                AND f.build_id=j.build_id AND f.kind='host'),0),
            COALESCE((SELECT SUM(f.bytes) FROM craftmine_godot_build_files f WHERE f.world_id=j.world_id
                AND f.build_id=j.build_id AND f.kind='artifact'),0),
            COALESCE((SELECT COUNT(*) FROM craftmine_godot_build_files f WHERE f.world_id=j.world_id
                AND f.build_id=j.build_id AND f.kind='artifact'),0),
            COALESCE((SELECT b.files FROM craftmine_godot_builds b WHERE b.world_id=j.world_id
                AND b.build_id=j.build_id),0),
            ?1,?2
         FROM craftmine_godot_jobs j
         WHERE j.status IN ('passed','failed','cancelled','interrupted')",
        params![serde_json::to_string(&limits)?, worlds::timestamp()?],
    )?;
    Ok(changed)
}

fn valid_job_id(id: &str) -> Result<()> {
    ensure!(
        id.len() == 69 && id.starts_with("gjob-") && id[5..].bytes().all(|b| b.is_ascii_hexdigit()),
        "INVALID_GODOT_JOB"
    );
    Ok(())
}

pub(super) fn valid_candidate_id(id: &str) -> Result<()> {
    ensure!(
        id.len() == 69 && id.starts_with("gcan-") && id[5..].bytes().all(|b| b.is_ascii_hexdigit()),
        "INVALID_GODOT_CANDIDATE"
    );
    Ok(())
}

/// Reclaim leases whose executor died, and stop waiting forever for an executor
/// that never registered. Every expiry records a reason so the UI can explain
/// why a job ended instead of starting a doomed "resume".
pub(super) fn expire(db: &Connection) -> Result<()> {
    let now = worlds::timestamp()?;
    db.execute(
        "UPDATE craftmine_godot_jobs SET status='interrupted',run_token=NULL,executor_id=NULL,
            lease_expires_at=NULL,interrupt_reason='GODOT_LEASE_EXPIRED',updated_at=?1
         WHERE status IN ('claimed','running') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?1",
        [now],
    )?;
    db.execute(
        "UPDATE craftmine_godot_jobs SET status='interrupted',run_token=NULL,executor_id=NULL,
            lease_expires_at=NULL,interrupt_reason='GODOT_QUEUE_TIMEOUT',updated_at=?1
         WHERE status='queued' AND created_at < ?2",
        params![now, now - QUEUE_TIMEOUT_MILLIS],
    )?;
    settle_usage(db)?;
    Ok(())
}

pub(super) fn read_job(db: &Connection, id: &str) -> Result<Value> {
    valid_job_id(id)?;
    let (world_id, task_id, kind, build_id, revision, manifest, assets, base_id, base_build, status,
        blocked, executor, stage, progress, lease, output, output_hash, created, updated, interrupt,
        origin): (
        String, String, String, String, i64, String, String, String, String, String,
        Option<String>, Option<String>, Option<String>, i64, Option<i64>, Option<String>,
        Option<String>, i64, i64, Option<String>, Option<String>,
    ) = db
        .query_row(
            "SELECT world_id,task_id,kind,build_id,source_revision,manifest_hash,asset_manifest_hash,
                base_id,base_build,status,blocked_reason,executor_id,stage,progress,lease_expires_at,
                output,output_hash,created_at,updated_at,interrupt_reason,origin_job_id
             FROM craftmine_godot_jobs WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?,
                    row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?,
                    row.get(12)?, row.get(13)?, row.get(14)?, row.get(15)?, row.get(16)?, row.get(17)?,
                    row.get(18)?, row.get(19)?, row.get(20)?,
                ))
            },
        )
        .context("GODOT_JOB_NOT_FOUND")?;
    let output: Option<Value> = output
        .map(|body| {
            ensure!(
                Some(digest(&body)) == output_hash,
                "CORRUPT_GODOT_JOB_OUTPUT"
            );
            Ok(serde_json::from_str(&body)?)
        })
        .transpose()?;
    let candidate: Option<String> = db
        .query_row(
            "SELECT id FROM craftmine_godot_candidates WHERE check_job_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    let branch:Option<String>=db.query_row("SELECT branch_id FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",params![world_id,build_id],|r|r.get(0)).optional()?;
    let mut result = json!({"jobId":id,"worldId":world_id,"taskId":task_id,"kind":kind,"buildId":build_id,"branchId":branch,
        "sourceRevision":revision,"manifestHash":manifest,"assetManifestHash":assets,"baseId":base_id,
        "baseBuild":base_build,"status":status,"blockedReason":blocked,"executorId":executor,
        "stage":stage,"progress":progress,"leaseExpiresAt":lease,"output":output,
        "outputHash":output_hash,"candidateId":candidate,"createdAt":created,"updatedAt":updated,
        "interruptReason":interrupt,"originJobId":origin});
    requirements::attach(db, id, &mut result)?;
    Ok(result)
}

pub(super) fn build_files(
    db: &Connection,
    world: &str,
    build_id: &str,
    kind: &str,
) -> Result<Vec<Value>> {
    let mut statement = db.prepare(
        "SELECT path,kind,sha256,bytes FROM craftmine_godot_build_files WHERE world_id=?1 AND build_id=?2 AND kind=?3 ORDER BY path",
    )?;
    let rows = statement.query_map(params![world, build_id, kind], |row| {
        Ok(json!({"path":row.get::<_,String>(0)?,"kind":row.get::<_,String>(1)?,
            "sha256":row.get::<_,String>(2)?,"bytes":row.get::<_,i64>(3)?}))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn artifact_path(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty()
            && path.len() <= 240
            && path.split('/').count() <= 16
            && !path.starts_with('/')
            && !path.contains('\\'),
        "INVALID_GODOT_ARTIFACT"
    );
    for part in path.split('/') {
        ensure!(
            !part.is_empty()
                && part != "."
                && part != ".."
                && part.len() <= 80
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.')),
            "INVALID_GODOT_ARTIFACT"
        );
    }
    Ok(())
}

pub(super) fn verify_file(root: &std::path::Path, path: &str, hash: &str, bytes: u64, limit: u64, code: &str) -> Result<()> {
    artifact_path(path)?;
    super::godot_projects::valid_hash(hash)?;
    ensure!(bytes <= limit, "{code}");
    let mut current = root.to_path_buf();
    ensure!(super::godot_projects::ordinary(&current, code)?.is_dir(), "{code}");
    let parts: Vec<_> = path.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        let meta = super::godot_projects::ordinary(&current, code)?;
        if index + 1 < parts.len() { ensure!(meta.is_dir(), "{code}"); }
        else { ensure!(meta.is_file() && meta.len() == bytes, "{code}"); }
    }
    let mut file = godot_builds::open_read(&current)?.take(bytes + 1);
    let mut actual = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut total = 0u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        total += count as u64;
        actual.update(&buffer[..count]);
    }
    let digest: String = actual.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    ensure!(total == bytes && digest == hash, "{code}");
    Ok(())
}

fn verify_artifact(root: &std::path::Path, artifact: &Artifact) -> Result<()> {
    ensure!(artifact.bytes <= ARTIFACT_FILE_BYTES, "GODOT_ARTIFACT_TOO_LARGE");
    artifact_path(&artifact.path)?;
    let target = root.join(&artifact.path);
    super::godot_projects::ordinary(&target, "GODOT_ARTIFACT_MISSING")?;
    verify_file(root, &artifact.path, &artifact.sha256, artifact.bytes, ARTIFACT_FILE_BYTES, "CORRUPT_GODOT_ARTIFACT")
}

/// Recheck the persisted export allowlist before a trusted host serves it.
/// No directory listing may add files that were not in the verified job result.
pub(super) fn verified_artifacts(db: &Connection, world: &str, build: &str, root: &std::path::Path) -> Result<Vec<Value>> {
    let files = build_files(db, world, build, "artifact")?;
    ensure!(!files.is_empty() && files.len() <= ARTIFACT_COUNT, "GODOT_ARTIFACT_MISSING");
    let mut total = 0u64;
    let mut paths = std::collections::BTreeSet::new();
    let mut result = Vec::with_capacity(files.len());
    for file in files {
        let artifact = Artifact {
            path: file["path"].as_str().context("CORRUPT_GODOT_ARTIFACT")?.into(),
            sha256: file["sha256"].as_str().context("CORRUPT_GODOT_ARTIFACT")?.into(),
            bytes: file["bytes"].as_u64().context("CORRUPT_GODOT_ARTIFACT")?,
        };
        total = total.checked_add(artifact.bytes).context("GODOT_ARTIFACT_TOO_LARGE")?;
        ensure!(total <= ARTIFACT_TOTAL_BYTES, "GODOT_ARTIFACT_TOO_LARGE");
        ensure!(paths.insert(artifact.path.to_ascii_lowercase()), "GODOT_ARTIFACT_CONFLICT");
        verify_artifact(root, &artifact)?;
        result.push(serde_json::to_value(artifact)?);
    }
    Ok(result)
}

fn verify_project(db: &Connection, world: &str, build: &str, root: &std::path::Path) -> Result<()> {
    for kind in ["source", "asset", "host"] {
        for file in build_files(db, world, build, kind)? {
            verify_file(root, file["path"].as_str().context("CORRUPT_GODOT_BUILD")?,
                file["sha256"].as_str().context("CORRUPT_GODOT_BUILD")?,
                file["bytes"].as_u64().context("CORRUPT_GODOT_BUILD")?,
                4 * 1024 * 1024, "CORRUPT_GODOT_BUILD")?;
        }
    }
    Ok(())
}

/// Authority for the narrow exported-failed-check continuation. No caller
/// paths, old runtime verdicts, or executor ledger entries participate.
fn retained_export(db: &Connection, directory: &std::path::Path, record: &Value, executor: &Executor) -> Result<Value> {
    let Some(origin_id) = record["originJobId"].as_str() else { return Ok(Value::Null); };
    if record["kind"] != "check" { return Ok(Value::Null); }
    let origin = read_job(db, origin_id)?;
    let output = &origin["output"];
    if origin["status"] != "failed" || origin["kind"] != "check"
        || output["import"]["passed"] != true || output["compile"]["passed"] != true
        || output["check"]["passed"] != false
        || !output["artifacts"].as_array().is_some_and(|items| !items.is_empty()) {
        return Ok(Value::Null);
    }
    ensure!(output["format"] == "craftmine.godot-job-result/1" && output["passed"] == false
        && output["compile"]["errors"].as_array().is_some_and(Vec::is_empty), "GODOT_CONTINUATION_EXPORT_INVALID");
    for key in ["worldId","buildId","branchId","sourceRevision","manifestHash","assetManifestHash","baseId","baseBuild"] {
        ensure!(!record[key].is_null() && origin[key] == record[key], "GODOT_CONTINUATION_EXPORT_MISMATCH");
    }
    let world = record["worldId"].as_str().context("INVALID_GODOT_JOB")?;
    let build = record["buildId"].as_str().context("INVALID_GODOT_JOB")?;
    let task = super::read_task(db, record["taskId"].as_str().context("INVALID_GODOT_JOB")?)?;
    let original_task = super::read_task(db, origin["taskId"].as_str().context("INVALID_GODOT_JOB")?)?;
    ensure!(task.binding.project_id == original_task.binding.project_id && task.binding.session_id == original_task.binding.session_id,
        "GODOT_CONTINUATION_SCOPE_MISMATCH");
    scope(db, &WorkspaceContext {project_id:task.binding.project_id.clone(),session_id:task.binding.session_id.clone(),turn_id:task.binding.turn_id.clone()}, world, true)?;
    let (head, hash) = super::godot_projects::branch_head_manifest(db, world, record["branchId"].as_str().unwrap())?;
    let (assets, _) = godot_builds::asset_manifest(db, world)?;
    ensure!(record["sourceRevision"].as_u64() == Some(head.revision) && record["manifestHash"] == hash && record["assetManifestHash"] == assets,
        "GODOT_CONTINUATION_STALE");
    ensure!(output["engine"]["version"] == executor.engine_version && output["engine"]["isolation"] == executor.isolation
        && output["engine"]["evidenceHash"] == executor.evidence_hash, "GODOT_CONTINUATION_TOOLCHAIN_CHANGED");
    let origin_input: String = db.query_row("SELECT request_hash FROM craftmine_godot_jobs WHERE id=?1", [origin_id], |row|row.get(0))?;
    ensure!(output["inputHash"] == origin_input, "GODOT_CONTINUATION_EXPORT_INVALID");
    let root = build_root(directory, world, build, false)?;
    verify_project(db, world, build, &root.join("source"))?;
    let artifacts = verified_artifacts(db, world, build, &root.join("artifacts"))?;
    let mut expected = output["artifacts"].as_array().unwrap().clone();
    expected.sort_by(|a,b|a["path"].as_str().cmp(&b["path"].as_str()));
    ensure!(artifacts == expected && artifacts.iter().any(|a|a["path"]=="web/index.html"), "GODOT_CONTINUATION_ARTIFACT_MISMATCH");
    Ok(json!({"format":"craftmine.godot-retained-export/1","originJobId":origin_id,"originOutputHash":origin["outputHash"],
        "worldId":world,"buildId":build,"sourceRevision":record["sourceRevision"],"manifestHash":record["manifestHash"],
        "assetManifestHash":record["assetManifestHash"],"baseId":record["baseId"],"baseBuild":record["baseBuild"],
        "engine":output["engine"],"artifacts":artifacts}))
}

fn record_artifact(db: &Connection, world: &str, build_id: &str, artifact: &Artifact) -> Result<()> {
    let prior: Option<String> = db
        .query_row(
            "SELECT sha256 FROM craftmine_godot_build_files WHERE world_id=?1 AND build_id=?2 AND path=?3",
            params![world, build_id, artifact.path],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(hash) = prior {
        ensure!(hash == artifact.sha256, "GODOT_ARTIFACT_CONFLICT");
        return Ok(());
    }
    db.execute(
        "INSERT INTO craftmine_godot_build_files(world_id,build_id,path,kind,sha256,bytes) VALUES(?1,?2,?3,'artifact',?4,?5)",
        params![world, build_id, artifact.path, artifact.sha256, i64::try_from(artifact.bytes)?],
    )?;
    Ok(())
}

pub(super) fn read_candidate(db: &Connection, id: &str) -> Result<Value> {
    valid_candidate_id(id)?;
    let (world_id, build_id, revision, manifest, assets, base_id, base_build, check_job, check_hash,
        status, created, updated): (String, String, i64, String, String, String, String, String,
        Option<String>, String, i64, i64) = db
        .query_row(
            "SELECT world_id,build_id,source_revision,manifest_hash,asset_manifest_hash,base_id,
                base_build,check_job_id,check_output_hash,status,created_at,updated_at
             FROM craftmine_godot_candidates WHERE id=?1",
            [id],
            |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?,
                    row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?))
            },
        )
        .context("GODOT_CANDIDATE_NOT_FOUND")?;
    let (files, bytes): (i64, i64) = db.query_row(
        "SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM craftmine_godot_build_files WHERE world_id=?1 AND build_id=?2",
        params![world_id, build_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let content: Option<(String,String,String)> = db.query_row(
        "SELECT r.repo_id,b.content_oid,b.branch_id FROM craftmine_godot_builds b
         JOIN craftmine_content_repositories r ON r.world_id=b.world_id
         WHERE b.world_id=?1 AND b.build_id=?2 AND b.content_oid IS NOT NULL AND r.backend='git'",
        params![world_id,build_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
    let content = content.map(|(repo_id,content_oid,branch)| json!({"repoId":repo_id,"branchId":branch,"contentOid":content_oid}));
    Ok(json!({"candidateId":id,"worldId":world_id,"buildId":build_id,"sourceRevision":revision,"content":content,
        "manifestHash":manifest,"assetManifestHash":assets,"baseId":base_id,"baseBuild":base_build,
        "checkJobId":check_job,"checkOutputHash":check_hash,"status":status,"buildFiles":files,
        "buildBytes":bytes,"createdAt":created,"updatedAt":updated}))
}

/// A candidate is only applicable while its exact source revision is still the
/// project head; a newer patch makes it stale instead of silently applicable.
pub(super) fn require_ready_candidate(
    db: &Connection,
    id: &str,
    world_id: &str,
) -> Result<Value> {
    let candidate = read_candidate(db, id)?;
    ensure!(
        candidate["worldId"] == world_id,
        "PROJECT_WORLD_BINDING_MISMATCH"
    );
    ensure!(candidate["status"] == "ready", "GODOT_CANDIDATE_NOT_READY");
    let job = read_job(db, candidate["checkJobId"].as_str().context("INVALID_GODOT_JOB")?)?;
    ensure!(
        job["status"] == "passed" && job["outputHash"] == candidate["checkOutputHash"],
        "GODOT_CANDIDATE_NOT_READY"
    );
    let (manifest,hash)=super::godot_projects::branch_head_manifest(db,world_id,candidate["content"]["branchId"].as_str().unwrap_or("main"))
        .context("GODOT_CANDIDATE_STALE")?;
    let revision=i64::try_from(manifest.revision)?;
    ensure!(
        i64::try_from(candidate["sourceRevision"].as_u64().unwrap_or(u64::MAX)).ok() == Some(revision)
            && candidate["manifestHash"].as_str() == Some(hash.as_str()),
        "GODOT_CANDIDATE_STALE"
    );
    let (assets, _) = godot_builds::asset_manifest(db, world_id)?;
    ensure!(candidate["assetManifestHash"] == assets, "GODOT_CANDIDATE_STALE");
    // On the managed Git backend a candidate is also stale when the commit it
    // was built from is no longer the commit the revision maps to.
    let current_commit = super::godot_projects::git_commit_for(
        db,
        world_id,
        candidate["sourceRevision"].as_u64().unwrap_or(u64::MAX),
    )?;
    if let Some(current_commit) = current_commit {
        let built: Option<String> = db
            .query_row(
                "SELECT content_oid FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
                params![
                    world_id,
                    candidate["buildId"].as_str().context("INVALID_GODOT_BUILD")?
                ],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        ensure!(
            built.as_deref() == Some(current_commit.as_str()),
            "GODOT_CANDIDATE_STALE"
        );
    }
    Ok(candidate)
}

impl TaskJournal {
    /// Live capability status for the private host. Availability never survives
    /// a core restart, so the host must re-attest after every restart instead of
    /// the UI remembering a stale "available".
    pub fn godot_executor_status(&self) -> Value {
        let (build, build_reason) = self.execution_gate("build");
        let (check, check_reason) = self.execution_gate("check");
        let executors: Vec<Value> = self
            .executors
            .iter()
            .map(|(id, executor)| {
                json!({"executorId":id,"engineVersion":executor.engine_version,
                    "isolation":executor.isolation,"evidenceHash":executor.evidence_hash,
                    "capabilities":executor.capabilities,"registeredAt":executor.registered_at})
            })
            .collect();
        json!({"format":"craftmine.godot-execution-status/1","engineVersion":engine_version(),
            "build":build,"check":check,"buildBlockedReason":build_reason,
            "checkBlockedReason":check_reason,"executors":executors})
    }

    /// Drop one executor and interrupt only the jobs it owned. Revocation is not
    /// a restart: unrelated jobs and other executors keep running.
    pub fn godot_executor_revoke(&mut self, args: &Value) -> Result<Value> {
        let args: RevokeArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.executor_id)?;
        let removed = self.executors.remove(&args.executor_id).is_some();
        let interrupted = self.db.execute(
            "UPDATE craftmine_godot_jobs SET status='interrupted',run_token=NULL,executor_id=NULL,
                lease_expires_at=NULL,interrupt_reason='GODOT_EXECUTOR_REVOKED',updated_at=?2
             WHERE executor_id=?1 AND status IN ('claimed','running')",
            params![args.executor_id, worlds::timestamp()?],
        )?;
        settle_usage(&self.db)?;
        Ok(json!({"executorId":args.executor_id,"revoked":removed,"interrupted":interrupted,
            "executionAvailable":self.execution_gate("build").0}))
    }

    /// Resolve only a live worker's staged exports for an isolated runtime
    /// check. This neither registers artifacts nor makes a candidate ready, so a
    /// half-finished build can never become appliable.
    pub fn godot_job_check_descriptor(&mut self, args: &Value) -> Result<Value> {
        let args: CheckDescriptorArgs = serde_json::from_value(args.clone())?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        let (world, build, record) = owned_job(&tx, &args.job_id, &args.token)?;
        ensure!(
            matches!(record["status"].as_str(), Some("claimed" | "running")),
            "GODOT_JOB_INACTIVE"
        );
        ensure!(record["kind"] == "check", "GODOT_RUNTIME_CHECK_REQUIRED");
        let executor = self
            .executors
            .get(record["executorId"].as_str().unwrap_or_default())
            .context("GODOT_EXECUTOR_UNAVAILABLE")?;
        ensure!(
            executor.capabilities["check"] == json!(true),
            "GODOT_EXECUTOR_CAPABILITY_MISSING"
        );
        let retained = retained_export(&tx, &self.directory, &record, executor)?;
        if !retained.is_null() {
            ensure!(retained["artifacts"] == serde_json::to_value(&args.artifacts)?, "GODOT_CONTINUATION_ARTIFACT_MISMATCH");
        }
        let root = build_root(&self.directory, &world, &build, false)?;
        verify_project(&tx, &world, &build, &root.join("source"))?;
        let root = root.join("artifacts");
        ensure!(
            !args.artifacts.is_empty() && args.artifacts.len() <= ARTIFACT_COUNT,
            "GODOT_ARTIFACT_MISSING"
        );
        let mut paths = std::collections::HashSet::new();
        let mut bytes = 0u64;
        for artifact in &args.artifacts {
            bytes = bytes
                .checked_add(artifact.bytes)
                .context("GODOT_ARTIFACT_TOO_LARGE")?;
            ensure!(bytes <= ARTIFACT_TOTAL_BYTES, "GODOT_ARTIFACT_TOO_LARGE");
            ensure!(
                paths.insert(artifact.path.to_ascii_lowercase()),
                "GODOT_ARTIFACT_CONFLICT"
            );
            verify_artifact(&root, artifact)?;
        }
        ensure!(paths.contains("web/index.html"), "GODOT_WEB_ENTRY_MISSING");
        let input_hash: String = tx.query_row(
            "SELECT request_hash FROM craftmine_godot_jobs WHERE id=?1",
            [&args.job_id],
            |row| row.get(0),
        )?;
        let current = worlds::read(&tx, &world)?;
        let snapshot = if current.world.snapshot["format"] == super::godot_runtime::PROGRESS_FORMAT {
            ensure!(
                current.world.snapshot["baseId"] == record["baseId"],
                "GODOT_PROGRESS_BASE_MISMATCH"
            );
            current.world.snapshot
        } else {
            Value::Null
        };
        let mut result = json!({"format":"craftmine.godot-check-descriptor/1","phase":"check",
            "jobId":args.job_id,"inputHash":input_hash,"worldId":world,"buildId":build,
            "baseId":record["baseId"],"root":root.to_string_lossy(),"entry":"web/index.html",
            "threads":true,"artifacts":args.artifacts,"snapshot":snapshot});
        requirements::attach(&tx, &args.job_id, &mut result)?;
        let previous: Option<String> = tx.query_row("SELECT check_input FROM craftmine_godot_jobs WHERE id=?1", [&args.job_id], |r| r.get(0))?;
        if previous.is_some() {
            let existing = check_input(&tx, &args.job_id)?;
            let mut identity = result.clone();
            identity["snapshot"] = existing["snapshot"].clone();
            ensure!(existing == identity, "GODOT_CHECK_INPUT_MISMATCH");
            tx.commit()?;
            return Ok(existing);
        }
        let body = serde_json::to_string(&result)?;
        tx.execute("UPDATE craftmine_godot_jobs SET check_input=?2,check_input_hash=?3 WHERE id=?1",
            params![args.job_id, body, digest(&body)])?;
        tx.commit()?;
        Ok(result)
    }

    /// Continue a historical draft in a new execution. The original job, task and
    /// draft stay untouched; the new job records its origin so cumulative
    /// accounting spans the whole chain. A moved source or a formal world that
    /// changed base is a conflict, never a silent rebase.
    pub fn godot_job_continue(&mut self, args: &Value) -> Result<Value> {
        let args: ContinueArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.tool_call_id)?;
        let (queued, blocked_reason) = {
            let origin = read_job(&self.db, &args.origin_job_id)?;
            let kind = origin["kind"].as_str().context("INVALID_GODOT_JOB")?;
            (self.execution_gate(kind).0, self.execution_gate(kind).1)
        };
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        let origin = read_job(&tx, &args.origin_job_id)?;
        ensure!(origin["worldId"] == args.world_id, "PROJECT_WORLD_BINDING_MISMATCH");
        ensure!(
            matches!(origin["status"].as_str(), Some("interrupted" | "cancelled" | "failed")),
            "GODOT_JOB_NOT_CONTINUABLE"
        );
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        let task = workspace.task.binding.task_id.clone();
        let request_hash = digest(&serde_json::to_string(&json!({
            "worldId":args.world_id,"originJobId":args.origin_job_id,"toolCallId":args.tool_call_id
        }))?);
        // A repeated call replays the stored job instead of queuing a second one.
        let prior: Option<String> = tx
            .query_row(
                "SELECT id FROM craftmine_godot_jobs WHERE task_id=?1 AND tool_call_id=?2",
                params![task, args.tool_call_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(prior) = prior {
            let stored: String = tx.query_row(
                "SELECT request_hash FROM craftmine_godot_jobs WHERE id=?1",
                [&prior],
                |row| row.get(0),
            )?;
            ensure!(stored == request_hash, "REPLAY_MISMATCH");
            let mut result = read_job(&tx, &prior)?;
            result["replayed"] = json!(true);
            tx.commit()?;
            return Ok(result);
        }
        // The draft being continued must still be the current project head.
        let (manifest, manifest_hash) = super::godot_projects::branch_head_manifest(&tx, &args.world_id,origin["branchId"].as_str().unwrap_or("main"))?;
        let (asset_hash, _) = godot_builds::asset_manifest(&tx, &args.world_id)?;
        ensure!(
            origin["sourceRevision"].as_u64() == Some(manifest.revision)
                && origin["manifestHash"].as_str() == Some(manifest_hash.as_str())
                && origin["assetManifestHash"].as_str() == Some(asset_hash.as_str()),
            "GODOT_CONTINUATION_STALE"
        );
        // The formal world must still be on the base this draft was authored on.
        let world = worlds::read(&tx, &args.world_id)?;
        let lineage = world.world.build["godot"]["baseBuild"].as_str();
        ensure!(
            manifest.base_build == workspace.task.binding.base_build
                || lineage == Some(manifest.base_build.as_str()),
            "WORLD_BUILD_CONFLICT"
        );
        let kind = origin["kind"].as_str().context("INVALID_GODOT_JOB")?;
        // The origin's immutable build copy may have been reclaimed after the job
        // ended. Continuing then would queue a job that can only fail at claim,
        // so say it plainly instead.
        let build_exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2)",
            params![args.world_id, origin["buildId"].as_str().unwrap_or_default()],
            |row| row.get(0),
        )?;
        ensure!(build_exists, "GODOT_CONTINUATION_BUILD_GONE");
        // Fail an unusable retained export at the ordinary resume call when
        // its executor is available. Claim/check/finish repeat the validation.
        if let Some(executor) = self.executors.get(origin["executorId"].as_str().unwrap_or_default()) {
            let mut prospective = origin.clone();
            prospective["originJobId"] = json!(args.origin_job_id);
            prospective["taskId"] = json!(task);
            retained_export(&tx, &self.directory, &prospective, executor)?;
        }
        let job_id = format!(
            "gjob-{}",
            digest(&format!(
                "craftmine.godot-job/1|{}|{}|{}",
                args.world_id, task, args.tool_call_id
            ))
        );
        let status = if queued { "queued" } else { "blocked" };
        let now = worlds::timestamp()?;
        tx.execute(
            "INSERT INTO craftmine_godot_jobs(id,world_id,task_id,tool_call_id,kind,build_id,
                source_revision,manifest_hash,asset_manifest_hash,base_id,base_build,request_hash,
                status,blocked_reason,progress,created_at,updated_at,origin_job_id)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0,?15,?15,?16)",
            params![job_id, args.world_id, task, args.tool_call_id, kind,
                origin["buildId"].as_str(), origin["sourceRevision"].as_i64(),
                origin["manifestHash"].as_str(), origin["assetManifestHash"].as_str(),
                origin["baseId"].as_str(), origin["baseBuild"].as_str(), request_hash,
                status, blocked_reason, now, args.origin_job_id],
        )?;
        requirements::store(&tx, &job_id, requirements::read(&tx, &args.origin_job_id)?.as_ref())?;
        let mut result = read_job(&tx, &job_id)?;
        result["executionAvailable"] = json!(queued);
        result["blockedReason"] = json!(blocked_reason);
        result["replayed"] = json!(false);
        tx.commit()?;
        Ok(result)
    }

    /// Cumulative accounting for one world, including continued executions.
    /// Only core-measurable values are reported; model-side counters stay null
    /// and are listed under `unknown`.
    pub fn godot_usage_summary(&self, args: &Value) -> Result<Value> {
        let args: UsageArgs = serde_json::from_value(args.clone())?;
        world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        settle_usage(&self.db)?;
        let mut statement = self.db.prepare(
            "SELECT job_id,task_id,origin_job_id,kind,outcome,wall_clock_ms,source_bytes,asset_bytes,
                host_bytes,artifact_bytes,artifact_count,build_files,recorded_at
             FROM craftmine_godot_job_usage WHERE world_id=?1 ORDER BY recorded_at,job_id",
        )?;
        let rows = statement.query_map([&args.world_id], |row| {
            Ok(json!({
                "jobId":row.get::<_,String>(0)?,"taskId":row.get::<_,String>(1)?,
                "originJobId":row.get::<_,Option<String>>(2)?,"kind":row.get::<_,String>(3)?,
                "outcome":row.get::<_,String>(4)?,"wallClockMillis":row.get::<_,i64>(5)?,
                "sourceBytes":row.get::<_,i64>(6)?,"assetBytes":row.get::<_,i64>(7)?,
                "hostBytes":row.get::<_,i64>(8)?,"artifactBytes":row.get::<_,i64>(9)?,
                "artifactCount":row.get::<_,i64>(10)?,"buildFiles":row.get::<_,i64>(11)?,
                "recordedAt":row.get::<_,i64>(12)?
            }))
        })?;
        let items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut totals = json!({"executions":items.len(),"wallClockMillis":0,"sourceBytes":0,
            "assetBytes":0,"hostBytes":0,"artifactBytes":0,"artifactCount":0});
        for item in &items {
            for (target, source) in [
                ("wallClockMillis", "wallClockMillis"), ("sourceBytes", "sourceBytes"),
                ("assetBytes", "assetBytes"), ("hostBytes", "hostBytes"),
                ("artifactBytes", "artifactBytes"), ("artifactCount", "artifactCount"),
            ] {
                let sum = totals[target].as_i64().unwrap_or(0) + item[source].as_i64().unwrap_or(0);
                totals[target] = json!(sum);
            }
        }
        let limits: Option<String> = self
            .db
            .query_row(
                "SELECT limits FROM craftmine_godot_job_usage WHERE world_id=?1 ORDER BY recorded_at DESC LIMIT 1",
                [&args.world_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(json!({"format":"craftmine.godot-usage/1","worldId":args.world_id,"items":items,
            "totals":totals,"limits":limits.map(|body| serde_json::from_str::<Value>(&body)).transpose()?,
            "unknown":UNKNOWN_USAGE_FIELDS}))
    }

    /// Capability gate. Only an attested, matching executor may run a job, and a
    /// capable executor must not be masked by an earlier, less capable one.
    pub(super) fn execution_gate(&self, kind: &str) -> (bool, Option<&'static str>) {
        let mut registered = false;
        for executor in self.executors.values() {
            if executor.engine_version != engine_version() {
                continue;
            }
            registered = true;
            let capability = match kind {
                "check" => executor.capabilities["check"] == json!(true),
                _ => executor.capabilities["build"] == json!(true),
            };
            if capability && executor.capabilities["import"] == json!(true) {
                return (true, None);
            }
        }
        if registered {
            (false, Some("GODOT_EXECUTOR_CAPABILITY_MISSING"))
        } else {
            (false, Some("GODOT_EXECUTION_UNAVAILABLE"))
        }
    }

    pub fn godot_executor_register(&mut self, args: &Value) -> Result<Value> {
        let args: RegisterArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.executor_id)?;
        ensure!(
            args.attestation.format == "craftmine.godot-executor/1"
                && !args.attestation.isolation.trim().is_empty()
                && args.attestation.isolation.len() <= 60
                && args.attestation.engine_version == engine_version(),
            "INVALID_EXECUTOR_ATTESTATION"
        );
        ensure!(
            args.attestation.evidence_hash.len() == 64
                && args
                    .attestation
                    .evidence_hash
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit()),
            "INVALID_EXECUTOR_ATTESTATION"
        );
        let now = worlds::timestamp()?;
        let attestation_hash = digest(&serde_json::to_string(&json!({
            "format":args.attestation.format,"isolation":args.attestation.isolation,
            "evidenceHash":args.attestation.evidence_hash,"engineVersion":args.attestation.engine_version,
            "capabilities":{"import":args.attestation.capabilities.import,
                "build":args.attestation.capabilities.build,"check":args.attestation.capabilities.check}
        }))?);
        self.executors.insert(
            args.executor_id.clone(),
            Executor {
                engine_version: args.attestation.engine_version.clone(),
                isolation: args.attestation.isolation.clone(),
                evidence_hash: args.attestation.evidence_hash.clone(),
                capabilities: json!({"import":args.attestation.capabilities.import,
                    "build":args.attestation.capabilities.build,"check":args.attestation.capabilities.check}),
                registered_at: now,
            },
        );
        // Jobs that were blocked only because no executor existed become runnable.
        let promoted = self.db.execute(
            "UPDATE craftmine_godot_jobs SET status='queued',blocked_reason=NULL,updated_at=?1
             WHERE status='blocked' AND blocked_reason='GODOT_EXECUTION_UNAVAILABLE'",
            [now],
        )?;
        Ok(json!({"executorId":args.executor_id,"registered":true,"executionAvailable":true,
            "attestationHash":attestation_hash,"isolation":args.attestation.isolation,
            "engineVersion":args.attestation.engine_version,
            "registeredAt":self.executors.get(&args.executor_id).map(|executor| executor.registered_at).unwrap_or(now),
            "promotedJobs":promoted}))
    }

    pub fn godot_job_claim(&mut self, args: &Value) -> Result<Value> {
        let args: ClaimArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.token)?;
        let executor = self
            .executors
            .get(&args.executor_id)
            .cloned()
            .context("GODOT_EXECUTOR_UNAVAILABLE")?;
        ensure!(
            executor.engine_version == engine_version(),
            "GODOT_EXECUTOR_UNAVAILABLE"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        let record = read_job(&tx, &args.job_id)?;
        ensure!(
            record["status"] == "queued",
            if record["status"] == "blocked" {
                "GODOT_EXECUTION_UNAVAILABLE"
            } else {
                "GODOT_JOB_INACTIVE"
            }
        );
        let kind = record["kind"].as_str().context("INVALID_GODOT_JOB")?;
        ensure!(
            match kind {
                "check" => executor.capabilities["check"] == json!(true),
                _ => executor.capabilities["build"] == json!(true),
            } && executor.capabilities["import"] == json!(true),
            "GODOT_EXECUTOR_CAPABILITY_MISSING"
        );
        let world = record["worldId"].as_str().context("INVALID_GODOT_JOB")?;
        worlds::assert_not_archived(&tx, world)?;
        let build = record["buildId"].as_str().context("INVALID_GODOT_JOB")?;
        let root = build_root(&self.directory, world, build, false)?.join("source");
        verify_project(&tx, world, build, &root)?;
        let cache = build_root(&self.directory, world, build, true)?.join("cache");
        let artifacts = build_root(&self.directory, world, build, true)?.join("artifacts");
        let retained = retained_export(&tx, &self.directory, &record, &executor)?;
        for path in [&cache, &artifacts] {
            if !path.try_exists()? {
                match std::fs::create_dir(path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
            }
            ensure!(
                super::godot_projects::ordinary(path, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
                "GODOT_STORAGE_UNAVAILABLE"
            );
        }
        let now = worlds::timestamp()?;
        let lease = now + LEASE_MILLIS;
        tx.execute(
            "UPDATE craftmine_godot_jobs SET status='claimed',run_token=?2,executor_id=?3,
                stage='claimed',lease_expires_at=?4,updated_at=?5 WHERE id=?1 AND status='queued'",
            params![args.job_id, args.token, args.executor_id, lease, now],
        )?;
        let mut description = read_job(&tx, &args.job_id)?;
        description["projectRoot"] = json!(root.to_string_lossy());
        description["cacheRoot"] = json!(cache.to_string_lossy());
        description["artifactsRoot"] = json!(artifacts.to_string_lossy());
        description["token"] = json!(args.token);
        description["engineVersion"] = json!(executor.engine_version);
        description["isolation"] = json!(executor.isolation);
        description["evidenceHash"] = json!(executor.evidence_hash);
        if record["originJobId"].is_string() { description["retainedExport"] = retained; }
        description["inputHash"] = json!(tx.query_row(
            "SELECT request_hash FROM craftmine_godot_jobs WHERE id=?1",
            [&args.job_id],
            |row| row.get::<_, String>(0),
        )?);
        description["files"] = json!({
            "source":build_files(&tx, world, build, "source")?,
            "asset":build_files(&tx, world, build, "asset")?,
            "host":build_files(&tx, world, build, "host")?
        });
        tx.commit()?;
        Ok(description)
    }

    pub fn godot_job_progress(&mut self, args: &Value) -> Result<Value> {
        let args: ProgressArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.token)?;
        ensure!(
            !args.stage.is_empty() && args.stage.len() <= 60 && args.percent <= 100,
            "INVALID_GODOT_PROGRESS"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        let (_, _, record) = owned_job(&tx, &args.job_id, &args.token)?;
        ensure!(
            matches!(record["status"].as_str(), Some("claimed" | "running")),
            "GODOT_JOB_INACTIVE"
        );
        let previous = record["progress"].as_u64().unwrap_or(0);
        ensure!(
            u64::from(args.percent) >= previous,
            "INVALID_GODOT_PROGRESS"
        );
        let now = worlds::timestamp()?;
        tx.execute(
            "UPDATE craftmine_godot_jobs SET status='running',stage=?2,progress=?3,
                lease_expires_at=?4,updated_at=?5 WHERE id=?1",
            params![args.job_id, args.stage, i64::from(args.percent), now + LEASE_MILLIS, now],
        )?;
        let updated = read_job(&tx, &args.job_id)?;
        tx.commit()?;
        Ok(json!({"jobId":args.job_id,"status":updated["status"],"stage":args.stage,
            "progress":args.percent,"leaseExpiresAt":updated["leaseExpiresAt"]}))
    }

    pub fn godot_job_heartbeat(&mut self, args: &Value) -> Result<Value> {
        let args: TokenArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.token)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        let (_, _, record) = owned_job(&tx, &args.job_id, &args.token)?;
        ensure!(
            matches!(record["status"].as_str(), Some("claimed" | "running")),
            "GODOT_JOB_INACTIVE"
        );
        let lease = worlds::timestamp()? + LEASE_MILLIS;
        tx.execute(
            "UPDATE craftmine_godot_jobs SET lease_expires_at=?2,updated_at=?3 WHERE id=?1",
            params![args.job_id, lease, worlds::timestamp()?],
        )?;
        tx.commit()?;
        Ok(json!({"jobId":args.job_id,"status":record["status"],"leaseExpiresAt":lease}))
    }

    /// Record the executor's real result. A cancelled or interrupted job rejects
    /// the late result instead of reviving itself or touching the world. The
    /// claiming token is retained so a lost response can be answered from the
    /// stored receipt without re-running anything.
    pub fn godot_job_finish(&mut self, args: &Value) -> Result<Value> {
        let mut args: FinishArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.token)?;
        ensure!(
            args.output.format == "craftmine.godot-job-result/1",
            "INVALID_GODOT_JOB_RESULT"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        // A cancelled or interrupted job reports its own state; a late result
        // must never be able to discover the outcome as an owner mismatch.
        let status = read_job(&tx, &args.job_id)?["status"].clone();
        ensure!(
            matches!(
                status.as_str(),
                Some("claimed" | "running" | "passed" | "failed")
            ),
            "GODOT_JOB_INACTIVE"
        );
        let (world, build, record) = owned_job(&tx, &args.job_id, &args.token)?;
        let kind = record["kind"].as_str().context("INVALID_GODOT_JOB")?.to_string();
        let task = record["taskId"].as_str().context("INVALID_GODOT_JOB")?.to_string();
        let mut requirements_unconfirmed = false;
        // Normalize before comparing terminal receipts, so replaying the same
        // executor submission returns the same durable failed result.
        if let Some(required) = requirements::read(&tx, &args.job_id)? {
            let required_assertions: Vec<_> = args.output.check.assertions.iter()
                .filter(|a| a.id == required.assertion()).collect();
            let descriptor = check_input(&tx, &args.job_id).ok();
            let accepted = required_assertions.len() == 1 && required_assertions[0].passed
                && descriptor.as_ref().is_some_and(|descriptor|
                    descriptor["jobId"] == args.job_id && descriptor["worldId"] == world
                    && descriptor["buildId"] == build && descriptor["inputHash"] == args.output.input_hash
                    && descriptor["artifacts"] == serde_json::to_value(&args.output.artifacts).unwrap_or(Value::Null)
                    && requirements::evidence_matches(&required, args.output.check.requirements_evidence.as_ref(), descriptor));
            args.output.check.assertions.push(Assertion { id: if required.assertion()=="runtime.creation-requirements" {"core.creation-requirements"} else {"core.target-feedback"}.into(),
                passed: accepted, detail: Some(if accepted { "bound runtime expectation confirmed" }
                    else { "GODOT_CHECK_REQUIREMENTS_UNCONFIRMED" }.into()) });
            if !accepted {
                requirements_unconfirmed = true;
                args.output.passed = false;
                args.output.check.passed = false;
            }
        }
        if matches!(
            record["status"].as_str(),
            Some("passed" | "failed")
        ) {
            let body = serde_json::to_string(&args.output)?;
            ensure!(
                record["outputHash"].as_str() == Some(digest(&body).as_str()),
                "REPLAY_MISMATCH"
            );
            return Ok(record);
        }
        ensure!(
            matches!(record["status"].as_str(), Some("claimed" | "running")),
            "GODOT_JOB_INACTIVE"
        );
        let request_hash: String = tx.query_row(
            "SELECT request_hash FROM craftmine_godot_jobs WHERE id=?1",
            [&args.job_id],
            |row| row.get(0),
        )?;
        ensure!(
            args.output.input_hash == request_hash,
            "GODOT_JOB_INPUT_MISMATCH"
        );
        let executor = self
            .executors
            .get(record["executorId"].as_str().unwrap_or_default())
            .cloned()
            .context("GODOT_EXECUTOR_UNAVAILABLE")?;
        ensure!(
            args.output.engine.version == executor.engine_version
                && args.output.engine.evidence_hash == executor.evidence_hash
                && !args.output.engine.isolation.trim().is_empty(),
            "GODOT_EXECUTOR_MISMATCH"
        );
        // Failure settlements without artifacts keep their own error. A result
        // referring to retained bytes must still match live native provenance.
        if !args.output.artifacts.is_empty() {
            let retained = retained_export(&tx, &self.directory, &record, &executor)?;
            if !retained.is_null() {
                ensure!(retained["artifacts"] == serde_json::to_value(&args.output.artifacts)?, "GODOT_CONTINUATION_ARTIFACT_MISMATCH");
                let descriptor = check_input(&tx, &args.job_id)?;
                ensure!(descriptor["jobId"] == args.job_id && descriptor["inputHash"] == args.output.input_hash
                    && descriptor["artifacts"] == retained["artifacts"], "GODOT_CHECK_INPUT_MISMATCH");
            }
        }
        if kind == "check" {
            ensure!(
                !args.output.check.assertions.is_empty(),
                "GODOT_CHECK_ASSERTIONS_REQUIRED"
            );
        }
        let passed = args.output.passed
            && args.output.import.passed
            && args.output.compile.passed
            && args.output.compile.errors.is_empty()
            && args.output.check.passed
            && args.output.check.assertions.iter().all(|assertion| assertion.passed);
        match (&args.output.check.defaults_snapshot, &args.output.check.progress_migration) {
            (None, None) => {},
            (Some(defaults), Some(proof)) => {
                // A failed requirement still settles durably. Migration evidence
                // is retained but can only authorize application on a passed check.
                ensure!(kind == "check" && (passed || requirements_unconfirmed), "GODOT_ADDITIVE_CHECK_REQUIRED");
                let descriptor = check_input(&tx, &args.job_id)?;
                ensure!(descriptor["worldId"] == world && descriptor["buildId"] == build
                    && descriptor["inputHash"] == request_hash && defaults["worldId"] == world
                    && defaults["baseId"] == record["baseId"]
                    && descriptor["artifacts"] == serde_json::to_value(&args.output.artifacts)?, "GODOT_CHECK_INPUT_MISMATCH");
                super::godot_applications::additive_progress::verify_proof(&descriptor["snapshot"], defaults, proof)?;
            },
            _ => anyhow::bail!("GODOT_ADDITIVE_INVALID_PROOF"),
        }
        let artifacts_root = build_root(&self.directory, &world, &build, false)?.join("artifacts");
        ensure!(args.output.artifacts.len() <= ARTIFACT_COUNT, "GODOT_ARTIFACT_TOO_LARGE");
        let mut total = 0u64;
        let mut paths = std::collections::HashSet::new();
        for artifact in &args.output.artifacts {
            total = total.checked_add(artifact.bytes).context("GODOT_ARTIFACT_TOO_LARGE")?;
            ensure!(total <= ARTIFACT_TOTAL_BYTES, "GODOT_ARTIFACT_TOO_LARGE");
            ensure!(paths.insert(artifact.path.to_ascii_lowercase()), "GODOT_ARTIFACT_CONFLICT");
        }
        for artifact in &args.output.artifacts {
            verify_artifact(&artifacts_root, artifact)?;
        }
        for artifact in &args.output.artifacts {
            record_artifact(&tx, &world, &build, artifact)?;
        }
        let body = serde_json::to_string(&args.output)?;
        ensure!(body.len() <= 2 * 1024 * 1024, "GODOT_JOB_OUTPUT_TOO_LARGE");
        let now = worlds::timestamp()?;
        let status = if passed { "passed" } else { "failed" };
        tx.execute(
            "UPDATE craftmine_godot_jobs SET status=?2,output=?3,output_hash=?4,
                lease_expires_at=NULL,stage=?5,progress=100,updated_at=?6 WHERE id=?1",
            params![args.job_id, status, body, digest(&body), status, now],
        )?;
        let mut candidate_id = None;
        if kind == "check" {
            let id = format!(
                "gcan-{}",
                digest(&format!(
                    "craftmine.godot-candidate/1|{}|{}|{}",
                    world, build, args.job_id
                ))
            );
            tx.execute(
                "INSERT OR IGNORE INTO craftmine_godot_candidates(id,world_id,build_id,source_revision,
                    manifest_hash,asset_manifest_hash,base_id,base_build,check_job_id,check_output_hash,
                    status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
                params![id, world, build, record["sourceRevision"].as_i64().unwrap_or(0),
                    record["manifestHash"].as_str().unwrap_or_default(),
                    record["assetManifestHash"].as_str().unwrap_or_default(),
                    record["baseId"].as_str().unwrap_or_default(),
                    record["baseBuild"].as_str().unwrap_or_default(), args.job_id, digest(&body),
                    if passed { "ready" } else { "rejected" }, now],
            )?;
            if passed {
                tx.execute(
                    "UPDATE craftmine_godot_candidates SET status='superseded',updated_at=?2
                     WHERE world_id=?1 AND status='ready' AND id<>?3
                     AND build_id IN (SELECT build_id FROM craftmine_godot_builds WHERE world_id=?1 AND branch_id=?4)",
                    params![world, now, id,record["branchId"].as_str().unwrap_or("main")],
                )?;
            }
            candidate_id = Some(id);
        }
        let mut result = read_job(&tx, &args.job_id)?;
        result["candidateId"] = json!(candidate_id);
        result["taskId"] = json!(task);
        settle_usage(&tx)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn godot_candidate_read(&self, args: &Value) -> Result<Value> {
        let args: CandidateReadArgs = serde_json::from_value(args.clone())?;
        world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        let candidate = read_candidate(&self.db, &args.candidate_id)?;
        ensure!(
            candidate["worldId"] == args.world_id,
            "PROJECT_WORLD_BINDING_MISMATCH"
        );
        let job = read_job(&self.db, candidate["checkJobId"].as_str().context("INVALID_GODOT_JOB")?)?;
        // A maintenance deployment can succeed the player's adopted candidate.
        // Keep the durable adoption fact separate from the currently displayed
        // build; never offer an applied historical candidate as a fresh result.
        let formal = self.world_read(&args.world_id)?;
        let current_build = formal.world.build["id"].as_str().context("BUILD_ID_REQUIRED")?;
        let was_applied = candidate["status"] == "applied";
        let mut in_current_lineage = was_applied && candidate["buildId"] == current_build;
        if was_applied && !in_current_lineage && self.is_git_backed(&args.world_id)? {
            let (store, layout) = self.content_layout(&args.world_id)?;
            let current_oid: Option<String> = self.db.query_row(
                "SELECT content_oid FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
                params![&args.world_id,current_build], |row| row.get(0)).optional()?.flatten();
            if let (Some(candidate_oid), Some(current_oid)) = (candidate["content"]["contentOid"].as_str(), current_oid) {
                if store.applied(&layout, &args.world_id)?.as_deref() == Some(current_oid.as_str()) {
                    in_current_lineage = store.git().is_ancestor(&layout.git_dir, candidate_oid, &current_oid)?;
                }
            }
        }
        Ok(json!({"candidate":candidate,"check":job["output"]["check"],"job":job["output"],
            "checkStatus":job["status"],"buildId":candidate["buildId"],
            "adoption":{"worldId":args.world_id,"candidateId":args.candidate_id,"buildId":candidate["buildId"],
                "currentBuildId":current_build,"wasApplied":was_applied,"inCurrentLineage":in_current_lineage}}))
    }

    pub fn godot_candidate_list(&self, args: &Value) -> Result<Value> {
        let args: CandidateListArgs = serde_json::from_value(args.clone())?;
        world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        ensure!(args.limit > 0 && args.limit <= 32, "INVALID_PROJECT_PAGE");
        let ids: Vec<String> = self
            .db
            .prepare("SELECT id FROM craftmine_godot_candidates WHERE world_id=?1 ORDER BY created_at DESC,id DESC LIMIT ?2 OFFSET ?3")?
            .query_map(params![args.world_id, i64::try_from(args.limit)?, i64::try_from(args.offset)?], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let items = ids
            .iter()
            .map(|id| read_candidate(&self.db, id))
            .collect::<Result<Vec<_>>>()?;
        Ok(json!({"items":items,"nextOffset":(items.len()==args.limit).then_some(args.offset+items.len())}))
    }

    /// Startup sweep: leases cannot survive the process that owned them, and a
    /// late result from an interrupted job must never be applied. The reason is
    /// recorded so the UI explains the restart instead of offering a doomed
    /// resume. Interrupted jobs are never re-queued automatically: a new
    /// execution must be requested explicitly.
    pub fn godot_recover(&mut self) -> Result<usize> {
        self.executors.clear();
        let changed = self.db.execute(
            "UPDATE craftmine_godot_jobs SET status='interrupted',run_token=NULL,executor_id=NULL,
                lease_expires_at=NULL,interrupt_reason='GODOT_HOST_RESTART',updated_at=?1
             WHERE status IN ('claimed','running')",
            [worlds::timestamp()?],
        )?;
        settle_usage(&self.db)?;
        Ok(changed)
    }
}

/// Shared owner check for executor-facing job operations. A stale token cannot
/// observe or mutate a job it does not own.
fn owned_job(db: &Connection, id: &str, token: &str) -> Result<(String, String, Value)> {
    let record = read_job(db, id)?;
    let owner: Option<String> = db.query_row(
        "SELECT run_token FROM craftmine_godot_jobs WHERE id=?1",
        [id],
        |row| row.get(0),
    )?;
    ensure!(
        owner.as_deref() == Some(token),
        "GODOT_JOB_OWNER_MISMATCH"
    );
    let world = record["worldId"]
        .as_str()
        .context("INVALID_GODOT_JOB")?
        .to_string();
    let build = record["buildId"]
        .as_str()
        .context("INVALID_GODOT_JOB")?
        .to_string();
    Ok((world, build, record))
}

fn scope(
    db: &Connection,
    ctx: &WorkspaceContext,
    world: &str,
    write: bool,
) -> Result<workspaces::WorkspaceSnapshot> {
    worlds::validate_id(world)?;
    let snapshot = workspaces::inspect(db, ctx)?;
    ensure!(snapshot.world_id == world, "PROJECT_WORLD_BINDING_MISMATCH");
    if write {
        workspaces::assert_live(db, &snapshot)?;
    }
    Ok(snapshot)
}

/// Model tool calls always carry the durable workspace context and are bound to
/// its world. Trusted host panel reads may omit it, but then only the world
/// identity is checked and no lease is implied.
pub(super) fn world_scope(
    db: &Connection,
    world: &str,
    context: Option<&WorkspaceContext>,
) -> Result<()> {
    match context {
        Some(ctx) => {
            scope(db, ctx, world, false)?;
        }
        None => {
            worlds::read(db, world)?;
        }
    }
    Ok(())
}
