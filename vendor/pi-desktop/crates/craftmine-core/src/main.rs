//! Local product service. Only the trusted plugin broker owns this stdio pipe.
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use craftmine_core::{asset_catalog_dispatch, TaskBinding, TaskJournal, WorkspaceContext, WorldDocument};
use serde_json::{json, Value};

fn dispatch(journal: &mut TaskJournal, request: &Value) -> Result<Value> {
    let method = request["method"].as_str().context("METHOD_REQUIRED")?;
    if method == "hello" {
        return Ok(
            json!({"format":"craftmine.core/1","version":env!("CARGO_PKG_VERSION"),"storage":"sqlite","sessionDrafts":true,"verificationJobs":true,"advisoryReviews":true,"playerApplications":true,"publishesWorlds":true,"agentPublishesWorlds":false,"godotProjects":true,"godotExecution":false,"godotBuildJobs":true,"godotExecutorGate":true,"contentHistory":true,"managedGit":true,"assetCatalog":true,"assetPreview":true,"creationPackages":true,"portableBackup":true}),
        );
    }
    let params = request.get("params").context("PARAMS_REQUIRED")?;
    if ["playtest.context", "playtest.validate", "playtest.record", "playtest.list", "playtest.read"].contains(&method) {
        return journal.playtest_request(method, params);
    }
    // Asset catalog (task S5). The catalog owns every asset.* method; this hook
    // and the lib.rs re-export are the only integration lines.
    if let Some(result) = asset_catalog_dispatch(journal, method, params) {
        return result;
    }
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
        "godotProject.sourceContext" => return journal.godot_project_source_context(params),
        "godotProject.read" => return journal.godot_project_read(params),
        "godotProject.patch" => return journal.godot_project_patch(params),
        "godotProject.applyFiles" => return journal.godot_project_apply_files(params),
        "godotProject.receipt" => return journal.godot_project_receipt(params),
        "godotAsset.put" => return journal.godot_asset_put(params),
        "godotAsset.list" => return journal.godot_asset_list(params),
        "godotBuild.start" => return journal.godot_build_start(params),
        "godotBuild.read" => return journal.godot_build_read(params),
        "godotBuild.latest" => return journal.godot_build_latest(params),
        "godotBuild.cancel" => return journal.godot_build_cancel(params),
        "godotBuild.receipt" => return journal.godot_build_receipt(params),
        "godotCandidate.read" => return journal.godot_candidate_read(params),
        "godotCandidate.list" => return journal.godot_candidate_list(params),
        "godotApplication.prepare" => return journal.godot_application_prepare(params),
        "godotApplication.commit" => return journal.godot_application_commit(params),
        "godotApplication.read" => return journal.godot_application_read(params),
        "godotApplication.abort" => return journal.godot_application_abort(params),
        "godotRuntime.describe" => return journal.godot_runtime_describe(params),
        "godotRuntime.describeCandidate" => return journal.godot_runtime_describe_candidate(params),
        "godotRuntime.saveProgress" => return journal.godot_runtime_save_progress(params),
        "godotExecutor.register" => return journal.godot_executor_register(params),
        "godotExecutor.status" => return Ok(journal.godot_executor_status()),
        "godotExecutor.revoke" => return journal.godot_executor_revoke(params),
        "godotJob.checkDescriptor" => return journal.godot_job_check_descriptor(params),
        "godotJob.continue" => return journal.godot_job_continue(params),
        "godotJob.usage" => return journal.godot_usage_summary(params),
        "godotJob.claim" => return journal.godot_job_claim(params),
        "godotStorage.status" => return journal.godot_storage_status(params),
        "godotStorage.reclaimPlan" => return journal.godot_storage_reclaim_plan(params),
        "godotStorage.reclaimCommit" => return journal.godot_storage_reclaim_commit(params),
        "godotWorld.initialize" => return journal.godot_world_initialize(params),
        "godotWorld.initStatus" => return journal.godot_world_init_status(params),
        "godotWorld.initCancel" => return journal.godot_world_init_cancel(params),
        "godotWorld.initCancelClear" => return journal.godot_world_init_cancel_clear(params),
        "godotWorld.initLaunchFailed" => return journal.godot_world_init_launch_failed(params),
        "godotWorld.initLaunchRetry" => return journal.godot_world_init_launch_retry(params),
        "godotWorld.rebuildPlan" => return journal.godot_world_rebuild_plan(params),
        "godotRuntime.exportSource" => return journal.godot_runtime_export_source(params),
        "godotWorld.prepareRebuildSource" => return journal.godot_world_prepare_rebuild_source(params),
        "godotWorld.prepareCopyRuntime" => return journal.godot_world_prepare_copy_runtime(params),
        "godotWorld.copy" => return journal.godot_world_copy(params),
        "godotWorld.copyStatus" => return journal.godot_world_copy_status(params),
        "godotWorld.backupSnapshot" => return journal.godot_world_backup_snapshot(params),
        "godotWorld.verifySnapshot" => return journal.godot_world_verify_snapshot(params),
        "content.status" => return journal.content_status(params),
        "content.gitInfo" => return journal.content_git_info(params),
        "content.migrate.plan" => return journal.content_migrate_plan(params),
        "content.migrate.apply" => return journal.content_migrate_apply(params),
        "content.migrate.verify" => return journal.content_migrate_verify(params),
        "content.history" => return journal.content_history(params),
        "content.changes" => return journal.content_changes(params),
        "content.diff" => return journal.content_diff(params),
        "content.readFile" => return journal.content_read_file(params),
        "content.branch.list" => return journal.content_branch_list(params),
        "content.branch.create" => return journal.content_branch_create(params),
        "content.branch.merge" => return journal.content_branch_merge(params),
        "content.version.create" => return journal.content_version_create(params),
        "content.version.list" => return journal.content_version_list(params),
        "content.checkpoint.set" => return journal.content_checkpoint_set(params),
        "content.checkpoint.list" => return journal.content_checkpoint_list(params),
        "content.apply.prepare" => return journal.content_apply_prepare(params),
        "content.apply.advance" => return journal.content_apply_advance(params),
        "content.apply.confirm" => return journal.content_apply_confirm(params),
        "content.operation.read" => return journal.content_operation_read(params),
        "content.apply.rollback" => return journal.content_apply_rollback(params),
        "content.apply.recover" => return journal.content_apply_recover(params),
        "content.reclaim.plan" => return journal.content_reclaim_plan(params),
        "content.reclaim.prune" => return journal.content_reclaim_prune(params),
        "content.verify" => return journal.content_verify(params),
        "content.bundle" => return journal.content_bundle(params),
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
        // Portable complete archive (craftmine.portable-archive/1). Registered
        // here because the shipped build is the only place these methods are
        // reachable; a module-local test does not prove the product entry.
        "backup.exportPortable" => return journal.backup_export_portable(params),
        "backup.inspectPortable" => return journal.backup_inspect_portable(params),
        "backup.verifyPortable" => return journal.backup_verify_portable(params),
        "backup.restorePortable" => return journal.backup_restore_portable(params),
        "backup.cancelPortable" => return journal.backup_cancel_portable(params),
        "backup.restoreProof" => return journal.backup_restore_proof(params),
        "backup.protectedRefs" => return journal.backup_protected_refs(params),
        "backup.releasePortable" => return journal.backup_release_portable(params),
        "backup.export-full" => return journal.backup_export_full(params),
        "backup.verify" => return journal.backup_verify(params),
        "backup.restore-full" => return journal.backup_restore_full(params),
        "backup.contentUsage" => return journal.backup_content_usage(params),
        // Asset catalog. The consumer contract is fixed by R6's interface sheet
        // (docs/dispatch-reports/godot-round2/R6/INTERFACE_R6.md) and the panel
        // allowlist in craftmine-panel-gateway.ts.
        "asset.import" => return journal.asset_import(params),
        "asset.read" => return journal.asset_read(params),
        "asset.versions" => return journal.asset_versions(params),
        "asset.bodyPath" => return journal.asset_body_path(params),
        "asset.search" => return journal.asset_search(params),
        "asset.scan" => return journal.asset_scan(params),
        "asset.annotate" => return journal.asset_annotate(params),
        "asset.recordUsage" => return journal.asset_record_usage(params),
        "asset.usage" => return journal.asset_usage(params),
        "asset.previewBegin" => return journal.asset_preview_begin(params),
        "asset.previewFinish" => return journal.asset_preview_finish(params),
        "asset.previewRead" => return journal.asset_preview_read(params),
        "asset.probe" => return journal.asset_probe(params),
        "asset.recordCheck" => return journal.asset_record_check(params),
        "asset.mapLegacy" => return journal.asset_map_legacy(params),
        "asset.resolveLegacy" => return journal.asset_resolve_legacy(params),
        // Creation packages. `package.check`/`package.install`/... are the
        // method strings the shipped reuse service calls.
        "package.formatCheck" => return journal.package_format_check(params),
        "package.planInstall" => return journal.package_plan_install(params),
        "package.register" => return journal.package_register(params),
        "package.check" => return journal.package_check(params),
        "package.install" => return journal.package_install(params),
        "package.list" => return journal.package_list(params),
        "package.read" => return journal.package_read(params),
        "package.progress" => return journal.package_progress(params),
        "package.grant" => return journal.package_grant(params),
        "package.upgrade" => return journal.package_upgrade(params),
        "package.uninstall" => return journal.package_uninstall(params),
        "package.restore" => return journal.package_restore(params),
        "package.export" => return journal.package_export(params),
        "package.import" => return journal.package_import(params),
        "package.usage" => return journal.package_usage(params),
        "legacy.convert" => return journal.legacy_convert(params),
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
        "world.archivedList" => return Ok(serde_json::to_value(journal.world_archived_list()?)?),
        "world.archiveStatus" => return journal.world_archive_status(params["id"].as_str().context("WORLD_ID_REQUIRED")?),
        "world.archiveFailed" => return journal.world_archive_failed(&params),
        "world.restoreArchived" => return journal.world_restore_archived(params["id"].as_str().context("WORLD_ID_REQUIRED")?),
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
    journal.godot_storage_recover()?;
    // Portable archive pins are durable; a crashed export must be reconciled
    // before any reclaimer trusts the pin set.
    journal.backup_recover()?;
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
