//! Exact per-attempt observations. SQLite ownership stays in host-core.
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

use crate::db::{now_ms, Database};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS task_metric_calls (
 turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL, observation_json TEXT NOT NULL,
 PRIMARY KEY(turn_id, call_id));
 CREATE TABLE IF NOT EXISTS task_metric_gaps (
 turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS task_metric_interruptions (
 turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE);";

pub fn mark_unavailable(db: &Database, session_id: &str, turn_id: &str) -> Result<Value> {
    let exists: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1 AND session_id=?2)",
        params![turn_id, session_id],
        |r| r.get(0),
    )?;
    if !exists {
        bail!("TASK_METRICS_OWNER_MISMATCH");
    }
    db.conn().execute(
        "INSERT OR IGNORE INTO task_metric_gaps(turn_id) VALUES(?1)",
        [turn_id],
    )?;
    Ok(json!({"ok":true}))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_read_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_write_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_tokens: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Call {
    call_id: String,
    provider_id: String,
    model_id: String,
    source: String,
    started_at_ms: i64,
    generation_started_at_ms: Option<i64>,
    ended_at_ms: Option<i64>,
    outcome: String,
    usage: Option<Usage>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}
fn validate(call: &Call) -> Result<()> {
    if !valid_id(&call.call_id)
        || !valid_id(&call.provider_id)
        || !valid_id(&call.model_id)
        || !["agent", "subagent", "compaction"].contains(&call.source.as_str())
        || !["running", "completed", "error", "aborted"].contains(&call.outcome.as_str())
        || !(0..=9_007_199_254_740_991).contains(&call.started_at_ms)
        || call.ended_at_ms.is_some_and(|v| {
            v < call.started_at_ms
                || v > 9_007_199_254_740_991
                || v - call.started_at_ms > 604_800_000
        })
        || (call.outcome == "running") != call.ended_at_ms.is_none()
        || (call.outcome == "running" && call.usage.is_some())
        || call.generation_started_at_ms.is_some_and(|v| {
            v < call.started_at_ms
                || v > 9_007_199_254_740_991
                || call.ended_at_ms.is_some_and(|end| v > end)
        })
    {
        bail!("INVALID_TASK_METRIC_CALL");
    }
    if let Some(u) = &call.usage {
        if [
            Some(u.input_tokens),
            Some(u.output_tokens),
            Some(u.total_tokens),
            u.cache_read_tokens,
            u.cache_write_tokens,
            u.reasoning_tokens,
        ]
        .into_iter()
        .flatten()
        .any(|v| v > 1_000_000_000_000)
        {
            bail!("INVALID_TASK_METRIC_USAGE");
        }
    }
    Ok(())
}

/// A terminal receipt is immutable. Replaying start after end cannot regress it.
pub fn observe(db: &Database, session_id: &str, turn_id: &str, value: &Value) -> Result<Value> {
    let call: Call =
        serde_json::from_value(value.clone()).map_err(|_| anyhow!("INVALID_TASK_METRIC_CALL"))?;
    validate(&call)?;
    let tx = db.conn().unchecked_transaction()?;
    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM turns WHERE id=?1 AND session_id=?2",
            params![turn_id, session_id],
            |r| r.get(0),
        )
        .optional()?;
    let status = status.ok_or_else(|| anyhow!("TASK_METRICS_OWNER_MISMATCH"))?;
    let previous: Option<String> = tx
        .query_row(
            "SELECT observation_json FROM task_metric_calls WHERE turn_id=?1 AND call_id=?2",
            params![turn_id, call.call_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(previous) = &previous {
        let old: Call = serde_json::from_str(previous)?;
        let same_identity = old.call_id == call.call_id
            && old.provider_id == call.provider_id
            && old.model_id == call.model_id
            && old.source == call.source
            && old.started_at_ms == call.started_at_ms;
        if old == call
            || (same_identity
                && call.outcome == "running"
                && call.generation_started_at_ms.is_none())
        {
            return Ok(json!({"ok":true,"replayed":true}));
        }
        if !same_identity || old.outcome != "running" {
            bail!("TASK_METRICS_RECEIPT_CONFLICT");
        }
    }
    if status != "running" {
        bail!("TASK_METRICS_TURN_CLOSED");
    }
    if previous.is_none() {
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM task_metric_calls WHERE turn_id=?1",
            [turn_id],
            |r| r.get(0),
        )?;
        if count >= 4096 {
            bail!("TASK_METRICS_CAPACITY");
        }
    }
    tx.execute(
        "INSERT INTO task_metric_calls(turn_id,call_id,observation_json) VALUES(?1,?2,?3)
        ON CONFLICT(turn_id,call_id) DO UPDATE SET observation_json=excluded.observation_json",
        params![turn_id, call.call_id, serde_json::to_string(&call)?],
    )?;
    tx.commit()?;
    Ok(json!({"ok":true,"replayed":false}))
}

