//! Durable advisory review. Only machine assertions may reject a candidate;
//! the reviewer's design verdict is never interpreted as an application gate.
use super::{digest, document, verification, worlds, TaskJournal};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_reviews (
        id TEXT PRIMARY KEY, verification_id TEXT NOT NULL REFERENCES craftmine_verifications(id),
        input TEXT NOT NULL, input_hash TEXT NOT NULL, status TEXT NOT NULL,
        token TEXT, output TEXT, output_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS craftmine_reviews_check ON craftmine_reviews(verification_id,created_at);
    CREATE TABLE IF NOT EXISTS craftmine_review_plans (
        review_id TEXT PRIMARY KEY REFERENCES craftmine_reviews(id), plan TEXT NOT NULL, hash TEXT NOT NULL
    );")?;
    Ok(())
}

pub(super) fn expire(db: &Connection) -> Result<()> {
    db.execute(
        "UPDATE craftmine_reviews SET status='interrupted',token=NULL,updated_at=?1
        WHERE status='running' AND updated_at < ?2",
        params![worlds::timestamp()?, worlds::timestamp()? - 180_000],
    )?;
    Ok(())
}

pub(super) fn read(db: &Connection, id: &str) -> Result<Value> {
    expire(db)?;
    let (check, input, hash, status, output, output_hash, created, updated):
        (String,String,String,String,Option<String>,Option<String>,i64,i64) = db.query_row(
        "SELECT verification_id,input,input_hash,status,output,output_hash,created_at,updated_at FROM craftmine_reviews WHERE id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).context("REVIEW_NOT_FOUND")?;
    ensure!(digest(&input) == hash, "CORRUPT_REVIEW_INPUT");
    let output: Option<Value> = output
        .map(|body| {
            ensure!(Some(digest(&body)) == output_hash, "CORRUPT_REVIEW_OUTPUT");
            Ok(serde_json::from_str(&body)?)
        })
        .transpose()?;
    let input: Value = serde_json::from_str(&input)?;
    let job = verification::read(db, &check)?;
    Ok(
        json!({"id":id,"verificationId":check,"input":input,"inputHash":hash,"status":status,
        "output":output,"outputHash":output_hash,"current":job["current"],"createdAt":created,"updatedAt":updated}),
    )
}

pub(super) fn require_ready(db: &Connection, check: &str, id: &str) -> Result<Value> {
    require_ready_with_acknowledgement(db, check, id, false)
}

pub(super) fn require_ready_with_acknowledgement(
    db: &Connection,
    check: &str,
    id: &str,
    acknowledged: bool,
) -> Result<Value> {
    let review = read(db, id)?;
    ensure!(review["verificationId"] == check, "REVIEW_BINDING_MISMATCH");
    ensure!(review["status"] == "completed", "REVIEW_REQUIRED");
    ensure!(review["current"] == true, "REVIEW_NOT_CURRENT");
    let job = verification::read(db, check)?;
    ensure!(
        review["input"]["verificationOutputHash"] == job["outputHash"],
        "REVIEW_EVIDENCE_MISMATCH"
    );
    ensure!(
        review["output"]["acceptance"]["passed"] == true
            || (acknowledged && review["output"]["acceptance"]["passed"] == false),
        "REQUEST_CHECK_FAILED"
    );
    // The advisory verdict, including "block", is deliberately not a gate.
    Ok(review)
}

impl TaskJournal {
    /// Seal the model's exact response and executable assertion data before
    /// observing its test run. Replays cannot replace that plan.
    pub fn review_plan(&mut self, id: &str, token: &str, plan: &Value) -> Result<Value> {
        let body = document(plan)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let review = read(&tx, id)?;
        let owner: Option<String> = tx.query_row(
            "SELECT token FROM craftmine_reviews WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        ensure!(owner.as_deref() == Some(token), "REVIEW_OWNER_MISMATCH");
        ensure!(
            review["status"] == "running" && review["current"] == true,
            "REVIEW_INACTIVE"
        );
        ensure!(
            plan["modelKey"] == review["input"]["origin"]["modelKey"],
            "REVIEW_MODEL_MISMATCH"
        );
        ensure!(
            plan["text"].as_str().is_some_and(|t| !t.trim().is_empty()),
            "REVIEW_TEXT_REQUIRED"
        );
        let assertions = plan["assertions"]
            .as_array()
            .context("REQUEST_ASSERTIONS_REQUIRED")?;
        ensure!(
            !assertions.is_empty() && assertions.len() <= 24,
            "REQUEST_ASSERTIONS_REQUIRED"
        );
        let prior: Option<String> = tx
            .query_row(
                "SELECT hash FROM craftmine_review_plans WHERE review_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(hash) = prior {
            ensure!(hash == digest(&body), "REPLAY_MISMATCH");
        } else {
            tx.execute(
                "INSERT INTO craftmine_review_plans(review_id,plan,hash) VALUES(?1,?2,?3)",
                params![id, body, digest(&body)],
            )?;
        }
        tx.commit()?;
        Ok(json!({"hash":digest(&body)}))
    }

    pub fn review_start(&mut self, check: &str, id: &str, token: &str) -> Result<Value> {
        super::workspaces::call_id(id)?;
        super::workspaces::call_id(token)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let job = verification::read(&tx, check)?;
        ensure!(
            job["status"] == "passed" && job["current"] == true,
            "VERIFIED_CURRENT_DRAFT_REQUIRED"
        );
        let origin = &job["input"]["origin"];
        ensure!(
            origin["request"]["text"]
                .as_str()
                .is_some_and(|t| !t.trim().is_empty()),
            "HOST_REQUEST_REQUIRED"
        );
        ensure!(
            origin["modelKey"].as_str().is_some_and(|t| t.contains('/')),
            "REVIEW_MODEL_REQUIRED"
        );
        let input = json!({"verificationId":check,"verificationInputHash":job["inputHash"],
            "verificationOutputHash":job["outputHash"],"origin":origin});
        let body = document(&input)?;
        let prior: Option<String> = tx
            .query_row(
                "SELECT input_hash FROM craftmine_reviews WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(hash) = prior {
            ensure!(digest(&body) == hash, "REPLAY_MISMATCH");
            return read(&tx, id);
        }
        expire(&tx)?;
        let running:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_reviews WHERE verification_id=?1 AND status='running')",[check],|r|r.get(0))?;
        ensure!(!running, "REVIEW_BUSY");
        let now = worlds::timestamp()?;
        tx.execute("INSERT INTO craftmine_reviews(id,verification_id,input,input_hash,status,token,created_at,updated_at)
            VALUES(?1,?2,?3,?4,'running',?5,?6,?6)",params![id,check,body,digest(&body),token,now])?;
        tx.commit()?;
        read(&self.db, id)
    }

    pub fn review_finish(&mut self, id: &str, token: &str, output: &Value) -> Result<Value> {
        let body = document(output)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let review = read(&tx, id)?;
        let owner: Option<String> = tx.query_row(
            "SELECT token FROM craftmine_reviews WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        ensure!(owner.as_deref() == Some(token), "REVIEW_OWNER_MISMATCH");
        if matches!(review["status"].as_str(), Some("completed" | "failed")) {
            ensure!(review["outputHash"] == digest(&body), "REPLAY_MISMATCH");
            return Ok(review);
        }
        ensure!(
            review["status"] == "running" && review["current"] == true,
            "REVIEW_INACTIVE"
        );
        ensure!(
            output["inputHash"] == review["inputHash"],
            "REVIEW_INPUT_MISMATCH"
        );
        let failed = output["error"].is_string();
        if !failed {
            let (body, hash): (String, String) = tx
                .query_row(
                    "SELECT plan,hash FROM craftmine_review_plans WHERE review_id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .context("REVIEW_PLAN_REQUIRED")?;
            ensure!(
                digest(&body) == hash && output["planHash"] == hash,
                "REVIEW_PLAN_MISMATCH"
            );
            let plan: Value = serde_json::from_str(&body)?;
            ensure!(output["text"] == plan["text"], "REVIEW_TEXT_MISMATCH");
            ensure!(
                output["format"] == "craftmine.desktop-review/1" && output["advisory"] == true,
                "INVALID_REVIEW"
            );
            ensure!(
                output["modelKey"] == review["input"]["origin"]["modelKey"],
                "REVIEW_MODEL_MISMATCH"
            );
            ensure!(
                output["text"]
                    .as_str()
                    .is_some_and(|t| !t.trim().is_empty()),
                "REVIEW_TEXT_REQUIRED"
            );
            let assertions = output["acceptance"]["assertions"]
                .as_array()
                .context("REQUEST_ASSERTIONS_REQUIRED")?;
            ensure!(
                !assertions.is_empty() && assertions.len() <= 24,
                "REQUEST_ASSERTIONS_REQUIRED"
            );
            let planned = plan["assertions"]
                .as_array()
                .context("REQUEST_ASSERTIONS_REQUIRED")?;
            ensure!(
                assertions.len() == planned.len()
                    && assertions
                        .iter()
                        .zip(planned)
                        .all(|(a, b)| a["id"] == b["id"]),
                "REQUEST_EVIDENCE_MISMATCH"
            );
            ensure!(
                assertions.iter().all(|a| a["passed"].is_boolean()),
                "INVALID_REQUEST_EVIDENCE"
            );
            ensure!(
                output["acceptance"]["passed"] == assertions.iter().all(|a| a["passed"] == true),
                "REQUEST_EVIDENCE_MISMATCH"
            );
            ensure!(
                output["acceptance"]["verificationOutputHash"]
                    == review["input"]["verificationOutputHash"],
                "REQUEST_EVIDENCE_MISMATCH"
            );
        }
        tx.execute("UPDATE craftmine_reviews SET status=?2,output=?3,output_hash=?4,updated_at=?5 WHERE id=?1",
            params![id,if failed {"failed"} else {"completed"},body,digest(&body),worlds::timestamp()?])?;
        tx.commit()?;
        read(&self.db, id)
    }

    pub fn review_read(&self, id: &str) -> Result<Value> {
        read(&self.db, id)
    }
    pub fn review_list(&self, check: &str) -> Result<Vec<Value>> {
        let mut s=self.db.prepare("SELECT id FROM craftmine_reviews WHERE verification_id=?1 ORDER BY created_at DESC,id DESC LIMIT 8")?;
        let ids = s.query_map([check], |r| r.get::<_, String>(0))?;
        ids.map(|id| read(&self.db, &id?)).collect()
    }
    pub fn review_cancel(&mut self, id: &str) -> Result<Value> {
        self.db.execute("UPDATE craftmine_reviews SET status='cancelled',token=NULL,updated_at=?2 WHERE id=?1 AND status='running'",params![id,worlds::timestamp()?])?;
        read(&self.db, id)
    }
    pub fn review_recover(&mut self) -> Result<usize> {
        Ok(self.db.execute("UPDATE craftmine_reviews SET status='interrupted',token=NULL,updated_at=?1 WHERE status='running'",[worlds::timestamp()?])?)
    }
}
