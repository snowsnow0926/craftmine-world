//! Local product service. Only the trusted plugin broker owns this stdio pipe.
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use craftmine_core::{TaskBinding, TaskJournal, WorkspaceContext, WorldDocument};
use serde_json::{json, Value};

fn dispatch(journal: &mut TaskJournal, request: &Value) -> Result<Value> {
    let method = request["method"].as_str().context("METHOD_REQUIRED")?;
    if method == "hello" {
        return Ok(
            json!({"format":"craftmine.core/1","version":env!("CARGO_PKG_VERSION"),"storage":"sqlite","sessionDrafts":true,"verificationJobs":true,"advisoryReviews":true,"playerApplications":true,"publishesWorlds":true,"agentPublishesWorlds":false,"godotProjects":true,"godotExecution":false,"godotBuildJobs":true,"godotExecutorGate":true}),
        );
    }
    let params = request.get("params").context("PARAMS_REQUIRED")?;
    if method == "budget.configure" {
        return journal.budget_configure(params);
    }
    if method == "budget.findReceipt" {
        return journal.budget_find_receipt(params);
    }
    if method.starts_with("budget.") {
        return journal.budget_call(method, params);
    }
    match method {
        "godotProject.create" => return journal.godot_project_create(params),
        "godotProject.index" => return journal.godot_project_index(params),
        "godotProject.read" => return journal.godot_project_read(params),
        "godotProject.patch" => return journal.godot_project_patch(params),
        "godotProject.receipt" => return journal.godot_project_receipt(params),
        "godotAsset.put" => return journal.godot_asset_put(params),
        "godotAsset.list" => return journal.godot_asset_list(params),
        "godotBuild.start" => return journal.godot_build_start(params),
        "godotBuild.read" => return journal.godot_build_read(params),
        "godotBuild.cancel" => return journal.godot_build_cancel(params),
        "godotBuild.receipt" => return journal.godot_build_receipt(params),
        "godotCandidate.read" => return journal.godot_candidate_read(params),
        "godotCandidate.list" => return journal.godot_candidate_list(params),
        "godotApplication.prepare" => return journal.godot_application_prepare(params),
        "godotApplication.commit" => return journal.godot_application_commit(params),
        "godotApplication.read" => return journal.godot_application_read(params),
        "godotApplication.abort" => return journal.godot_application_abort(params),
        "godotRuntime.describe" => return journal.godot_runtime_describe(params),
        "godotRuntime.saveProgress" => return journal.godot_runtime_save_progress(params),
        "godotExecutor.register" => return journal.godot_executor_register(params),
        "godotJob.claim" => return journal.godot_job_claim(params),
        "godotJob.progress" => return journal.godot_job_progress(params),
        "godotJob.heartbeat" => return journal.godot_job_heartbeat(params),
        "godotJob.finish" => return journal.godot_job_finish(params),
        "library.search" => return journal.library_search(params),
        "library.read" => return journal.library_read(params),
        "library.capture" => return journal.library_capture(params),
        "memory.search" => return journal.memory_search(params),
        "memory.findReceipt" => return journal.memory_find_receipt(params),
        "memory.propose" => return journal.memory_propose(params),
        "memory.retire" => return journal.memory_retire(params),
        "backup.export" => return journal.backup_export(params),
        "backup.inspect" => return journal.backup_inspect(params),
        "backup.restore" => return journal.backup_restore(params),
        "backup.status" => return journal.backup_status(params),
        "backup.cancel" => return journal.backup_cancel(params),
        "application.list" => return journal.application_list(params),
        "workspace.current" => return journal.workspace_current(params),
        "workspace.findReceipt" => return journal.workspace_find_receipt(params),
        "task.context" => return journal.task_context(params),
        "task.readRequirements" => return journal.task_read_requirements(params),
        "task.recordContext" => return journal.task_record_context(params),
        "task.resume" => return journal.task_resume(params),
        "task.interrupt" => return journal.task_interrupt(params),
        "task.discard" => return journal.task_discard(params),
        "task.recoverable" => return journal.task_recoverable(params),
        _ => {}
    }
    if method.starts_with("review.") {
        let id = || params["id"].as_str().context("REVIEW_ID_REQUIRED");
        return match method {
            "review.start" => journal.review_start(
                params["verificationId"]
                    .as_str()
                    .context("CHECK_REQUIRED")?,
                id()?,
                params["token"].as_str().context("TOKEN_REQUIRED")?,
            ),
            "review.finish" => journal.review_finish(
                id()?,
                params["token"].as_str().context("TOKEN_REQUIRED")?,
                &params["output"],
            ),
            "review.plan" => journal.review_plan(
                id()?,
                params["token"].as_str().context("TOKEN_REQUIRED")?,
                &params["plan"],
            ),
            "review.read" => journal.review_read(id()?),
            "review.list" => Ok(serde_json::to_value(
                journal.review_list(
                    params["verificationId"]
                        .as_str()
                        .context("CHECK_REQUIRED")?,
                )?,
            )?),
            "review.cancel" => journal.review_cancel(id()?),
            _ => bail!("UNKNOWN_METHOD"),
        };
    }
    if method.starts_with("application.") {
        let id = || params["id"].as_str().context("APPLICATION_ID_REQUIRED");
        return match method {
            "application.prepare" => journal.application_prepare_with_review_warnings(
                id()?,
                params["token"].as_str().context("TOKEN_REQUIRED")?,
                params["verificationId"]
                    .as_str()
                    .context("CHECK_REQUIRED")?,
                params["reviewId"].as_str().context("REVIEW_REQUIRED")?,
                params["worldId"].as_str().context("WORLD_ID_REQUIRED")?,
                params["revision"].as_u64().context("REVISION_REQUIRED")?,
                &params["snapshot"],
                params.get("acknowledgeReviewWarnings").map(|value| value.as_bool().context("INVALID_REVIEW_ACKNOWLEDGEMENT")).transpose()?.unwrap_or(false),
            ),
            "application.commit" => journal.application_commit(
                id()?,
                params["token"].as_str().context("TOKEN_REQUIRED")?,
                &params["evidence"],
            ),
            "application.read" => journal.application_read(id()?),
            "application.abort" => journal.application_abort(id()?),
            _ => bail!("UNKNOWN_METHOD"),
        };
    }
    if method.starts_with("verification.") {
        let ctx: Option<WorkspaceContext> = params
            .get("context")
            .map(|value| serde_json::from_value(value.clone()))
            .transpose()?;
        let id = || params["id"].as_str().context("VERIFICATION_ID_REQUIRED");
        return match method {
            "verification.retry" => journal.verification_retry(params),
            "verification.submit" => journal.verification_submit_with_origin(
                ctx.as_ref().context("HOST_IDENTITY_REQUIRED")?,
                params["toolCallId"].as_str().context("CALL_ID_REQUIRED")?,
                params["revision"].as_u64().context("REVISION_REQUIRED")?,
                params["summary"].as_str().context("SUMMARY_REQUIRED")?,
                &params["origin"],
            ),
            "verification.claim" => journal
                .verification_claim(id()?, params["token"].as_str().context("TOKEN_REQUIRED")?),
            "verification.finish" => journal.verification_finish(
                id()?,
                params["token"].as_str().context("TOKEN_REQUIRED")?,
                &params["output"],
            ),
            "verification.read" => journal.verification_read(id()?, ctx.as_ref()),
            "verification.cancel" => journal.verification_cancel(id()?, ctx.as_ref()),
            "verification.list" => Ok(serde_json::to_value(journal.verification_list(
                params["worldId"].as_str().context("WORLD_ID_REQUIRED")?,
                params["offset"].as_u64().unwrap_or(0).try_into()?,
                params["limit"].as_u64().unwrap_or(16).try_into()?,
            )?)?),
            _ => bail!("UNKNOWN_METHOD"),
        };
    }
    if method == "workspace.endTurn" {
        journal.workspace_end_turn(
            params["sessionId"].as_str().context("SESSION_REQUIRED")?,
            params["turnId"].as_str().context("TURN_REQUIRED")?,
            params["status"].as_str().context("STATUS_REQUIRED")?,
        )?;
        return Ok(json!({"ok":true}));
    }
    if method.starts_with("workspace.") {
        let ctx: WorkspaceContext = serde_json::from_value(params["context"].clone())?;
        return match method {
            "workspace.open" => Ok(serde_json::to_value(
                journal.workspace_open(&ctx, params["selectedWorld"].as_str().unwrap_or(""))?,
            )?),
            "workspace.inspect" => Ok(serde_json::to_value(journal.workspace_inspect(&ctx)?)?),
            "workspace.recordRead" => {
                journal.workspace_record_read(
                    &ctx,
                    params["revision"].as_u64().context("REVISION_REQUIRED")?,
                    params["key"].as_str().context("KEY_REQUIRED")?,
                    params["hash"].as_str().context("HASH_REQUIRED")?,
                )?;
                Ok(json!({"ok":true}))
            }
            "workspace.receipt" => Ok(serde_json::to_value(journal.workspace_receipt(
                &ctx,
                params["toolCallId"].as_str().context("CALL_ID_REQUIRED")?,
                &params["request"],
            )?)?),
            "workspace.commit" => {
                let binding: TaskBinding = serde_json::from_value(params["binding"].clone())?;
                Ok(serde_json::to_value(journal.workspace_commit(
                    &ctx,
                    &binding,
                    params["toolCallId"].as_str().context("CALL_ID_REQUIRED")?,
                    params["revision"].as_u64().context("REVISION_REQUIRED")?,
                    &params["request"],
                    &params["draft"],
                )?)?)
            }
            _ => bail!("UNKNOWN_METHOD"),
        };
    }
    match method {
        "legacy.capture" => {
            return journal.legacy_capture(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                std::path::Path::new(params["source"].as_str().context("SOURCE_REQUIRED")?),
            )
        }
        "legacy.read" => {
            return journal.legacy_read(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                params["path"].as_str().context("ARCHIVE_PATH_REQUIRED")?,
            )
        }
        "legacy.readText" => {
            return Ok(Value::String(journal.legacy_read_text(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                params["path"].as_str().context("ARCHIVE_PATH_REQUIRED")?,
            )?))
        }
        "legacy.commit" => {
            let world: WorldDocument = serde_json::from_value(params["world"].clone())?;
            return Ok(serde_json::to_value(journal.legacy_commit(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                params["title"].as_str().context("TITLE_REQUIRED")?,
                &world,
            )?)?);
        }
        "world.list" => return Ok(serde_json::to_value(journal.world_list()?)?),
        "world.read" => {
            return Ok(serde_json::to_value(journal.world_read(
                params["id"].as_str().context("WORLD_ID_REQUIRED")?,
            )?)?)
        }
        "world.create" => {
            let world: WorldDocument = serde_json::from_value(params["world"].clone())?;
            return Ok(serde_json::to_value(journal.world_create(
                params["id"].as_str().context("WORLD_ID_REQUIRED")?,
                params["title"].as_str().context("TITLE_REQUIRED")?,
                &world,
            )?)?);
        }
        "world.saveProgress" => {
            return Ok(serde_json::to_value(journal.world_save_progress(
                params["id"].as_str().context("WORLD_ID_REQUIRED")?,
                params["revision"].as_u64().context("REVISION_REQUIRED")?,
                params["baseBuild"].as_str().context("BUILD_REQUIRED")?,
                &params["snapshot"],
            )?)?)
        }
        _ if !method.starts_with("task.") => bail!("UNKNOWN_METHOD"),
        _ => {}
    }
    let binding: TaskBinding = serde_json::from_value(params["binding"].clone())?;
    match method {
        "task.start" => Ok(serde_json::to_value(
            journal.start(&binding, &params["draft"])?,
        )?),
        "task.inspect" => Ok(serde_json::to_value(journal.inspect(&binding)?)?),
        "task.cancel" => Ok(serde_json::to_value(journal.cancel(&binding)?)?),
        "task.commit" => Ok(serde_json::to_value(journal.commit_draft(
            &binding,
            params["toolCallId"].as_str().context("CALL_ID_REQUIRED")?,
            params["revision"].as_u64().context("REVISION_REQUIRED")?,
            &params["request"],
            &params["draft"],
        )?)?),
        _ => bail!("UNKNOWN_METHOD"),
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 || args[0] != "--data-dir" {
        bail!("usage: craftmine-core --data-dir <isolated project service directory>");
    }
    let directory = PathBuf::from(&args[1]);
    if !directory.is_absolute() {
        bail!("data directory must be absolute");
    }
    std::fs::create_dir_all(&directory)?;
    // The OS releases this lock on crash. A second broker must not run startup
    // recovery against the first broker's live workspace leases.
    let _store_lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("domain-writer.lock"))?;
    _store_lock
        .try_lock()
        .map_err(|error| anyhow::anyhow!("DOMAIN_ALREADY_RUNNING: {error}"))?;
    let mut journal = TaskJournal::open(&directory.join("tasks.sqlite"))?;
    journal.verification_recover()?;
    journal.review_recover()?;
    journal.application_recover()?;
    journal.godot_application_recover()?;
    journal.godot_recover()?;
    journal.task_recover()?;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut line = Vec::new();
        const MAX_RPC_BYTES: u64 = 72 * 1024 * 1024;
        let size = (&mut input)
            .take(MAX_RPC_BYTES + 1)
            .read_until(b'\n', &mut line)?;
        if size == 0 {
            break;
        }
        if size as u64 > MAX_RPC_BYTES {
            bail!("RPC_DOCUMENT_TOO_LARGE");
        }
        let response = match serde_json::from_slice::<Value>(&line) {
            Ok(request) => match dispatch(&mut journal, &request) {
                Ok(result) => json!({"id":request["id"],"result":result}),
                Err(error) => {
                    let message = error.to_string();
                    let marker = message
                        .split(|c: char| {
                            !(c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit())
                        })
                        .next()
                        .unwrap_or("");
                    let code = if marker.is_empty() {
                        "DOMAIN_ERROR"
                    } else {
                        marker
                    };
                    let retryable = matches!(
                        code,
                        "STALE_DRAFT"
                            | "GODOT_PROJECT_REVISION_CONFLICT"
                            | "PROJECT_FILE_CONFLICT"
                            | "WORLD_BUSY"
                            | "WORLD_APPLICATION_BUSY"
                            | "BACKUP_CURRENT_STATE_CONFLICT"
                            | "BACKUP_RESTORE_WORLD_BUSY"
                    );
                    json!({"id":request["id"],"error":{"code":code,"message":message,"retryable":retryable}})
                }
            },
            Err(_) => json!({"id":null,"error":{"message":"INVALID_JSON"}}),
        };
        serde_json::to_writer(&mut output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}