fn coverage(reported: usize, observed: usize) -> &'static str {
    if reported == 0 {
        "unknown"
    } else if reported == observed {
        "complete"
    } else {
        "partial"
    }
}
fn aggregate(calls: &[Call]) -> Value {
    let reported: Vec<&Usage> = calls.iter().filter_map(|c| c.usage.as_ref()).collect();
    let usage = if reported.is_empty() {
        Value::Null
    } else {
        let mut u = json!({"inputTokens":reported.iter().map(|u|u.input_tokens).sum::<u64>(),
            "outputTokens":reported.iter().map(|u|u.output_tokens).sum::<u64>(),
            "totalTokens":reported.iter().map(|u|u.total_tokens).sum::<u64>()});
        for (name, values) in [
            (
                "cacheReadTokens",
                reported
                    .iter()
                    .filter_map(|u| u.cache_read_tokens)
                    .collect::<Vec<_>>(),
            ),
            (
                "cacheWriteTokens",
                reported
                    .iter()
                    .filter_map(|u| u.cache_write_tokens)
                    .collect::<Vec<_>>(),
            ),
            (
                "reasoningTokens",
                reported
                    .iter()
                    .filter_map(|u| u.reasoning_tokens)
                    .collect::<Vec<_>>(),
            ),
        ] {
            if !values.is_empty() {
                u[name] = json!(values.iter().sum::<u64>());
            }
        }
        u
    };
    let mut measured: Vec<(i64, i64, u64)> = calls
        .iter()
        .filter_map(|c| {
            let (start, end, u) = (
                c.generation_started_at_ms?,
                c.ended_at_ms?,
                c.usage.as_ref()?,
            );
            (end > start).then_some((start, end, u.output_tokens))
        })
        .collect();
    measured.sort_by_key(|v| v.0);
    let overlap = measured.windows(2).any(|p| p[1].0 < p[0].1);
    let generation: i64 = measured.iter().map(|v| v.1 - v.0).sum();
    let output: u64 = measured.iter().map(|v| v.2).sum();
    let usable = !overlap && generation > 0;
    json!({"coverage":coverage(reported.len(),calls.len()),"usage":usage,
        "calls":{"observed":calls.len(),"reported":reported.len(),"pending":calls.iter().filter(|c|c.outcome=="running").count()},
        "tps":{"value":if usable {Some(output as f64*1000.0/generation as f64)}else{None},
            "outputTokens":if usable{Some(output)}else{None},"generationMs":if usable{Some(generation)}else{None},
            "coverage":if overlap{"unknown"}else{coverage(measured.len(),calls.len())},"window":"model-generation"}})
}

