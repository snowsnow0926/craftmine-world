//! Shared fixtures for the managed Godot build, job and application tests.
#![cfg(test)]
use std::path::{Path, PathBuf};

use anyhow::Result;
use base64::prelude::{Engine as _, BASE64_STANDARD};
use serde_json::{json, Value};

use crate::{digest, TaskJournal, WorkspaceContext, WorldDocument};

pub(super) const PROJECT: &str = "config_version=5\n[application]\nrun/main_scene=\"res://main.tscn\"\n";
pub(super) const SCENE: &str = "[gd_scene load_steps=2 format=3]\n[node name=\"Main\" type=\"Node3D\"]\n";
pub(super) const SCRIPT: &str = "extends Node3D\nvar damage := 12\n";

pub(super) fn ctx(turn: &str) -> WorkspaceContext {
    WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-a".into(),
        turn_id: turn.into(),
    }
}

pub(super) fn world() -> WorldDocument {
    WorldDocument {
        build: json!({"id":"base-a","scene":{"format":"craftmine.scene/3","objects":[]}}),
        snapshot: json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":7.6,"z":0.5,"yaw":0,"pitch":0}}),
        extensions: vec![],
    }
}

pub(super) fn setup(path: &Path) -> Result<TaskJournal> {
    let mut journal = TaskJournal::open(path)?;
    journal.world_create("a", "A", &world())?;
    journal.world_create("b", "B", &world())?;
    journal.workspace_open(&ctx("one"), "a")?;
    Ok(journal)
}

pub(super) fn temp() -> Result<(tempfile::TempDir, PathBuf)> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("tasks.sqlite");
    Ok((dir, path))
}

pub(super) fn project_files() -> Value {
    json!([
        {"path":"project.godot","text":PROJECT},
        {"path":"main.tscn","text":SCENE},
        {"path":"world.gd","text":SCRIPT}
    ])
}

pub(super) fn create_project(journal: &mut TaskJournal, context: &WorkspaceContext) -> Result<Value> {
    create_project_in(journal, context, "a", "create-one")
}

pub(super) fn create_project_in(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    world_id: &str,
    call: &str,
) -> Result<Value> {
    journal.godot_project_create(&json!({"context":context,"worldId":world_id,"toolCallId":call,
        "baseBuild":"base-a","baseId":"first-person","files":project_files()}))
}

pub(super) fn put_asset(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    call: &str,
    name: &str,
    media_type: &str,
    bytes: &[u8],
) -> Result<Value> {
    journal.godot_asset_put(&json!({"context":context,"worldId":"a","toolCallId":call,"name":name,
        "mediaType":media_type,"sha256":digest_bytes(bytes),"bytesBase64":BASE64_STANDARD.encode(bytes)}))
}

pub(super) fn register(
    journal: &mut TaskJournal,
    executor: &str,
    capabilities: Value,
    evidence: &str,
) -> Result<Value> {
    journal.godot_executor_register(&json!({"executorId":executor,"attestation":{
        "format":"craftmine.godot-executor/1","isolation":"appcontainer","evidenceHash":evidence,
        "engineVersion":"4.7.2-stable","capabilities":capabilities}}))
}

pub(super) fn start(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    call: &str,
    revision: &Value,
    mode: &str,
) -> Result<Value> {
    journal.godot_build_start(&json!({"context":context,"worldId":"a","toolCallId":call,
        "revision":revision["revision"],"manifestHash":revision["manifestHash"],"mode":mode}))
}

pub(super) fn claim(
    journal: &mut TaskJournal,
    job: &Value,
    token: &str,
    executor: &str,
) -> Result<Value> {
    journal.godot_job_claim(&json!({"jobId":job["jobId"],"token":token,"executorId":executor}))
}

/// One realistic executor result. `artifacts` are written by the caller.
pub(super) fn output(
    claim: &Value,
    passed: bool,
    assertions: Value,
    artifacts: Value,
    compile_errors: Value,
) -> Value {
    json!({"format":"craftmine.godot-job-result/1","inputHash":claim["inputHash"],"passed":passed,
        "import":{"passed":true,"log":"imported"},
        "compile":{"passed":compile_errors.as_array().is_none_or(|errors| errors.is_empty()),
            "errors":compile_errors,"warnings":[]},
        "check":{"passed":passed,"assertions":assertions},
        "artifacts":artifacts,
        "engine":{"version":"4.7.2-stable","isolation":"appcontainer","evidenceHash":claim["evidenceHash"]}})
}

pub(super) fn finish(
    journal: &mut TaskJournal,
    job: &Value,
    token: &str,
    output: &Value,
) -> Result<Value> {
    journal.godot_job_finish(&json!({"jobId":job["jobId"],"token":token,"output":output}))
}

/// Full check pipeline up to a candidate, using a real on-disk artifact.
pub(super) fn run_check(
    journal: &mut TaskJournal,
    context: &WorkspaceContext,
    revision: &Value,
    call: &str,
    passed: bool,
) -> Result<(Value, Value)> {
    register(
        journal,
        "executor-a",
        json!({"import":true,"build":true,"check":true}),
        &digest("isolation-evidence"),
    )?;
    let job = start(journal, context, call, revision, "check")?;
    let claimed = claim(journal, &job, "token-a", "executor-a")?;
    let artifacts = write_artifact(&claimed, "web/index.html", b"<html></html>")?;
    let assertions = if passed {
        json!([{"id":"crosshair.center","passed":true,"detail":"centered"}])
    } else {
        json!([{"id":"crosshair.center","passed":false,"detail":"offset"}])
    };
    let result = finish(
        journal,
        &job,
        "token-a",
        &output(&claimed, passed, assertions, artifacts, json!([])),
    )?;
    Ok((job, result))
}

pub(super) fn write_artifact(claim: &Value, path: &str, bytes: &[u8]) -> Result<Value> {
    let root = PathBuf::from(claim["artifactsRoot"].as_str().unwrap_or_default());
    let mut target = root;
    for part in path.split('/') {
        target.push(part);
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, bytes)?;
    Ok(json!([{"path":path,"sha256":digest_bytes(bytes),"bytes":bytes.len()}]))
}

pub(super) fn digest_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn failed<T: std::fmt::Debug>(result: Result<T>, code: &str) {
    assert!(
        result.unwrap_err().to_string().contains(code),
        "Expected {code}"
    );
}
