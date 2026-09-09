//! First-time Godot world creation as a durable, resumable transaction.
//!
//! A new Godot world starts with an explicit initialisation record and no formal
//! build. It only becomes playable when a real application committed after a
//! verified check and a confirmed first launch. The state is always derived from
//! durable rows, so no caller can declare a world initialised.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{digest, godot_builds, godot_runtime, worlds, TaskJournal, WorkspaceContext, WorldDocument};

#[cfg(test)]
#[path = "godot_worlds_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "godot_mining_copy_tests.rs"]
mod mining_copy_tests;

const BASES: [&str; 4] = ["first-person", "top-down", "side-view", "mining-sandbox"];

fn rebind_copy_progress(source:&Value,old:&str,new:&str)->Result<Value>{
    godot_runtime::validate_progress(source)?;
    ensure!(source["worldId"]==old,"GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
    let mut snapshot=source.clone();
    if source["baseId"]=="mining-sandbox" {
        ensure!(source["body"]["format"]=="craftmine.godot-mining-sandbox-managed/1"
            && source["body"]["worldId"]==old
            && source["body"]["state"]["format"]=="craftmine.godot-mining-sandbox-state/1"
            && source["body"]["state"]["worldId"]==old,"GODOT_COPY_PROGRESS_IDENTITY_MISMATCH");
        snapshot["body"]["state"]["worldId"]=json!(new);
    }
    snapshot["worldId"]=json!(new);
    if snapshot["body"].get("worldId").is_some(){snapshot["body"]["worldId"]=json!(new);}
    Ok(snapshot)
}
/// One backup descriptor stays well below the archive budget.
const BACKUP_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn copied_formal_ref(world: &str, build: &str) -> String {
    format!("{}{}",super::content_history::repo::COPIED_FORMAL_REF_PREFIX,digest(&format!("{world}|{build}")))
}

impl TaskJournal {
    pub(super) fn verify_copied_formal_source(&self, owner: &str, build: &str,
        store: &super::content_history::repo::RepositoryStore, layout: &super::content_history::repo::RepoLayout, commit: &str) -> Result<()> {
        let expected=super::godot_jobs::build_files(&self.db,owner,build,"source")?;
        ensure!(!expected.is_empty(),"GODOT_REBUILD_SOURCE_NOT_AVAILABLE");
        let entries=store.tree_entries(layout,commit)?;
        ensure!(entries.len()==expected.len(),"GODOT_COPIED_SOURCE_MISMATCH");
        for file in expected {
            let path=file["path"].as_str().context("GODOT_COPIED_SOURCE_MISMATCH")?;
            let bytes=store.read_file(layout,commit,path)?;
            ensure!(file["bytes"].as_u64()==Some(bytes.len() as u64)
                && file["sha256"]==super::godot_projects::digest_bytes(&bytes),"GODOT_COPIED_SOURCE_MISMATCH");
        }
        Ok(())
    }

    /// Called while the shared content/export/GC lock is held. Only the copy's
    /// recorded formal build determines the imported files; no caller chooses an OID.
    fn prepare_copied_rebuild_source(&self, world: &str) -> Result<Value> {
        let metadata=self.runtime_describe_impl(&json!({"worldId":world}),false)?;
        let Some(owner)=metadata["copiedFromWorldId"].as_str() else {return Ok(json!({"worldId":world,"copied":false}));};
        let build=metadata["buildId"].as_str().context("INVALID_GODOT_BUILD")?;
        let (store,layout)=self.content_layout(world)?;
        let reference=copied_formal_ref(world,build);
        if let Some(commit)=store.git().ref_value(&layout.git_dir,&reference)? {
            self.verify_copied_formal_source(owner,build,&store,&layout,&commit)?;
            return Ok(json!({"worldId":world,"copied":true,"replayed":true,"contentOid":commit}));
        }
        // New copies already migrated the exact formal file set. Older copies
        // may also have kept it. Adopt only after verifying every file against
        // the original build's immutable index, never merely because it is main.
        if let Some(head)=store.branch_head(&layout,super::content_history::repo::MAIN_BRANCH)? {
            if self.verify_copied_formal_source(owner,build,&store,&layout,&head).is_ok() {
                store.git().update_ref(&layout.git_dir,&reference,&head,None)?;
                return Ok(json!({"worldId":world,"copied":true,"replayed":false,"adopted":true,"contentOid":head}));
            }
        }
        let (revision,branch):(i64,String)=self.db.query_row(
            "SELECT source_revision,branch_id FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
            params![owner,build],|row|Ok((row.get(0)?,row.get(1)?)))?;
        let (manifest,_)=self.project_manifest_for(owner,Some(u64::try_from(revision)?),&branch)
            .context("GODOT_REBUILD_SOURCE_NOT_AVAILABLE")?;
        let source=super::godot_projects::read_manifest_files(self,owner,&manifest)
            .context("GODOT_REBUILD_SOURCE_NOT_AVAILABLE")?;
        let expected=super::godot_jobs::build_files(&self.db,owner,build,"source")?;
        ensure!(source.len()==expected.len()&&!source.is_empty(),"GODOT_COPIED_SOURCE_MISMATCH");
        for (path,entry,_) in &source {
            ensure!(expected.iter().any(|file|file["path"]==*path && file["sha256"]==entry.sha256 && file["bytes"]==entry.bytes),"GODOT_COPIED_SOURCE_MISMATCH");
        }
        let files=source.into_iter().map(|(path,_,bytes)|super::content_history::repo::ContentFile {path,bytes}).collect::<Vec<_>>();
        let message=super::content_history::repo::commit_message("copy-formal","native-copy",
            "Preserve exact copied formal source",&format!("source world {owner}; formal build {build}"))?;
        let commit=store.commit_ref(&layout,&reference,None,&files,&message)?;
        self.verify_copied_formal_source(owner,build,&store,&layout,&commit)?;
        Ok(json!({"worldId":world,"copied":true,"replayed":false,"contentOid":commit}))
    }

    pub fn godot_world_prepare_rebuild_source(&self,args:&Value)->Result<Value> {
        let _lock=crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args:StatusArgs=serde_json::from_value(args.clone())?;
        self.prepare_copied_rebuild_source(&args.world_id)
    }

    /// Durable copy origin lookup. Older rows retain the immutable build owner,
    /// not necessarily the user's source selection. The original selection can
    /// still be verified against the persisted copy id without guessing it.
    pub fn godot_world_copy_status(&self,args:&Value)->Result<Value> {
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        struct Args {world_id:String,source_world_id:Option<String>}
        let args:Args=serde_json::from_value(args.clone())?;
        worlds::validate_id(&args.world_id)?;
        if let Some(source)=&args.source_world_id {worlds::validate_id(source)?;}
        let row:Option<(String,String,String,String)>=self.db.query_row(
            "SELECT id,source_world_id,source_build_id,progress_mode FROM craftmine_godot_world_copies WHERE target_world_id=?1",
            [&args.world_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        let Some((id,owner,build,mode))=row else {return Ok(Value::Null)};
        if let Some(source)=&args.source_world_id {
            let expected=format!("gcopy-{}",digest(&format!("craftmine.godot-world-copy/1|{source}|{}",args.world_id)));
            ensure!(id==expected,"GODOT_COPY_ORIGIN_MISMATCH");
        }
        Ok(json!({"copyId":id,"targetWorldId":args.world_id,"originalSourceWorldId":args.source_world_id,
            "sourceBuildOwnerWorldId":owner,"sourceBuildId":build,"progressMode":mode}))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InitializeArgs {
    world_id: String,
    title: String,
    base_id: String,
    /// The base build the sample/blank project was authored against. It is a
    /// pinned base token, not a formal build identity.
    base_build: String,
    /// Initial progress supplied by the base author. Must be Godot progress for
    /// this world; a legacy or empty document is not a new Godot world.
    snapshot: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusArgs {
    world_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CopyArgs {
    source_world_id: String,
    target_world_id: String,
    title: String,
    /// `formal` inherits the source play progress; `initial` starts from the
    /// supplied initial state so a copied example does not inherit rewards.
    progress: String,
    #[serde(default)]
    snapshot: Option<Value>,
    #[serde(default)]
    context: Option<WorkspaceContext>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifyArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
    snapshot: Value,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_world_init (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL UNIQUE REFERENCES craftmine_worlds(id),
            title TEXT NOT NULL, base_id TEXT NOT NULL, base_build TEXT NOT NULL,
            status TEXT NOT NULL, reason TEXT, application_id TEXT, snapshot_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS craftmine_godot_world_copies (
            id TEXT PRIMARY KEY, source_world_id TEXT NOT NULL, target_world_id TEXT NOT NULL UNIQUE,
            source_build_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
            manifest_hash TEXT NOT NULL, asset_manifest_hash TEXT NOT NULL,
            progress_mode TEXT NOT NULL, created_at INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

/// The initialisation state for one world, or `None` for a world that was not
/// created through this transaction (for example a legacy or imported world).
pub(super) fn read(db: &Connection, world: &str) -> Result<Option<Value>> {
    let row: Option<(String, String, String, String, String, Option<String>, Option<String>, String, i64)> = db
        .query_row(
            "SELECT id,title,base_id,base_build,status,reason,application_id,snapshot_hash,created_at
             FROM craftmine_godot_world_init WHERE world_id=?1",
            [world],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?,
                row.get(6)?, row.get(7)?, row.get(8)?)),
        )
        .optional()?;
    let Some((id, title, base_id, base_build, status, reason, application, snapshot_hash, created)) = row
    else {
        return Ok(None);
    };
    Ok(Some(json!({"format":"craftmine.godot-world-init/1","initId":id,"worldId":world,
        "title":title,"baseId":base_id,"baseBuild":base_build,"status":status,"reason":reason,
        "applicationId":application,"initialSnapshotHash":snapshot_hash,"createdAt":created})))
}

/// Mark an initialisation confirmed once the real application committed.
pub(super) fn confirm(db: &Connection, world: &str, application_id: &str) -> Result<()> {
    db.execute(
        "UPDATE craftmine_godot_world_init SET status='confirmed',reason=NULL,application_id=?2,
            updated_at=?3 WHERE world_id=?1 AND status<>'confirmed'",
        params![world, application_id, worlds::timestamp()?],
    )?;
    Ok(())
}

impl TaskJournal {
    /// Create a new Godot world and its initialisation record in one
    /// transaction. No formal build exists yet and the world is not playable.
    pub fn godot_world_initialize(&mut self, args: &Value) -> Result<Value> {
        let args: InitializeArgs = serde_json::from_value(args.clone())?;
        worlds::validate_id(&args.world_id)?;
        ensure!(
            !args.title.trim().is_empty()
                && args.title.chars().count() <= 80
                && !args.title.chars().any(char::is_control),
            "INVALID_WORLD_TITLE"
        );
        ensure!(BASES.contains(&args.base_id.as_str()), "INVALID_GODOT_BASE");
        ensure!(
            !args.base_build.is_empty()
                && args.base_build.len() <= 80
                && args
                    .base_build
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')),
            "INVALID_GODOT_BASE"
        );
        // The initial progress must already be Godot progress for this world, so
        // a legacy document cannot be smuggled in as a new Godot world.
        godot_runtime::validate_progress(&args.snapshot)?;
        ensure!(
            args.snapshot["format"] == godot_runtime::PROGRESS_FORMAT
                && args.snapshot["baseId"] == args.base_id
                && args.snapshot["worldId"] == args.world_id,
            "GODOT_PROGRESS_BASE_MISMATCH"
        );
        let snapshot_text = serde_json::to_string(&args.snapshot)?;
        let snapshot_hash = digest(&snapshot_text);
        let init_id = format!(
            "gwinit-{}",
            digest(&format!(
                "craftmine.godot-world-init/1|{}|{}",
                args.world_id, args.base_build
            ))
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = read(&tx, &args.world_id)? {
            // The same request replays; a different one is a real conflict.
            ensure!(
                existing["initId"] == init_id
                    && existing["initialSnapshotHash"] == snapshot_hash
                    && existing["baseId"] == args.base_id,
                "WORLD_EXISTS"
            );
            tx.commit()?;
            return Ok(json!({"world":worlds::read(&self.db, &args.world_id)?,"init":existing,
                "replayed":true}));
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_worlds WHERE id=?1)",
            [&args.world_id],
            |row| row.get(0),
        )?;
        ensure!(!exists, "WORLD_EXISTS");
        let world = WorldDocument {
            build: json!({"id":args.base_build,"scene":{"format":"craftmine.godot-scene/1",
                "baseId":args.base_id},"godot":{"baseBuild":args.base_build,"initializing":true}}),
            snapshot: args.snapshot,
            extensions: vec![],
        };
        worlds::insert(&tx, &args.world_id, &args.title, &world)?;
        let now = worlds::timestamp()?;
        tx.execute(
            "INSERT INTO craftmine_godot_world_init(id,world_id,title,base_id,base_build,status,
                reason,application_id,snapshot_hash,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,'pending',NULL,NULL,?6,?7,?7)",
            params![init_id, args.world_id, args.title, args.base_id, args.base_build, snapshot_hash, now],
        )?;
        let init = read(&tx, &args.world_id)?.context("GODOT_WORLD_INIT_MISSING")?;
        let record = worlds::read(&tx, &args.world_id)?;
        tx.commit()?;
        Ok(json!({"world":record,"init":init,"replayed":false}))
    }

    /// Derive the current initialisation state from durable facts. Nothing here
    /// accepts a caller-supplied phase, so a world cannot be declared playable.
    pub fn godot_world_init_status(&mut self, args: &Value) -> Result<Value> {
        let args: StatusArgs = serde_json::from_value(args.clone())?;
        if read(&self.db,&args.world_id)?.is_none() {
            // Copied worlds have formal deployment evidence but no creation
            // row. They still need honest artifact availability after restore.
            let metadata=self.runtime_describe_impl(&json!({"worldId":args.world_id}),false)?;
            ensure!(!metadata.is_null(),"GODOT_WORLD_NOT_INITIALIZING");
            let world=worlds::read(&self.db,&args.world_id)?;
            let reason=self.godot_runtime_describe(&json!({"worldId":args.world_id})).err().map(|error|error.to_string());
            let copy_id:Option<String>=self.db.query_row("SELECT id FROM craftmine_godot_world_copies WHERE target_world_id=?1",[&args.world_id],|row|row.get(0)).optional()?;
            return Ok(json!({"format":"craftmine.godot-world-init/1","initId":copy_id,"worldId":args.world_id,
                "title":world.summary.title,"baseId":metadata["baseId"],"baseBuild":world.world.build["godot"]["baseBuild"],
                "status":"confirmed","reason":reason,"playable":reason.is_none(),"rebuildRequired":reason.is_some(),
                "applicationId":null,"candidateId":null,"worldRevision":world.summary.revision,
                "formalBuildId":world.world.build["id"],"initialSnapshotHash":null}));
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut init = read(&tx, &args.world_id)?.context("GODOT_WORLD_NOT_INITIALIZING")?;
        let world = worlds::read(&tx, &args.world_id)?;
        let applied: Option<String> = tx
            .query_row(
                "SELECT id FROM craftmine_godot_applications WHERE world_id=?1 AND status='applied'
                 ORDER BY updated_at DESC LIMIT 1",
                [&args.world_id],
                |row| row.get(0),
            )
            .optional()?;
        let candidate: Option<String> = tx
            .query_row(
                "SELECT id FROM craftmine_godot_candidates WHERE world_id=?1 AND status='ready'
                 ORDER BY created_at DESC LIMIT 1",
                [&args.world_id],
                |row| row.get(0),
            )
            .optional()?;
        let job: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT status,COALESCE(interrupt_reason,blocked_reason) FROM craftmine_godot_jobs
                 WHERE world_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1",
                [&args.world_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let project: Option<i64> = tx
            .query_row(
                "SELECT revision FROM craftmine_godot_projects WHERE world_id=?1",
                [&args.world_id],
                |row| row.get(0),
            )
            .optional()?;
        let (status, reason) = if applied.is_some() {
            ("confirmed", None)
        } else if candidate.is_some() {
            ("checked", None)
        } else if let Some((job_status, job_reason)) = &job {
            match job_status.as_str() {
                "failed" => ("failed", Some(job_reason.clone().unwrap_or_else(|| "GODOT_JOB_FAILED".into()))),
                "interrupted" | "cancelled" => {
                    ("failed", Some(job_reason.clone().unwrap_or_else(|| "GODOT_JOB_ENDED".into())))
                }
                "blocked" => (
                    "blocked",
                    Some(job_reason.clone().unwrap_or_else(|| "GODOT_EXECUTION_UNAVAILABLE".into())),
                ),
                _ => ("building", None),
            }
        } else if project.is_some() {
            ("drafting", None)
        } else {
            ("pending", None)
        };
        if init["status"] != status || init["reason"] != json!(reason) {
            tx.execute(
                "UPDATE craftmine_godot_world_init SET status=?2,reason=?3,updated_at=?4
                 WHERE world_id=?1",
                params![args.world_id, status, reason, worlds::timestamp()?],
            )?;
            init = read(&tx, &args.world_id)?.context("GODOT_WORLD_INIT_MISSING")?;
        }
        let playable = status == "confirmed"
            && world.world.build["id"]
                .as_str()
                .is_some_and(|id| godot_builds::valid_build_id(id).is_ok());
        let mut result = json!({
            "format":"craftmine.godot-world-init/1","initId":init["initId"],"worldId":args.world_id,
            "title":init["title"],"baseId":init["baseId"],"baseBuild":init["baseBuild"],
            "status":status,"reason":reason,"playable":playable,
            "applicationId":applied.or(init["applicationId"].as_str().map(str::to_string)),
            "candidateId":candidate,"projectRevision":project,
            "worldRevision":world.summary.revision,"formalBuildId":world.world.build["id"],
            "initialSnapshotHash":init["initialSnapshotHash"],"createdAt":init["createdAt"]
        });
        tx.commit()?;
        if playable {
            if let Err(error) = self.godot_runtime_describe(&json!({"worldId":args.world_id})) {
                result["playable"] = json!(false);
                result["reason"] = json!(error.to_string());
                result["rebuildRequired"] = json!(true);
            }
        }
        Ok(result)
    }

    /// Copy a formal Godot world into a new identity. The applied build is shared
    /// because its artifacts are immutable; the project head, source blobs and
    /// assets are copied, and the caller chooses whether the copy inherits play
    /// progress or starts from the initial state. The origin is recorded for
    /// works, migration and backup.
    pub fn godot_world_copy(&mut self, args: &Value) -> Result<Value> {
        let _lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: CopyArgs = serde_json::from_value(args.clone())?;
        worlds::validate_id(&args.source_world_id)?;
        worlds::validate_id(&args.target_world_id)?;
        ensure!(args.source_world_id != args.target_world_id, "INVALID_WORLD_ID");
        ensure!(
            !args.title.trim().is_empty()
                && args.title.chars().count() <= 80
                && !args.title.chars().any(char::is_control),
            "INVALID_WORLD_TITLE"
        );
        ensure!(matches!(args.progress.as_str(), "formal" | "initial"), "INVALID_PROGRESS");
        // Read the source content before the write transaction: a Git-backed
        // source world has no blob store, so its commit is the only source of
        // bytes. The revision is re-checked inside the transaction below. The
        // copiability check runs first so an ineligible source reports the same
        // error it did before the content read moved out of the transaction.
        let pre_source = worlds::read(&self.db, &args.source_world_id)?;
        ensure!(
            pre_source.world.build["scene"]["format"] == "craftmine.godot-scene/1",
            "GODOT_WORLD_NOT_COPIABLE"
        );
        let pre_build = pre_source.world.build["id"]
            .as_str()
            .context("INVALID_GODOT_BUILD")?;
        ensure!(
            godot_builds::valid_build_id(pre_build).is_ok(),
            "GODOT_WORLD_NOT_COPIABLE"
        );
        let validated = self.runtime_describe_impl(&json!({"worldId":args.source_world_id}), false)?;
        let build_owner = validated["copiedFromWorldId"].as_str().unwrap_or(&args.source_world_id).to_string();
        let (source_revision, source_branch): (i64, String) = self.db.query_row(
            "SELECT source_revision,branch_id FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
            params![build_owner,pre_build], |row| Ok((row.get(0)?,row.get(1)?)))?;
        let (pre_manifest, pre_hash) = self.project_manifest_for(&build_owner, Some(u64::try_from(source_revision)?), &source_branch)?;
        let source_files = super::godot_projects::read_manifest_files(
            self,
            &build_owner,
            &pre_manifest,
        )?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        super::godot_jobs::world_scope(&tx, &args.source_world_id, args.context.as_ref())?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_worlds WHERE id=?1)",
            [&args.target_world_id],
            |row| row.get(0),
        )?;
        ensure!(!exists, "WORLD_EXISTS");
        let source = worlds::read(&tx, &args.source_world_id)?;
        ensure!(
            source.world.build["scene"]["format"] == "craftmine.godot-scene/1",
            "GODOT_WORLD_NOT_COPIABLE"
        );
        let build = source.world.build["id"]
            .as_str()
            .context("INVALID_GODOT_BUILD")?
            .to_string();
        ensure!(
            godot_builds::valid_build_id(&build).is_ok(),
            "GODOT_WORLD_NOT_COPIABLE"
        );
        let applied: Option<String> = tx
            .query_row(
                "SELECT id FROM craftmine_godot_applications WHERE world_id=?1 AND build_id=?2
                 AND status='applied' ORDER BY updated_at DESC LIMIT 1",
                params![build_owner, build],
                |row| row.get(0),
            )
            .optional()?;
        ensure!(applied.is_some(), "GODOT_BUILD_NOT_APPLIED");
        let snapshot = match args.progress.as_str() {
            // A copy gets a new identity, so the inherited progress must carry
            // target identity at the fixed schema locations, preserving all game data.
            "formal" => rebind_copy_progress(&source.world.snapshot,&args.source_world_id,&args.target_world_id)?,
            _ => args.snapshot.clone().context("GODOT_PROGRESS_REQUIRED")?,
        };
        ensure!(
            snapshot["format"] == godot_runtime::PROGRESS_FORMAT
                && snapshot["worldId"] == args.target_world_id
                && snapshot["baseId"] == source.world.snapshot["baseId"],
            "GODOT_PROGRESS_BASE_MISMATCH"
        );
        godot_runtime::validate_progress(&snapshot)?;
        if snapshot["baseId"]=="mining-sandbox" {
            rebind_copy_progress(&snapshot,&args.target_world_id,&args.target_world_id)?;
        }
        // Extensions are deliberately not copied: they may reference source-only
        // state and must be re-registered explicitly.
        let world = WorldDocument {
            build: source.world.build.clone(),
            snapshot,
            extensions: vec![],
        };
        worlds::insert(&tx, &args.target_world_id, &args.title, &world)?;
        ensure!(build == pre_build,"GODOT_SOURCE_STALE");
        let mut manifest = pre_manifest;
        let manifest_hash = pre_hash;
        manifest.world_id = args.target_world_id.clone();
        for (path, entry, text) in &source_files {
            ensure!(
                manifest.files.get(path) == Some(entry),
                "GODOT_SOURCE_STALE"
            );
            super::godot_projects::blob_write_bytes(&self.directory, &args.target_world_id, entry, text)?;
        }
        let body = serde_json::to_string(&manifest)?;
        let hash = digest(&body);
        tx.execute(
            "INSERT INTO craftmine_godot_projects(world_id,revision,manifest,hash) VALUES(?1,?2,?3,?4)",
            params![args.target_world_id, i64::try_from(manifest.revision)?, body, hash],
        )?;
        tx.execute(
            "INSERT INTO craftmine_godot_revisions(world_id,revision,task_id,manifest,hash)
             VALUES(?1,?2,?3,?4,?5)",
            params![args.target_world_id, i64::try_from(manifest.revision)?, manifest.task.task_id,
                body, hash],
        )?;
        // Assets are content-addressed per world, so each body is verified on
        // read and written into the copy's own store.
        let (asset_hash, assets) = godot_builds::asset_manifest(&tx, &args.source_world_id)?;
        if !assets.is_empty() {
            let source_root = godot_builds::asset_root(&self.directory, &args.source_world_id, false)?;
            let target_root = godot_builds::asset_root(&self.directory, &args.target_world_id, true)?;
            for asset in &assets {
                let bytes = godot_builds::binary_read(
                    &source_root.join(&asset.sha256),
                    &asset.sha256,
                    asset.bytes,
                )?;
                godot_builds::binary_write(&target_root, &asset.sha256, &bytes)?;
                tx.execute(
                    "INSERT INTO craftmine_godot_assets(world_id,sha256,name,path,media_type,bytes,created_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![args.target_world_id, asset.sha256, asset.name, asset.path,
                        asset.media_type, i64::try_from(asset.bytes)?, worlds::timestamp()?],
                )?;
            }
        }
        let id = format!(
            "gcopy-{}",
            digest(&format!(
                "craftmine.godot-world-copy/1|{}|{}",
                args.source_world_id, args.target_world_id
            ))
        );
        let now = worlds::timestamp()?;
        tx.execute(
            "INSERT INTO craftmine_godot_world_copies(id,source_world_id,target_world_id,
                source_build_id,source_revision,manifest_hash,asset_manifest_hash,progress_mode,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![id, build_owner, args.target_world_id, build,
                i64::try_from(manifest.revision)?, manifest_hash, asset_hash, args.progress, now],
        )?;
        let record = worlds::read(&tx, &args.target_world_id)?;
        tx.commit()?;
        let store = self.content_store()?;
        super::content_history::migration::apply(&mut self.db,&self.directory,&store,&args.target_world_id)?;
        self.prepare_copied_rebuild_source(&args.target_world_id)?;
        Ok(json!({"format":"craftmine.godot-world-copy/1","copyId":id,
            "sourceWorldId":args.source_world_id,"targetWorldId":args.target_world_id,
            "buildId":build,"sourceRevision":manifest.revision,"manifestHash":hash,
            "assetManifestHash":asset_hash,"progressMode":args.progress,"world":record}))
    }

    /// Consistent, self-contained descriptor of everything this core owns for one
    /// world. It is read-only and is what a backup keeps so a restore can be
    /// verified against the live store instead of trusting the archive.
    pub fn godot_world_backup_snapshot(&self, args: &Value) -> Result<Value> {
        let args: BackupArgs = serde_json::from_value(args.clone())?;
        super::godot_jobs::world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        let world = worlds::read(&self.db, &args.world_id)?;
        let document = worlds::encode(&world.world)?;
        let project: Option<(i64, String, String)> = self
            .db
            .query_row(
                "SELECT revision,manifest,hash FROM craftmine_godot_projects WHERE world_id=?1",
                [&args.world_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let project = match project {
            None => Value::Null,
            Some((revision, manifest, hash)) => {
                ensure!(digest(&manifest) == hash, "CORRUPT_PROJECT_MANIFEST");
                let parsed: super::godot_projects::Manifest = serde_json::from_str(&manifest)?;
                // Every referenced file is read back from the live backend and
                // hashed, so a backup descriptor proves the live store (a Git
                // commit or an immutable blob), not just the rows.
                for (path, entry) in &parsed.files {
                    super::godot_projects::read_indexed_bytes(
                        self,
                        &args.world_id,
                        parsed.revision,
                        path,
                        entry,
                    )?;
                }
                let files: Vec<Value> = parsed
                    .files
                    .iter()
                    .map(|(path, entry)| json!({"path":path,"sha256":entry.sha256,"bytes":entry.bytes}))
                    .collect();
                json!({"revision":revision,"manifestHash":hash,"manifest":serde_json::from_str::<Value>(&manifest)?,
                    "files":files})
            }
        };
        let (asset_hash, assets) = godot_builds::asset_manifest(&self.db, &args.world_id)?;
        if !assets.is_empty() {
            let root = godot_builds::asset_root(&self.directory, &args.world_id, false)?;
            for asset in &assets {
                godot_builds::binary_read(&root.join(&asset.sha256), &asset.sha256, asset.bytes)?;
            }
        }
        let assets: Vec<Value> = assets
            .iter()
            .map(|asset| json!({"path":asset.path,"sha256":asset.sha256,"bytes":asset.bytes,
                "mediaType":asset.media_type}))
            .collect();
        let build_id = world.world.build["id"].as_str().unwrap_or_default();
        // A copied world shares its source's build copy, which lives under the
        // source world's storage key.
        let build_owner: Option<String> = self
            .db
            .query_row(
                "SELECT source_world_id FROM craftmine_godot_world_copies
                 WHERE target_world_id=?1 AND source_build_id=?2",
                params![args.world_id, build_id],
                |row| row.get(0),
            )
            .optional()?;
        let build = if godot_builds::valid_build_id(build_id).is_ok() {
            let owner = build_owner.clone().unwrap_or_else(|| args.world_id.clone());
            let root = godot_builds::build_root(&self.directory, &owner, build_id, false)?;
            let files: Vec<Value> = self
                .db
                .prepare(
                    "SELECT path,kind,sha256,bytes FROM craftmine_godot_build_files
                     WHERE world_id=?1 AND build_id=?2 ORDER BY path",
                )?
                .query_map(params![owner, build_id], |row| {
                    Ok(json!({"path":row.get::<_,String>(0)?,"kind":row.get::<_,String>(1)?,
                        "sha256":row.get::<_,String>(2)?,"bytes":row.get::<_,i64>(3)?}))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for file in &files {
                let kind = file["kind"].as_str().context("CORRUPT_GODOT_BUILD")?;
                let (directory, limit) = if kind == "artifact" {
                    (root.join("artifacts"), super::godot_jobs::ARTIFACT_FILE_BYTES)
                } else {
                    (root.join("source"), godot_builds::BUILD_FILE_BYTES)
                };
                super::godot_jobs::verify_file(&directory, file["path"].as_str().context("CORRUPT_GODOT_BUILD")?,
                    file["sha256"].as_str().context("CORRUPT_GODOT_BUILD")?,
                    file["bytes"].as_u64().context("CORRUPT_GODOT_BUILD")?, limit, "CORRUPT_GODOT_BUILD")?;
            }
            json!({"buildId":build_id,"files":files})
        } else {
            Value::Null
        };
        let application: Option<Value> = self
            .db
            .query_row(
                "SELECT id,input_hash,output_hash FROM craftmine_godot_applications
                 WHERE world_id=?1 AND status='applied' ORDER BY updated_at DESC LIMIT 1",
                [&args.world_id],
                |row| Ok(json!({"applicationId":row.get::<_,String>(0)?,
                    "inputHash":row.get::<_,String>(1)?,"outputHash":row.get::<_,String>(2)?})),
            )
            .optional()?;
        let init = read(&self.db, &args.world_id)?;
        let mut body = json!({
            "format":"craftmine.godot-backup/1","worldId":args.world_id,
            "worldRevision":world.summary.revision,"contentHash":world.content_hash,
            "document":serde_json::from_str::<Value>(&document)?,
            "project":project,"assetManifestHash":asset_hash,"assets":assets,
            "build":build,"copiedFromWorldId":build_owner,"application":application,"init":init
        });
        let body_text = serde_json::to_string(&body)?;
        ensure!(body_text.len() <= BACKUP_BYTES, "GODOT_BACKUP_TOO_LARGE");
        body["snapshotHash"] = json!(digest(&body_text));
        Ok(body)
    }

    /// Recompute the descriptor from live rows and disk, then compare it with a
    /// stored backup descriptor. A mismatch is `GODOT_BACKUP_MISMATCH`; nothing
    /// is written and no descriptor content is trusted as input state.
    pub fn godot_world_verify_snapshot(&self, args: &Value) -> Result<Value> {
        let args: VerifyArgs = serde_json::from_value(args.clone())?;
        let expected_hash = args.snapshot["snapshotHash"]
            .as_str()
            .context("GODOT_BACKUP_MISMATCH")?
            .to_string();
        let mut expected = args.snapshot.clone();
        expected.as_object_mut().context("GODOT_BACKUP_MISMATCH")?.remove("snapshotHash");
        ensure!(digest(&serde_json::to_string(&expected)?) == expected_hash, "GODOT_BACKUP_MISMATCH");
        let actual = self.godot_world_backup_snapshot(&json!({"worldId":args.world_id,
            "context":args.context}))?;
        ensure!(actual == args.snapshot, "GODOT_BACKUP_MISMATCH");
        Ok(json!({"format":"craftmine.godot-backup-verification/1","worldId":args.world_id,
            "matches":true,"snapshotHash":expected_hash,"worldRevision":actual["worldRevision"]}))
    }
}