pub fn read(
    db: &Database,
    session_id: &str,
    turn_id: Option<&str>,
    message_id: Option<&str>,
) -> Result<Value> {
    if !valid_id(session_id)
        || turn_id.is_some_and(|v| !valid_id(v))
        || message_id.is_some_and(|v| !valid_id(v))
        || (turn_id.is_some() && message_id.is_some())
    {
        bail!("INVALID_TASK_METRICS_QUERY");
    }
    let mapped: Option<String> = if let Some(id) = message_id {
        db.conn()
            .query_row(
                "SELECT turn_id FROM messages WHERE session_id=?1 AND id=?2",
                params![session_id, id],
                |r| r.get(0),
            )
            .optional()?
            .flatten()
    } else if let Some(id) = turn_id {
        Some(id.to_owned())
    } else {
        db.conn().query_row("SELECT id FROM turns WHERE session_id=?1 ORDER BY started_at DESC,rowid DESC LIMIT 1",[session_id],|r|r.get(0)).optional()?
    };
    let Some(id) = mapped else {
        return Ok(Value::Null);
    };
    let row: Option<(String, i64, Option<i64>, Option<String>)> = db
        .conn()
        .query_row(
            "SELECT status,started_at,ended_at,error_code FROM turns WHERE id=?1 AND session_id=?2",
            params![id, session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((status, start, end, error)) = row else {
        return Ok(Value::Null);
    };
    let mut statement = db.conn().prepare(
        "SELECT observation_json FROM task_metric_calls WHERE turn_id=?1 ORDER BY call_id",
    )?;
    let raw = statement
        .query_map([&id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let calls = raw
        .iter()
        .map(|s| serde_json::from_str::<Call>(s))
        .collect::<serde_json::Result<Vec<_>>>()?;
    let observed = now_ms();
    let mut result = aggregate(&calls);
    let gap: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM task_metric_gaps WHERE turn_id=?1)",
        [&id],
        |r| r.get(0),
    )?;
    if gap {
        if result["coverage"] == "complete" {
            result["coverage"] = json!("partial");
        }
        if result["tps"]["coverage"] == "complete" {
            result["tps"]["coverage"] = json!("partial");
        }
    }
    let mut groups: BTreeMap<(String, String), Vec<Call>> = BTreeMap::new();
    for call in &calls {
        groups
            .entry((call.provider_id.clone(), call.model_id.clone()))
            .or_default()
            .push(call.clone());
    }
    let models: Vec<Value> = groups
        .into_iter()
        .map(|((provider, model), calls)| {
            let mut v = aggregate(&calls);
            v["providerId"] = json!(provider);
            v["modelId"] = json!(model);
            v
        })
        .collect();
    let recovered: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM task_metric_interruptions WHERE turn_id=?1)",
        [&id],
        |r| r.get(0),
    )?;
    let interrupted = recovered
        || (error.as_deref() == Some("TURN_ABORTED")
            && calls.iter().any(|c| c.outcome == "running"));
    let duration = end
        .unwrap_or(observed)
        .checked_sub(start)
        .filter(|v| *v >= 0 && !interrupted);
    for (key, value) in [
        ("format", json!("craftmine.task-metrics/1")),
        ("sessionId", json!(session_id)),
        ("turnId", json!(id)),
        ("status", json!(status)),
        ("startedAtMs", json!(start)),
        ("endedAtMs", json!(end)),
        ("observedAtMs", json!(observed)),
        ("wallTimeMs", json!(duration)),
        ("models", json!(models)),
        ("scope", json!("root-and-delegates")),
        ("modelIdentity", json!("runtime-binding")),
    ] {
        result[key] = value;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;
    fn seed(db: &Database) -> (String, String) {
        let session =
            sessions::create_session(db, Some("metrics fixture".into()), None, None, None, None)
                .unwrap();
        let turn =
            sessions::begin_turn(db, &session.id, Some("initial"), Some("initial-model")).unwrap();
        db.conn()
            .execute("UPDATE turns SET started_at=1000 WHERE id=?1", [&turn])
            .unwrap();
        (session.id, turn)
    }

    #[test]
    fn task_metrics_end_gap_and_terminal_status_share_failure_atomicity() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let (s, t) = seed(&db);
        observe(&db, &s, &t, &call("known", "agent", 1100, Some(2200), true)).unwrap();
        db.conn().execute_batch("CREATE TEMP TRIGGER deny_gap BEFORE INSERT ON task_metric_gaps BEGIN SELECT RAISE(ABORT,'fixture gap failure'); END;").unwrap();
        assert!(sessions::end_turn_settling_with_metrics(
            &db,
            &t,
            "completed",
            None,
            None,
            false,
            false,
            true
        )
        .is_err());
        assert_eq!(read(&db, &s, Some(&t), None).unwrap()["status"], "running");
        db.conn().execute_batch("DROP TRIGGER deny_gap; CREATE TEMP TRIGGER deny_end BEFORE UPDATE ON turns BEGIN SELECT RAISE(ABORT,'fixture end failure'); END;").unwrap();
        assert!(sessions::end_turn_settling_with_metrics(
            &db,
            &t,
            "completed",
            None,
            None,
            false,
            false,
            true
        )
        .is_err());
        assert_eq!(
            read(&db, &s, Some(&t), None).unwrap()["coverage"],
            "complete"
        );
        db.conn().execute_batch("DROP TRIGGER deny_end;").unwrap();
        sessions::end_turn_settling_with_metrics(
            &db,
            &t,
            "completed",
            None,
            None,
            false,
            false,
            true,
        )
        .unwrap();
        let result = read(&db, &s, Some(&t), None).unwrap();
        assert_eq!(result["status"], "completed");
        assert_eq!(result["coverage"], "partial");
    }
    fn call(id: &str, source: &str, start: i64, end: Option<i64>, usage: bool) -> Value {
        json!({"callId":id,"providerId":"p","modelId":"m","source":source,
            "startedAtMs":start,"generationStartedAtMs":end.map(|_|start+100),"endedAtMs":end,
            "outcome":if end.is_some(){"completed"}else{"running"},
            "usage":if usage {json!({"inputTokens":100,"outputTokens":200,"totalTokens":900,"cacheReadTokens":600,"reasoningTokens":30})}else{Value::Null}})
    }
    #[test]
    fn task_metrics_retries_replays_partial_and_owner_isolation() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let (s, t) = seed(&db);
        let (other, _) = seed(&db);
        let start = call("retry-a", "agent", 1100, None, false);
        observe(&db, &s, &t, &start).unwrap();
        let end = call("retry-a", "agent", 1100, Some(2200), true);
        observe(&db, &s, &t, &end).unwrap();
        assert_eq!(observe(&db, &s, &t, &end).unwrap()["replayed"], true);
        assert_eq!(observe(&db, &s, &t, &start).unwrap()["replayed"], true);
        assert_eq!(
            read(&db, &s, Some(&t), None).unwrap()["usage"]["totalTokens"],
            900
        );
        assert!(observe(&db, &other, &t, &end)
            .unwrap_err()
            .to_string()
            .contains("OWNER_MISMATCH"));
        let mut changed = end.clone();
        changed["usage"]["totalTokens"] = json!(901);
        assert!(observe(&db, &s, &t, &changed)
            .unwrap_err()
            .to_string()
            .contains("RECEIPT_CONFLICT"));
        observe(
            &db,
            &s,
            &t,
            &call("retry-b", "agent", 2500, Some(3600), false),
        )
        .unwrap();
        let result = read(&db, &s, Some(&t), None).unwrap();
        assert_eq!(result["coverage"], "partial");
        assert_eq!(result["calls"]["observed"], 2);
        assert_eq!(result["tps"]["value"], 200.0);
        assert_eq!(result["tps"]["coverage"], "partial");
        assert_eq!(result["usage"]["totalTokens"], 900); // no cache/reasoning double add
    }
    #[test]
    fn task_metrics_models_overlap_wall_time_and_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let (s, t) = seed(&db);
        observe(
            &db,
            &s,
            &t,
            &call("parent", "agent", 1100, Some(3200), true),
        )
        .unwrap();
        let mut child = call("child", "subagent", 1600, Some(3700), true);
        child["modelId"] = json!("other-model");
        observe(&db, &s, &t, &child).unwrap();
        sessions::end_turn(&db, &t, "completed", None, None, false).unwrap();
        db.conn()
            .execute("UPDATE turns SET ended_at=10000 WHERE id=?1", [&t])
            .unwrap();
        let before = read(&db, &s, Some(&t), None).unwrap();
        assert_eq!(before["wallTimeMs"], 9000);
        assert_eq!(before["usage"]["totalTokens"], 1800);
        assert_eq!(before["coverage"], "complete");
        assert!(before["tps"]["value"].is_null());
        assert_eq!(before["models"][0]["tps"]["value"], 100.0);
        drop(db);
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let after = read(&db, &s, Some(&t), None).unwrap();
        for key in [
            "usage",
            "models",
            "calls",
            "tps",
            "wallTimeMs",
            "status",
            "turnId",
        ] {
            assert_eq!(before[key], after[key]);
        }
        assert!(
            observe(&db, &s, &t, &call("late", "agent", 9000, Some(9500), true))
                .unwrap_err()
                .to_string()
                .contains("TURN_CLOSED")
        );
        assert_eq!(observe(&db, &s, &t, &child).unwrap()["replayed"], true);
    }
    #[test]
    fn task_metrics_unknown_crash_gap_and_validation() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let (s, t) = seed(&db);
        assert!(read(&db, &s, Some(&t), None).unwrap()["usage"].is_null());
        observe(
            &db,
            &s,
            &t,
            &call("completed", "compaction", 1100, Some(2200), true),
        )
        .unwrap();
        mark_unavailable(&db, &s, &t).unwrap();
        assert_eq!(
            read(&db, &s, Some(&t), None).unwrap()["coverage"],
            "partial"
        );
        observe(&db, &s, &t, &call("pending", "agent", 2300, None, false)).unwrap();
        let mut bad = call("bad", "agent", 1000, Some(2000), true);
        bad["usage"]["totalTokens"] = json!(-1);
        assert!(observe(&db, &s, &t, &bad).is_err());
        bad = call("bad", "agent", 1000, Some(2000), true);
        bad["path"] = json!("ignored");
        assert!(observe(&db, &s, &t, &bad).is_err());
        assert!(read(&db, &s, Some(&t), Some("m")).is_err());
        drop(db);
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let result = read(&db, &s, Some(&t), None).unwrap();
        assert_eq!(result["status"], "aborted");
        assert!(result["wallTimeMs"].is_null());
        assert_eq!(result["coverage"], "partial");
        assert_eq!(result["usage"]["totalTokens"], 900);
    }

    #[test]
    fn task_metrics_recovery_without_pending_calls_cannot_invent_end_or_completeness() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let (s, t) = seed(&db);
        let (empty_s, empty_t) = seed(&db);
        observe(
            &db,
            &s,
            &t,
            &call("finished-stream", "agent", 1100, Some(2200), true),
        )
        .unwrap();
        let mut too_long = call("invalid-duration", "agent", 1100, Some(604_801_101), true);
        assert!(observe(&db, &s, &t, &too_long)
            .unwrap_err()
            .to_string()
            .contains("INVALID_TASK_METRIC_CALL"));
        too_long = call("invalid-clock", "agent", 1100, None, false);
        too_long["generationStartedAtMs"] = json!(9_007_199_254_740_992i64);
        assert!(observe(&db, &s, &t, &too_long).is_err());
        drop(db);
        let db = Database::open_in_dir(tmp.path()).unwrap();
        let result = read(&db, &s, Some(&t), None).unwrap();
        assert_eq!(result["status"], "aborted");
        assert_eq!(result["coverage"], "partial");
        assert_eq!(result["calls"]["pending"], 0);
        assert!(result["wallTimeMs"].is_null());
        let empty = read(&db, &empty_s, Some(&empty_t), None).unwrap();
        assert_eq!(empty["coverage"], "unknown");
        assert!(empty["wallTimeMs"].is_null());
        sessions::delete_session(&db, &s).unwrap();
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT COUNT(*) FROM task_metric_calls WHERE turn_id=?1",
                    [&t],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}
