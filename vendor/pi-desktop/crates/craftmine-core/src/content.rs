//! RPC surface and shared access for the managed Git content history.
//!
//! The core owns exactly one content backend per world. This module exposes the
//! history, branch, version, verification, apply-reference and reclaim
//! operations the client, tools and packages consume, and it is the only place
//! that builds a `RepositoryStore`.
use std::path::PathBuf;

use anyhow::{ensure, Context, Result};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};

use super::content_history::{
    apply::{self, OperationKind},
    contract::OperationContext,
    git::{GitAdapter, GitIdentity},
    migration,
    repo::{ContentFile, RepositoryStore, MAIN_BRANCH},
};
use super::{content_history, worlds, TaskJournal};

#[cfg(test)]
#[path = "content_tests.rs"]
mod tests;

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sha256_file(path: &std::path::Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn bundled_git_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(explicit) = std::env::var("CRAFTMINE_BUNDLED_GIT") {
        if !explicit.trim().is_empty() {
            candidates.push(PathBuf::from(explicit));
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            for relative in [
                "git/bin/git.exe",
                "git/git.exe",
                "resources/git/bin/git.exe",
                "resources/git/git.exe",
                "../git/bin/git.exe",
                "git/bin/git",
            ] {
                candidates.push(parent.join(relative));
            }
        }
    }
    candidates
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorldArgs {
    world_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryArgs {
    world_id: String,
    #[serde(default)]
    rev: Option<String>,
    #[serde(default)]
    skip: usize,
    #[serde(default = "default_history_limit")]
    limit: usize,
}
fn default_history_limit() -> usize {
    32
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RangeArgs {
    world_id: String,
    from: String,
    to: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiffArgs {
    world_id: String,
    from: String,
    to: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadFileArgs {
    world_id: String,
    rev: String,
    path: String,
    #[serde(default = "default_encoding")]
    encoding: String,
}
fn default_encoding() -> String {
    "text".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BranchCreateArgs {
    world_id: String,
    branch_id: String,
    from_rev: String,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MergeArgs {
    world_id: String,
    base: String,
    ours: String,
    theirs: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VersionCreateArgs {
    world_id: String,
    version_id: String,
    rev: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckpointSetArgs {
    world_id: String,
    task_id: String,
    sequence: u32,
    rev: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckpointListArgs {
    world_id: String,
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareArgs {
    world_id: String,
    context: OperationContext,
    kind: String,
    target_oid: String,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdvanceArgs {
    operation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfirmArgs {
    operation_id: String,
    /// The formally applied Godot application that proves this deployment. The
    /// caller can no longer pass an object id or a free-text claim instead.
    application_id: String,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RollbackArgs {
    operation_id: String,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeepArgs {
    world_id: String,
    #[serde(default)]
    keep: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifyArgs {
    world_id: String,
    #[serde(default)]
    refs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BundleArgs {
    world_id: String,
    target: String,
    #[serde(default)]
    refs: Vec<String>,
}

impl TaskJournal {
    /// The managed Git program, discovered once per process. Bundled candidates
    /// win; a PATH fallback is recorded so no report can claim a bundled binary
    /// that was not used.
    pub(crate) fn git_adapter(&self) -> Result<GitAdapter> {
        if self.git.get().is_none() {
            let config_dir = self.directory.join("content-history").join("git-config");
            std::fs::create_dir_all(&config_dir).context("CONTENT_STORAGE_UNAVAILABLE")?;
            let identity = GitIdentity::local("Craftmine", "craftmine-local")?;
            let adapter = GitAdapter::discover(&config_dir, &bundled_git_candidates(), identity)?;
            let _ = self.git.set(adapter);
        }
        self.git.get().cloned().context("CONTENT_GIT_UNAVAILABLE")
    }

    pub(crate) fn content_store(&self) -> Result<RepositoryStore> {
        RepositoryStore::open(&self.directory.join("content-history"), self.git_adapter()?)
    }

    /// `(repoId, backend)` when the world is registered with the content
    /// backend; `None` for a world that only ever used the legacy store.
    pub(crate) fn content_backend(&self, world: &str) -> Result<Option<(String, String)>> {
        worlds::validate_id(world)?;
        Ok(self
            .db
            .query_row(
                "SELECT repo_id,backend FROM craftmine_content_repositories WHERE world_id=?1",
                [world],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub(crate) fn is_git_backed(&self, world: &str) -> Result<bool> {
        Ok(self
            .content_backend(world)?
            .is_some_and(|(_, backend)| backend == "git"))
    }

    pub(crate) fn content_layout(
        &self,
        world: &str,
    ) -> Result<(RepositoryStore, content_history::repo::RepoLayout)> {
        let (repo_id, backend) = self
            .content_backend(world)?
            .context("CONTENT_BACKEND_UNKNOWN")?;
        ensure!(backend == "git", "CONTENT_BACKEND_LEGACY");
        let store = self.content_store()?;
        let layout = store.open_existing(&repo_id)?;
        Ok((store, layout))
    }

    pub fn content_status(&self, args: &Value) -> Result<Value> {
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        let git = self.git_adapter()?;
        let info = git.info();
        let registered = self.content_backend(&args.world_id)?;
        let mut result = json!({
            "format": "craftmine.content-status/1",
            "worldId": args.world_id,
            "registered": registered.is_some(),
            "git": {
                "path": info.path,
                "version": info.version,
                "versionMajor": info.version_major,
                "versionMinor": info.version_minor,
                "sha256": info.sha256,
                "source": info.source,
            },
        });
        if let Some((repo_id, backend)) = registered {
            let store = self.content_store()?;
            let layout = store.layout(&repo_id)?;
            let head = store.branch_head(&layout, MAIN_BRANCH)?;
            let applied = store.applied(&layout, &args.world_id)?;
            let mapping: i64 = self.db.query_row(
                "SELECT COUNT(*) FROM craftmine_content_revision_map WHERE world_id=?1",
                [&args.world_id],
                |row| row.get(0),
            )?;
            result["repoId"] = json!(repo_id);
            result["backend"] = json!(backend);
            result["gitDir"] = json!(content_history::git::GitAdapter::plain_path(&layout.git_dir)
                .to_string_lossy());
            result["headOid"] = json!(head);
            result["appliedOid"] = json!(applied);
            result["branches"] = serde_json::to_value(store.branches(&layout)?)?;
            result["migratedRevisions"] = json!(mapping);
        }
        Ok(result)
    }

    pub fn content_git_info(&self, _args: &Value) -> Result<Value> {
        let git = self.git_adapter()?;
        let info = git.info();
        Ok(json!({"format":"craftmine.git-info/1","path":info.path,
            "version":info.version,"versionMajor":info.version_major,"versionMinor":info.version_minor,
            "sha256":info.sha256,"source":info.source,
            "minimum":{"major":content_history::git::MINIMUM_GIT.0,"minor":content_history::git::MINIMUM_GIT.1}}))
    }

    pub fn content_migrate_plan(&self, args: &Value) -> Result<Value> {
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        worlds::read(&self.db, &args.world_id)?;
        let plan = migration::plan(&self.db, &self.directory, &args.world_id)?;
        Ok(serde_json::to_value(plan)?)
    }

    pub fn content_migrate_apply(&mut self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        worlds::read(&self.db, &args.world_id)?;
        let store = self.content_store()?;
        let report = migration::apply(&mut self.db, &self.directory, &store, &args.world_id)?;
        Ok(serde_json::to_value(report)?)
    }

    pub fn content_migrate_verify(&self, args: &Value) -> Result<Value> {
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        worlds::read(&self.db, &args.world_id)?;
        let store = self.content_store()?;
        let problems = migration::verify(&self.db, &self.directory, &store, &args.world_id)?;
        Ok(json!({"format":"craftmine.content-migration-verification/1","worldId":args.world_id,
            "problems":problems,"verified":problems.is_empty()}))
    }

    pub fn content_history(&self, args: &Value) -> Result<Value> {
        let args: HistoryArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let rev = args.rev.as_deref().unwrap_or(MAIN_BRANCH);
        let page = store.history(&layout, rev, args.skip, args.limit)?;
        Ok(serde_json::to_value(page)?)
    }

    pub fn content_changes(&self, args: &Value) -> Result<Value> {
        let args: RangeArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let changes = store.changes(&layout, &args.from, &args.to)?;
        Ok(json!({"worldId":args.world_id,"from":args.from,"to":args.to,"changes":changes}))
    }

    pub fn content_diff(&self, args: &Value) -> Result<Value> {
        let args: DiffArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let diff = store.file_diff(&layout, &args.from, &args.to, &args.path)?;
        Ok(serde_json::to_value(diff)?)
    }

    pub fn content_read_file(&self, args: &Value) -> Result<Value> {
        let args: ReadFileArgs = serde_json::from_value(args.clone())?;
        ensure!(
            matches!(args.encoding.as_str(), "text" | "base64"),
            "INVALID_CONTENT_ENCODING"
        );
        let (store, layout) = self.content_layout(&args.world_id)?;
        let bytes = store.read_file(&layout, &args.rev, &args.path)?;
        let mut result = json!({"worldId":args.world_id,"rev":args.rev,"path":args.path,
            "bytes":bytes.len(),"sha256":sha256_hex(&bytes)});
        if args.encoding == "base64" {
            use base64::prelude::{Engine as _, BASE64_STANDARD};
            result["base64"] = json!(BASE64_STANDARD.encode(&bytes));
        } else {
            result["text"] = json!(String::from_utf8(bytes).context("CONTENT_NOT_UTF8")?);
        }
        Ok(result)
    }

    pub fn content_branch_list(&self, args: &Value) -> Result<Value> {
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        Ok(json!({"worldId":args.world_id,"branches":store.branches(&layout)?}))
    }

    pub fn content_branch_create(&mut self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: BranchCreateArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let oid = store.git().resolve(&layout.git_dir, &args.from_rev)?;
        let tree = store.commit_tree_oid(&layout, &oid)?;
        let title = args.title.as_deref().unwrap_or("branch");
        let message = content_history::repo::commit_message(
            args.request_id.as_deref().unwrap_or("branch"),
            args.task_id.as_deref().unwrap_or("host"),
            title,
            &format!("branch from {oid}"),
        )?;
        let branch = store.commit_tree(&layout, &args.branch_id, None, &tree, &[oid.clone()], &message)?;
        Ok(json!({"worldId":args.world_id,"branchId":args.branch_id,"fromOid":oid,
            "headOid":branch,"treeOid":tree}))
    }

    pub fn content_branch_merge(&self, args: &Value) -> Result<Value> {
        let args: MergeArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let outcome = store.merge(&layout, &args.base, &args.ours, &args.theirs)?;
        Ok(serde_json::to_value(outcome)?)
    }

    pub fn content_version_create(&self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: VersionCreateArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let oid = store.git().resolve(&layout.git_dir, &args.rev)?;
        let tag = store.create_version(&layout, &args.version_id, &oid, &args.message)?;
        Ok(json!({"worldId":args.world_id,"versionId":args.version_id,"oid":oid,"tag":tag}))
    }

    pub fn content_version_list(&self, args: &Value) -> Result<Value> {
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        Ok(json!({"worldId":args.world_id,"versions":store.versions(&layout)?}))
    }

    pub fn content_checkpoint_set(&self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: CheckpointSetArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let oid = store.git().resolve(&layout.git_dir, &args.rev)?;
        let name = store.set_checkpoint(&layout, &args.task_id, args.sequence, &oid)?;
        Ok(json!({"worldId":args.world_id,"taskId":args.task_id,"sequence":args.sequence,
            "oid":oid,"ref":name}))
    }

    pub fn content_checkpoint_list(&self, args: &Value) -> Result<Value> {
        let args: CheckpointListArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        Ok(json!({"worldId":args.world_id,"taskId":args.task_id,
            "checkpoints":store.checkpoints(&layout, &args.task_id)?}))
    }

    pub fn content_apply_prepare(&mut self, args: &Value) -> Result<Value> {
        let args: PrepareArgs = serde_json::from_value(args.clone())?;
        ensure!(args.context.world_id == args.world_id, "CONTENT_CONTEXT_MISMATCH");
        let (_, _) = self.content_layout(&args.world_id)?;
        let kind = match args.kind.as_str() {
            "apply" => OperationKind::Apply,
            "restore" => OperationKind::Restore,
            "branch" => OperationKind::Branch,
            _ => anyhow::bail!("CONTENT_OPERATION_KIND_UNKNOWN"),
        };
        let intent = apply::prepare(&mut self.db, &args.context, kind, &args.target_oid, &args.detail)?;
        Ok(serde_json::to_value(intent)?)
    }

    pub fn content_apply_advance(&mut self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: AdvanceArgs = serde_json::from_value(args.clone())?;
        let world: String = self
            .db
            .query_row(
                "SELECT world_id FROM craftmine_content_operations WHERE operation_id=?1",
                [&args.operation_id],
                |row| row.get(0),
            )
            .context("CONTENT_OPERATION_NOT_FOUND")?;
        let store = self.content_store()?;
        let _ = self.content_layout(&world)?;
        let intent = apply::advance(&mut self.db, &store, &args.operation_id)?;
        Ok(serde_json::to_value(intent)?)
    }

    pub fn content_apply_confirm(&mut self, args: &Value) -> Result<Value> {
        let args: ConfirmArgs = serde_json::from_value(args.clone())?;
        let store = self.content_store()?;
        // Resolve the durable operation first: the deployment must be bound to
        // the same world and to the formal progress the operation expected.
        let intent = apply::intent(&self.db, &args.operation_id)?;
        let evidence = super::godot_applications::applied_deployment(
            &self.db,
            &args.application_id,
            &intent.world_id,
            intent.expected_progress_revision,
        )?;
        let intent = apply::confirm(
            &mut self.db,
            &store,
            &args.operation_id,
            &evidence,
            &args.detail,
        )?;
        Ok(serde_json::to_value(intent)?)
    }

    /// Pure observation of a durable operation; never advances or recovers it.
    pub fn content_operation_read(&self, args: &Value) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Args { world_id: String, operation_id: String }
        let args: Args = serde_json::from_value(args.clone())?;
        worlds::read(&self.db, &args.world_id)?;
        let intent = apply::intent(&self.db, &args.operation_id)?;
        ensure!(intent.world_id == args.world_id, "CONTENT_CONTEXT_MISMATCH");
        Ok(serde_json::to_value(intent)?)
    }

    pub fn content_apply_rollback(&mut self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: RollbackArgs = serde_json::from_value(args.clone())?;
        let store = self.content_store()?;
        let intent = apply::rollback(&mut self.db, &store, &args.operation_id, &args.reason)?;
        Ok(serde_json::to_value(intent)?)
    }

    pub fn content_apply_recover(&self, args: &Value) -> Result<Value> {
        let args: WorldArgs = serde_json::from_value(args.clone())?;
        worlds::read(&self.db, &args.world_id)?;
        let store = self.content_store()?;
        let report = apply::recover(&self.db, &store, &args.world_id)?;
        Ok(serde_json::to_value(report)?)
    }

    fn keep_refs(&self, world: &str, extra: &[String]) -> Result<Vec<String>> {
        let (store, layout) = self.content_layout(world)?;
        // `reclaim_plan` takes reference names, never object ids.
        let mut keep: Vec<String> = store
            .protected_refs(&layout)?
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        keep.extend(store.branches(&layout)?.into_iter().map(|entry| entry.name));
        keep.extend(extra.iter().cloned());
        keep.sort();
        keep.dedup();
        ensure!(!keep.is_empty(), "CONTENT_RECLAIM_KEEP_EMPTY");
        Ok(keep)
    }

    pub fn content_reclaim_plan(&self, args: &Value) -> Result<Value> {
        let args: KeepArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let keep = self.keep_refs(&args.world_id, &args.keep)?;
        Ok(serde_json::to_value(store.reclaim_plan(&layout, &keep)?)?)
    }

    pub fn content_reclaim_prune(&self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: KeepArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let pinned: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_backup_pins WHERE status IN ('streaming','retained')
             AND ((kind='repository' AND ref=?1) OR (kind='git-ref' AND ref LIKE ?2)))",
            rusqlite::params![layout.repo_id, format!("{}|%", layout.repo_id)], |row| row.get(0))?;
        ensure!(!pinned, "CONTENT_RECLAIM_PINNED");
        let keep = self.keep_refs(&args.world_id, &args.keep)?;
        Ok(serde_json::to_value(store.prune(&layout, &keep)?)?)
    }

    pub fn content_verify(&self, args: &Value) -> Result<Value> {
        let args: VerifyArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let refs = if args.refs.is_empty() {
            self.keep_refs(&args.world_id, &[])?
        } else {
            args.refs
        };
        let problems = store.verify(&layout, &refs)?;
        Ok(json!({"worldId":args.world_id,"refs":refs,"problems":problems,
            "verified":problems.is_empty()}))
    }

    pub fn content_bundle(&self, args: &Value) -> Result<Value> {
        let args: BundleArgs = serde_json::from_value(args.clone())?;
        let (store, layout) = self.content_layout(&args.world_id)?;
        let target = PathBuf::from(&args.target);
        ensure!(target.is_absolute(), "INVALID_CONTENT_TARGET");
        let refs = if args.refs.is_empty() {
            self.keep_refs(&args.world_id, &[])?
        } else {
            args.refs
        };
        store.bundle(&layout, &target, &refs)?;
        let bytes = std::fs::metadata(&target)?.len();
        Ok(json!({"worldId":args.world_id,"target":target.to_string_lossy(),"refs":refs,
            "bytes":bytes,"sha256":sha256_file(&target)?}))
    }

    /// Files a Git-backed project write commits: every indexed file plus the
    /// canonical asset lock when the world has assets.
    pub(crate) fn content_files(
        &self,
        world: &str,
        files: &std::collections::BTreeMap<String, super::godot_projects::FileEntry>,
    ) -> Result<Vec<ContentFile>> {
        let mut content = Vec::with_capacity(files.len() + 1);
        for (path, entry) in files {
            let text = super::godot_projects::blob_read(&self.directory, world, entry)?;
            content.push(ContentFile::text(path, &text));
        }
        let (_, assets) = super::godot_builds::asset_manifest(&self.db, world)?;
        if let Some(lock) = super::godot_builds::asset_lock(&assets)? {
            content.push(ContentFile::asset_lock(&lock)?);
        }
        Ok(content)
    }
}
