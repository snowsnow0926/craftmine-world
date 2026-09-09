//! Bounded portable domain archives, validated before an atomic replacement.
use super::{
    digest,
    durable::{fields, text},
    library, memories, read_task, worlds, TaskJournal,
};
use anyhow::{ensure, Context, Result};
use rusqlite::{
    params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection, OptionalExtension, TransactionBehavior,
};
use serde_json::{json, Map, Value};

const LIMIT: usize = 32 * 1024 * 1024;
const SCHEMA_VERSION: u64 = 2;
const TABLES: &[&str] = &[
    "craftmine_worlds",
    "craftmine_tasks",
    "craftmine_receipts",
    "craftmine_session_worlds",
    "craftmine_workspaces",
    "craftmine_world_leases",
    "craftmine_workspace_reads",
    "craftmine_workspace_revisions",
    "craftmine_ended_turns",
    "craftmine_verifications",
    "craftmine_reviews",
    "craftmine_review_plans",
    "craftmine_applications",
    "craftmine_applied_drafts",
    "craftmine_task_runtime",
    "craftmine_budget_limits",
    "craftmine_budget_requests",
    "craftmine_budget_events",
    "craftmine_budget_settlement_history",
    "craftmine_task_requirements",
    "craftmine_library",
    "craftmine_library_operations",
    "craftmine_memories",
    "craftmine_memory_operations",
    "craftmine_memory_history",
];
pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_backup_jobs (
 id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,request_hash TEXT NOT NULL,
 archive_hash TEXT,receipt TEXT NOT NULL,archive TEXT,created_at INTEGER NOT NULL);",
    )?;
    Ok(())
}
fn columns(db: &Connection, table: &str) -> Result<Vec<String>> {
    Ok(db
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |r| r.get(1))?
        .collect::<rusqlite::Result<_>>()?)
}
fn snapshot(db: &Connection) -> Result<Value> {
    let mut tables = Map::new();
    let mut bytes = 0;
    for table in TABLES {
        let columns = columns(db, table)?;
        let mut statement = db.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let mut rows = statement.query([])?;
        let mut records = Vec::new();
        while let Some(row) = rows.next()? {
            ensure!(records.len() < 100000, "BACKUP_ROW_LIMIT");
            let mut cells = Vec::new();
            for index in 0..columns.len() {
                cells.push(match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(s) => json!(std::str::from_utf8(s)?),
                    ValueRef::Blob(_) => anyhow::bail!("BACKUP_UNSUPPORTED_BLOB"),
                });
            }
            bytes += serde_json::to_vec(&cells)?.len();
            ensure!(bytes <= LIMIT, "BACKUP_TOO_LARGE");
            records.push(Value::Array(cells));
        }
        tables.insert(table.to_string(), json!({"columns":columns,"rows":records}));
    }
    Ok(Value::Object(tables))
}
fn fingerprint(db: &Connection) -> Result<String> {
    Ok(digest(&serde_json::to_string(&snapshot(db)?)?))
}
fn compatible_tables(archive: &Value) -> Result<Value> {
    let mut tables = archive["tables"].clone();
    let map = tables.as_object().context("BACKUP_TABLES_REQUIRED")?;
    ensure!(
        map.len() == TABLES.len() && TABLES.iter().all(|name| map.contains_key(*name)),
        "BACKUP_SCHEMA_MISMATCH"
    );
    if archive["schemaVersion"] == 1 {
        let operations = &mut tables["craftmine_memory_operations"];
        fields(operations, &["columns", "rows"])?;
        ensure!(
            operations["columns"] == json!(["operation_id", "request_hash", "result"]),
            "BACKUP_COLUMNS_MISMATCH"
        );
        operations["columns"] = json!(["operation_id", "request_hash", "result", "request_json"]);
        for row in operations["rows"]
            .as_array_mut()
            .context("BACKUP_ROWS_REQUIRED")?
        {
            let cells = row.as_array_mut().context("BACKUP_ROW_REQUIRED")?;
            ensure!(cells.len() == 3, "BACKUP_ROW_WIDTH_MISMATCH");
            // Old archives cannot attest a host session; never infer one.
            cells.push(Value::Null);
        }
    }
    Ok(tables)
}
fn restore_tables(db: &Connection, tables: &Value) -> Result<()> {
    let map = tables.as_object().context("BACKUP_TABLES_REQUIRED")?;
    ensure!(
        map.len() == TABLES.len() && TABLES.iter().all(|name| map.contains_key(*name)),
        "BACKUP_SCHEMA_MISMATCH"
    );
    db.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    for table in TABLES {
        db.execute(&format!("DELETE FROM {table}"), [])?;
    }
    for table in TABLES {
        let data = &tables[*table];
        fields(data, &["columns", "rows"])?;
        let cols = columns(db, table)?;
        ensure!(data["columns"] == json!(cols), "BACKUP_COLUMNS_MISMATCH");
        let rows = data["rows"].as_array().context("BACKUP_ROWS_REQUIRED")?;
        ensure!(rows.len() <= 100000, "BACKUP_ROW_LIMIT");
        let placeholders = (1..=cols.len())
            .map(|n| format!("?{n}"))
            .collect::<Vec<_>>()
            .join(",");
        let mut statement = db.prepare(&format!("INSERT INTO {table} VALUES({placeholders})"))?;
        for row in rows {
            let row = row.as_array().context("BACKUP_ROW_REQUIRED")?;
            ensure!(row.len() == cols.len(), "BACKUP_ROW_WIDTH_MISMATCH");
            let values = row
                .iter()
                .map(|v| match v {
                    Value::Null => Ok(SqlValue::Null),
                    Value::String(s) => Ok(SqlValue::Text(s.clone())),
                    Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            Ok(SqlValue::Integer(i))
                        } else if let Some(f) = n.as_f64() {
                            Ok(SqlValue::Real(f))
                        } else {
                            anyhow::bail!("INVALID_SQL_NUMBER")
                        }
                    }
                    _ => anyhow::bail!("INVALID_SQL_VALUE"),
                })
                .collect::<Result<Vec<_>>>()?;
            statement.execute(params_from_iter(values))?;
        }
    }
    Ok(())
}
fn validate_integrity(db: &Connection) -> Result<()> {
    memories::validate_receipts(db)?;
    let foreign: Option<String> = db
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |r| r.get(0))
        .optional()?;
    ensure!(foreign.is_none(), "BACKUP_FOREIGN_KEY_FAILURE");
    let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    ensure!(integrity == "ok", "BACKUP_DATABASE_CORRUPT");
    for id in db
        .prepare("SELECT id FROM craftmine_worlds")?
        .query_map([], |r| r.get::<_, String>(0))?
    {
        let record = worlds::read(db, &id?)?;
        worlds::encode(&record.world)?;
    }
    for id in db
        .prepare("SELECT id FROM craftmine_tasks")?
        .query_map([], |r| r.get::<_, String>(0))?
    {
        read_task(db, &id?)?;
    }
    for row in db.prepare("SELECT id,version,hash FROM craftmine_library")?.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"version":r.get::<_,i64>(1)?,"hash":r.get::<_,String>(2)?})))?{library::read(db,&row?)?;}
    for table in [
        "craftmine_verifications",
        "craftmine_reviews",
        "craftmine_applications",
    ] {
        for row in db
            .prepare(&format!(
                "SELECT input,input_hash,output,output_hash FROM {table}"
            ))?
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?
        {
            let (input, hash, output, out_hash) = row?;
            ensure!(digest(&input) == hash, "BACKUP_EVIDENCE_CORRUPT");
            if let Some(output) = output {
                ensure!(Some(digest(&output)) == out_hash, "BACKUP_EVIDENCE_CORRUPT");
            }
        }
    }
    Ok(())
}
fn validate_archive(db: &Connection, archive: &Value) -> Result<Value> {
    ensure!(
        serde_json::to_vec(archive)?.len() <= LIMIT,
        "BACKUP_TOO_LARGE"
    );
    fields(
        archive,
        &["format", "schemaVersion", "createdAt", "tables", "hash"],
    )?;
    ensure!(
        archive["format"] == "craftmine.domain-backup/1"
            && matches!(archive["schemaVersion"].as_u64(), Some(1 | SCHEMA_VERSION)),
        "BACKUP_VERSION_UNSUPPORTED"
    );
    let hash = digest(&serde_json::to_string(&archive["tables"])?);
    ensure!(archive["hash"] == hash, "BACKUP_HASH_MISMATCH");
    let mut staging = Connection::open_in_memory()?;
    staging.execute_batch("PRAGMA foreign_keys=ON;")?;
    for table in TABLES {
        let sql: String = db.query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |r| r.get(0),
        )?;
        staging.execute_batch(&sql)?;
    }
    let tx = staging.transaction_with_behavior(TransactionBehavior::Immediate)?;
    restore_tables(&tx, &compatible_tables(archive)?)?;
    validate_integrity(&tx)?;
    tx.commit()?;
    let known:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_backup_jobs WHERE kind='export' AND archive_hash=?1 AND status='completed')",[&hash],|r|r.get(0))?;
    let counts = archive["tables"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(name, data)| (name.clone(), json!(data["rows"].as_array().unwrap().len())))
        .collect::<Map<_, _>>();
    Ok(
        json!({"valid":true,"hash":hash,"counts":counts,"knownLocalExport":known,"bytes":serde_json::to_vec(archive)?.len()}),
    )
}
fn assert_idle(db: &Connection) -> Result<()> {
    let active:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_world_leases) OR EXISTS(SELECT 1 FROM craftmine_verifications WHERE status IN ('queued','running')) OR EXISTS(SELECT 1 FROM craftmine_reviews WHERE status IN ('queued','running')) OR EXISTS(SELECT 1 FROM craftmine_applications WHERE status='prepared')",[],|r|r.get(0))?;
    ensure!(!active, "BACKUP_RESTORE_WORLD_BUSY");
    Ok(())
}
fn job_capacity(db: &Connection, additional: usize) -> Result<()> {
    let (count, bytes): (i64, i64) = db.query_row(
        "SELECT COUNT(*),COALESCE(SUM(length(archive)),0) FROM craftmine_backup_jobs",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    ensure!(
        count < 64 && bytes >= 0 && bytes as usize + additional <= 128 * 1024 * 1024,
        "BACKUP_RECEIPT_CAPACITY_REACHED"
    );
    Ok(())
}
impl TaskJournal {
    pub fn backup_export(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId"])?;
        let id = text(args, "operationId", 240)?;
        let hash = digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous:Option<(String,String,String)>=tx.query_row("SELECT request_hash,receipt,archive FROM craftmine_backup_jobs WHERE id=?1 AND kind='export'",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        if let Some((old, receipt, archive)) = previous {
            ensure!(old == hash, "REPLAY_MISMATCH");
            let mut result: Value = serde_json::from_str(&receipt)?;
            result["archive"] = serde_json::from_str(&archive)?;
            return Ok(result);
        }
        let tables = snapshot(&tx)?;
        let content_hash = digest(&serde_json::to_string(&tables)?);
        let archive = json!({"format":"craftmine.domain-backup/1","schemaVersion":SCHEMA_VERSION,"createdAt":worlds::timestamp()?,"tables":tables,"hash":content_hash});
        let body = serde_json::to_string(&archive)?;
        ensure!(body.len() <= LIMIT, "BACKUP_TOO_LARGE");
        job_capacity(&tx, body.len())?;
        let receipt = json!({"id":id,"status":"completed","kind":"export","manifest":{"hash":content_hash,"bytes":body.len(),"schemaVersion":SCHEMA_VERSION},"credentialsIncluded":false});
        tx.execute("INSERT INTO craftmine_backup_jobs(id,kind,status,request_hash,archive_hash,receipt,archive,created_at) VALUES(?1,'export','completed',?2,?3,?4,?5,?6)",params![id,hash,content_hash,serde_json::to_string(&receipt)?,body,worlds::timestamp()?])?;
        tx.commit()?;
        let mut result = receipt;
        result["archive"] = archive;
        Ok(result)
    }
    pub fn backup_inspect(&self, args: &Value) -> Result<Value> {
        fields(args, &["archive"])?;
        validate_archive(&self.db, &args["archive"])
    }
    pub fn backup_restore(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "archive", "expectedCurrentHash"])?;
        let id = text(args, "operationId", 240)?;
        let expected = text(args, "expectedCurrentHash", 64)?;
        let request_hash = digest(&serde_json::to_string(args)?);
        let previous: Option<(String, String)> = self
            .db
            .query_row(
                "SELECT request_hash,receipt FROM craftmine_backup_jobs WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((hash, receipt)) = previous {
            ensure!(hash == request_hash, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&receipt)?);
        }
        let manifest = validate_archive(&self.db, &args["archive"])?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        assert_idle(&tx)?;
        ensure!(
            fingerprint(&tx)? == expected,
            "BACKUP_CURRENT_STATE_CONFLICT"
        );
        let before = snapshot(&tx)?;
        let previous_hash = digest(&serde_json::to_string(&before)?);
        job_capacity(&tx, serde_json::to_vec(&before)?.len() + 256)?;
        restore_tables(&tx, &compatible_tables(&args["archive"])?)?;
        // Raw legacy import archives remain outside portable backups. Keep
        // their local manifests, but detach a link whose world was replaced.
        tx.execute("UPDATE craftmine_legacy_imports SET world_id=NULL,world_hash=NULL WHERE world_id IS NOT NULL AND world_id NOT IN (SELECT id FROM craftmine_worlds)",[])?;
        // Restoring never launches a request, even for a locally signed-off run.
        tx.execute("INSERT OR IGNORE INTO craftmine_task_runtime(task_id,generation,budget_owner,recovery) SELECT id,1,id,'none' FROM craftmine_tasks",[])?;
        tx.execute("UPDATE craftmine_task_runtime SET recovery='interrupted' WHERE task_id IN (SELECT id FROM craftmine_tasks WHERE status='running')",[])?;
        tx.execute(
            "UPDATE craftmine_tasks SET status='cancelled' WHERE status='running'",
            [],
        )?;
        tx.execute("DELETE FROM craftmine_world_leases", [])?;
        tx.execute("UPDATE craftmine_verifications SET status='interrupted',run_token=NULL WHERE status IN ('queued','running')",[])?;
        tx.execute("UPDATE craftmine_reviews SET status='interrupted',token=NULL WHERE status IN ('queued','running')",[])?;
        tx.execute("UPDATE craftmine_applications SET status='interrupted',token=NULL WHERE status='prepared'",[])?;
        tx.execute("UPDATE craftmine_budget_requests SET status='unknown',settlement=json_object('status','unknown','errorCode','BACKUP_RESTORED') WHERE status='reserved'",[])?;
        if manifest["knownLocalExport"] != true {
            tx.execute("UPDATE craftmine_applications SET status='imported',token=NULL WHERE status='applied'",[])?;
            tx.execute("UPDATE craftmine_memories SET record=json_set(record,'$.status','needs_revalidation') WHERE json_extract(record,'$.status')='validated'",[])?;
            tx.execute("UPDATE craftmine_library SET metadata=json_set(metadata,'$.evidence.imported',json('true'),'$.evidence.verified',json('false'),'$.evidence.applied',json('false'),'$.evidence.needsRevalidation',json('true'))",[])?;
        }
        validate_integrity(&tx)?;
        let receipt = json!({"id":id,"kind":"restore","status":"completed","archiveHash":manifest["hash"],"previousHash":previous_hash,"currentHash":fingerprint(&tx)?,"modelReplay":false,"importedProvenance":manifest["knownLocalExport"]!=true});
        // Retain the exact previous domain state as a rollback archive receipt.
        let previous_archive = json!({"format":"craftmine.domain-backup/1","schemaVersion":SCHEMA_VERSION,"createdAt":worlds::timestamp()?,"tables":before,"hash":previous_hash});
        tx.execute("INSERT INTO craftmine_backup_jobs(id,kind,status,request_hash,archive_hash,receipt,archive,created_at) VALUES(?1,'restore','completed',?2,?3,?4,?5,?6)",params![id,request_hash,manifest["hash"].as_str(),serde_json::to_string(&receipt)?,serde_json::to_string(&previous_archive)?,worlds::timestamp()?])?;
        tx.commit()?;
        Ok(receipt)
    }
    pub fn backup_status(&self, args: &Value) -> Result<Value> {
        fields(args, &["id"])?;
        if let Some(id) = args["id"].as_str() {
            let receipt: String = self
                .db
                .query_row(
                    "SELECT receipt FROM craftmine_backup_jobs WHERE id=?1",
                    [id],
                    |r| r.get(0),
                )
                .context("BACKUP_JOB_NOT_FOUND")?;
            return Ok(serde_json::from_str(&receipt)?);
        }
        Ok(
            json!({"currentHash":fingerprint(&self.db)?,"archiveLimitBytes":LIMIT,"schemaVersion":SCHEMA_VERSION}),
        )
    }
    pub fn backup_cancel(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId"])?;
        let id = text(args, "operationId", 240)?;
        job_capacity(&self.db, 0)?;
        let receipt = json!({"id":id,"status":"cancelled","kind":"restore"});
        self.db.execute("INSERT INTO craftmine_backup_jobs(id,kind,status,request_hash,receipt,created_at) VALUES(?1,'restore','cancelled','cancelled',?2,?3)",params![id,serde_json::to_string(&receipt)?,worlds::timestamp()?]).context("BACKUP_ALREADY_STARTED_OR_COMPLETED")?;
        Ok(receipt)
    }
}
