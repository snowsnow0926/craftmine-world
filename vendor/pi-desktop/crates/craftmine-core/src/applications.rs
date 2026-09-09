//! Player-initiated application receipts and atomic world publication.
use super::{digest, document, reviews, verification, worlds, TaskJournal, WorldDocument};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

#[cfg(test)]
#[path = "applications_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_applications (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
        verification_id TEXT NOT NULL REFERENCES craftmine_verifications(id),
        review_id TEXT NOT NULL REFERENCES craftmine_reviews(id),
        request_hash TEXT NOT NULL, input TEXT NOT NULL, input_hash TEXT NOT NULL,
        previous_world TEXT NOT NULL, previous_hash TEXT NOT NULL,
        status TEXT NOT NULL, token TEXT, output TEXT, output_hash TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS craftmine_applications_world ON craftmine_applications(world_id,created_at);
    CREATE TABLE IF NOT EXISTS craftmine_applied_drafts (
        task_id TEXT PRIMARY KEY REFERENCES craftmine_workspaces(task_id),
        draft_hash TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES craftmine_applications(id)
    );")?;
    Ok(())
}

fn expire(db: &Connection) -> Result<()> {
    db.execute(
        "UPDATE craftmine_applications SET status='interrupted',token=NULL,updated_at=?1
        WHERE status='prepared' AND updated_at < ?2",
        params![worlds::timestamp()?, worlds::timestamp()? - 60_000],
    )?;
    Ok(())
}

pub(super) fn assert_idle(db: &Connection, world: &str) -> Result<()> {
    expire(db)?;
    let active:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_applications WHERE world_id=?1 AND status='prepared')",[world],|r|r.get(0))?;
    ensure!(!active, "WORLD_APPLICATION_BUSY");
    Ok(())
}

pub(super) fn was_applied(db: &Connection, task: &str, hash: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_applied_drafts WHERE task_id=?1 AND draft_hash=?2)",
        params![task, hash],
        |r| r.get(0),
    )?)
}

fn read(db: &Connection, id: &str) -> Result<Value> {
    expire(db)?;
    let (input,hash,status,output,output_hash,created,updated):(String,String,String,Option<String>,Option<String>,i64,i64)=db.query_row(
        "SELECT input,input_hash,status,output,output_hash,created_at,updated_at FROM craftmine_applications WHERE id=?1",[id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).context("APPLICATION_NOT_FOUND")?;
    ensure!(digest(&input) == hash, "CORRUPT_APPLICATION_INPUT");
    let output: Option<Value> = output
        .map(|body| {
            ensure!(
                Some(digest(&body)) == output_hash,
                "CORRUPT_APPLICATION_OUTPUT"
            );
            Ok(serde_json::from_str(&body)?)
        })
        .transpose()?;
    Ok(
        json!({"id":id,"input":serde_json::from_str::<Value>(&input)?,"inputHash":hash,"status":status,
        "output":output,"outputHash":output_hash,"createdAt":created,"updatedAt":updated}),
    )
}

impl TaskJournal {
    /// Private broker operation. Panel input contains IDs and its saved revision;
    /// the broker computes migration from Rust's latest snapshot, never preview state.
    pub fn application_prepare(
        &mut self,
        id: &str,
        token: &str,
        check: &str,
        review_id: &str,
        world_id: &str,
        revision: u64,
        snapshot: &Value,
    ) -> Result<Value> {
        super::workspaces::call_id(id)?;
        super::workspaces::call_id(token)?;
        let request_hash = digest(&document(
            &json!({"check":check,"review":review_id,"worldId":world_id,"revision":revision,"snapshot":snapshot}),
        )?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<String> = tx
            .query_row(
                "SELECT request_hash FROM craftmine_applications WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(hash) = prior {
            ensure!(hash == request_hash, "REPLAY_MISMATCH");
            return read(&tx, id);
        }
        assert_idle(&tx, world_id)?;
        let job = verification::read(&tx, check)?;
        ensure!(
            job["status"] == "passed" && job["current"] == true,
            "VERIFIED_CURRENT_DRAFT_REQUIRED"
        );
        ensure!(
            job["input"]["worldId"] == world_id,
            "APPLICATION_WORLD_MISMATCH"
        );
        let review = reviews::require_ready(&tx, check, review_id)?;
        let before = worlds::read(&tx, world_id)?;
        ensure!(
            before.summary.revision == revision,
            "WORLD_REVISION_CONFLICT"
        );
        ensure!(
            snapshot["player"] == before.world.snapshot["player"],
            "APPLICATION_PLAYER_CHANGED"
        );
        let prepared = WorldDocument {
            build: job["output"]["artifact"]["build"].clone(),
            extensions: serde_json::from_value(job["output"]["artifact"]["extensions"].clone())?,
            snapshot: snapshot.clone(),
        };
        worlds::encode(&prepared)?;
        let input = json!({"worldId":world_id,"revision":revision,"baseBuild":before.world.build["id"],
            "worldHash":before.content_hash,"verificationId":check,"verificationOutputHash":job["outputHash"],
            "reviewId":review_id,"reviewOutputHash":review["outputHash"],"buildId":prepared.build["id"],
            "snapshot":snapshot,"binding":job["input"]["binding"],"draftHash":job["input"]["draftHash"]});
        let body = document(&input)?;
        let previous = worlds::encode(&before.world)?;
        let now = worlds::timestamp()?;
        tx.execute("INSERT INTO craftmine_applications(id,world_id,verification_id,review_id,request_hash,input,input_hash,previous_world,previous_hash,status,token,created_at,updated_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'prepared',?10,?11,?11)",params![id,world_id,check,review_id,request_hash,body,digest(&body),previous,digest(&previous),token,now])?;
        tx.commit()?;
        read(&self.db, id)
    }

    /// Native loading proves migration/startup/render in a disposable copy.
    /// That copy's rewards and time are discarded: only the prepared migration
    /// is committed, so formal activation cannot duplicate preflight effects.
    pub fn application_commit(&mut self, id: &str, token: &str, evidence: &Value) -> Result<Value> {
        let output_body = document(evidence)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let receipt = read(&tx, id)?;
        let owner: Option<String> = tx.query_row(
            "SELECT token FROM craftmine_applications WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        ensure!(
            owner.as_deref() == Some(token),
            "APPLICATION_OWNER_MISMATCH"
        );
        if receipt["status"] == "applied" {
            ensure!(
                receipt["outputHash"] == digest(&output_body),
                "REPLAY_MISMATCH"
            );
            return Ok(receipt);
        }
        ensure!(receipt["status"] == "prepared", "APPLICATION_INACTIVE");
        let input = &receipt["input"];
        let world_id = input["worldId"].as_str().context("WORLD_ID_REQUIRED")?;
        let before = worlds::read(&tx, world_id)?;
        ensure!(
            input["revision"] == before.summary.revision
                && input["worldHash"] == before.content_hash,
            "WORLD_REVISION_CONFLICT"
        );
        let check = input["verificationId"].as_str().context("CHECK_REQUIRED")?;
        let job = verification::read(&tx, check)?;
        ensure!(
            job["status"] == "passed" && job["current"] == true,
            "VERIFIED_CURRENT_DRAFT_REQUIRED"
        );
        ensure!(
            job["outputHash"] == input["verificationOutputHash"],
            "APPLICATION_EVIDENCE_MISMATCH"
        );
        let review = reviews::require_ready(
            &tx,
            check,
            input["reviewId"].as_str().context("REVIEW_REQUIRED")?,
        )?;
        ensure!(
            review["outputHash"] == input["reviewOutputHash"],
            "APPLICATION_EVIDENCE_MISMATCH"
        );
        ensure!(
            evidence["format"] == "craftmine.desktop-application/1"
                && evidence["inputHash"] == receipt["inputHash"],
            "APPLICATION_EVIDENCE_MISMATCH"
        );
        ensure!(
            evidence["render"]["passed"] == true
                && evidence["render"]["version"] == input["buildId"],
            "APPLICATION_LOAD_REQUIRED"
        );
        ensure!(
            evidence["render"]["capture"]["sha256"]
                .as_str()
                .is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit())),
            "APPLICATION_RENDER_REQUIRED"
        );
        ensure!(
            evidence["player"] == input["snapshot"]["player"],
            "APPLICATION_PLAYER_CHANGED"
        );
        let world = WorldDocument {
            build: job["output"]["artifact"]["build"].clone(),
            snapshot: input["snapshot"].clone(),
            extensions: before.world.extensions,
        };
        let body = worlds::encode(&world)?;
        let revision: i64 = before
            .summary
            .revision
            .checked_add(1)
            .context("REVISION_OVERFLOW")?
            .try_into()?;
        let now = worlds::timestamp()?;
        tx.execute("UPDATE craftmine_worlds SET document=?2,content_hash=?3,revision=?4,updated_at=?5 WHERE id=?1",params![world_id,body,digest(&body),revision,now])?;
        tx.execute("UPDATE craftmine_applications SET status='applied',output=?2,output_hash=?3,updated_at=?4 WHERE id=?1",params![id,output_body,digest(&output_body),now])?;
        let task = input["binding"]["taskId"]
            .as_str()
            .context("TASK_REQUIRED")?;
        tx.execute("INSERT INTO craftmine_applied_drafts(task_id,draft_hash,application_id) VALUES(?1,?2,?3)",params![task,input["draftHash"].as_str().context("DRAFT_HASH_REQUIRED")?,id])?;
        tx.execute(
            "UPDATE craftmine_tasks SET status='finished' WHERE id=?1",
            [task],
        )?;
        tx.execute(
            "DELETE FROM craftmine_world_leases WHERE task_id=?1",
            [task],
        )?;
        tx.commit()?;
        read(&self.db, id)
    }

    pub fn application_read(&self, id: &str) -> Result<Value> {
        read(&self.db, id)
    }
    pub fn application_abort(&mut self, id: &str) -> Result<Value> {
        self.db.execute("UPDATE craftmine_applications SET status='aborted',token=NULL,updated_at=?2 WHERE id=?1 AND status='prepared'",params![id,worlds::timestamp()?])?;
        read(&self.db, id)
    }
    pub fn application_recover(&mut self) -> Result<usize> {
        Ok(self.db.execute("UPDATE craftmine_applications SET status='interrupted',token=NULL,updated_at=?1 WHERE status='prepared'",[worlds::timestamp()?])?)
    }
}
