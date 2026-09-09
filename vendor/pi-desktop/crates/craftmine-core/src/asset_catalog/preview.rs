//! AL2 format probing, preview bookkeeping and base-check evidence.
//!
//! The Rust layer never claims a pixel or audio decode. It records what a real
//! decoder produced, keeps failed/timeout/cancelled states separate, and only
//! marks a version previewable when a real decoder returned `ok` evidence.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

use crate::durable::{fields, number, text};
use crate::TaskJournal;

use super::budget::PREVIEW_TIMEOUT_MS;
use super::contract;
use super::contract::FileRef;
use super::store;

pub(super) const PREVIEWER_VERSION: &str = "asset-preview/1";
const PROBE_DECODER: &str = "rust-probe/1";
const PROBE_PREFIX_BYTES: u64 = 1024 * 1024;
/// A claim outlives the worker timeout with a margin, so a slow-but-live decode
/// is never stolen. Once it passes, the attempt is dead: the host timed out,
/// crashed or restarted, and the version must not stay pending forever.
pub(super) const PREVIEW_CLAIM_TTL_MS: i64 = 4 * 60 * 1000;

fn engine_version() -> &'static str {
    crate::godot_builds::engine_version()
}

pub(super) fn cache_key(
    asset_id: &str,
    version: u64,
    content_hash: &str,
    settings_hash: &str,
) -> String {
    crate::digest(&format!(
        "craftmine.asset-preview/1\n{asset_id}\n{version}\n{content_hash}\n{PREVIEWER_VERSION}\n{}\n{settings_hash}",
        engine_version()
    ))
}

/// Latest base-check evidence for this exact content. A passed check for v1 is
/// never reported for v2.
pub(super) fn check_json(
    db: &Connection,
    asset_id: &str,
    version: u64,
    content_hash: &str,
) -> Result<Value> {
    let row: Option<(String, i64, String, String, String, String, String, i64)> = db
        .query_row(
            "SELECT base_id,base_version,engine_version,target,checker_version,status,detail,created_at
             FROM craftmine_asset_checks
             WHERE asset_id=?1 AND version=?2 AND content_hash=?3
             ORDER BY created_at DESC, target DESC, checker_version DESC LIMIT 1",
            params![asset_id, version as i64, content_hash],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()?;
    Ok(match row {
        Some((base_id, base_version, engine, target, checker, status, detail, created_at)) => json!({
            "baseId": base_id,
            "baseVersion": base_version as u64,
            "engineVersion": engine,
            "target": target,
            "checkerVersion": checker,
            "status": status,
            "detail": detail,
            "createdAt": created_at,
        }),
        None => Value::Null,
    })
}

/// One preview slot's durable state, including the attempt identity that binds
/// a begin, its decoder run, a cancel and a retry.
struct PreviewState {
    status: String,
    detail: String,
    facts: Value,
    created_at: i64,
    attempt: u64,
    claim_id: String,
    claim_owner: String,
    claim_deadline: i64,
}

impl PreviewState {
    fn active(&self, now: i64) -> bool {
        self.status == "pending" && !self.claim_id.is_empty() && self.claim_deadline > now
    }

    fn json(&self, now: i64) -> Value {
        let active = self.status == "pending" && !self.claim_id.is_empty();
        json!({
            "status": self.status,
            "detail": self.detail,
            "facts": self.facts,
            "createdAt": self.created_at,
            "attempt": self.attempt,
            "activeClaim": active,
            "claimExpired": active && self.claim_deadline > 0 && self.claim_deadline < now,
        })
    }
}

fn preview_state(
    db: &Connection,
    asset_id: &str,
    version: u64,
    key: &str,
) -> Result<Option<PreviewState>> {
    let row: Option<(String, String, String, i64, i64, String, String, i64)> = db
        .query_row(
            "SELECT status,detail,facts,created_at,attempt,claim_id,claim_owner,claim_deadline
             FROM craftmine_asset_previews
             WHERE asset_id=?1 AND version=?2 AND settings_hash=?3 AND previewer_version=?4 AND engine_version=?5",
            params![asset_id, version as i64, key, PREVIEWER_VERSION, engine_version()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(
        |(status, detail, facts, created_at, attempt, claim_id, claim_owner, claim_deadline)| {
            PreviewState {
                status,
                detail,
                facts: serde_json::from_str::<Value>(&facts).unwrap_or(Value::Null),
                created_at,
                attempt: attempt.max(0) as u64,
                claim_id,
                claim_owner,
                claim_deadline,
            }
        },
    ))
}

/// The core, not the caller, issues the claim. It is unique per attempt, so a
/// retry can never be mistaken for a replay of the previous run.
fn new_claim(asset_id: &str, version: u64, settings_hash: &str, attempt: u64, now: i64) -> String {
    crate::digest(&format!(
        "craftmine.asset-preview-claim/1\n{asset_id}\n{version}\n{settings_hash}\n{attempt}\n{now}"
    ))
}

fn read_prefix(root: &std::path::Path, file: &FileRef) -> Result<Vec<u8>> {
    if file.bytes <= PROBE_PREFIX_BYTES {
        return store::blob_read(root, &file.sha256, file.bytes);
    }
    store::blob_read_prefix(root, &file.sha256, file.bytes, PROBE_PREFIX_BYTES)
}

fn probe_png(bytes: &[u8]) -> Value {
    if bytes.len() < 33 || &bytes[12..16] != b"IHDR" {
        return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    json!({
        "probeOk": width > 0 && height > 0,
        "format": "png",
        "facts": {
            "width": width,
            "height": height,
            "bitDepth": bytes[24],
            "colorType": bytes[25],
            "interlace": bytes[28],
        },
    })
}

fn probe_jpeg(bytes: &[u8]) -> Value {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
    }
    let mut offset = 2usize;
    while offset + 3 < bytes.len() {
        if bytes[offset] != 0xff {
            return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            break;
        }
        let marker = bytes[offset];
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if offset + 1 >= bytes.len() {
            break;
        }
        let length = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if length < 2 || offset + length > bytes.len() {
            return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            if length < 8 {
                return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
            }
            let height = u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]);
            let width = u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]);
            let progressive = matches!(marker, 0xc2 | 0xc6 | 0xca);
            return json!({
                "probeOk": width > 0 && height > 0,
                "format": "jpeg",
                "facts": {
                    "width": width,
                    "height": height,
                    "progressive": progressive,
                    "marker": format!("{:02x}", marker),
                },
            });
        }
        offset += length;
    }
    json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"})
}

fn probe_glb(bytes: &[u8]) -> Value {
    if bytes.len() < 20 || &bytes[0..4] != b"glTF" {
        return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
    }
    let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let total = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    let chunk = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);
    let kind = &bytes[16..20];
    json!({
        "probeOk": version == 2 && kind == b"JSON" && total as usize >= bytes.len().min(20),
        "format": "glb",
        "facts": {"version": version, "totalBytes": total, "jsonChunkBytes": chunk},
    })
}

fn probe_wav(bytes: &[u8]) -> Value {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"});
    }
    let mut offset = 12usize;
    let mut facts = serde_json::Map::new();
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let body = offset + 8;
        if body + size > bytes.len() {
            break;
        }
        if id == b"fmt " && size >= 16 {
            facts.insert("audioFormat".into(), json!(u16::from_le_bytes([bytes[body], bytes[body + 1]])));
            facts.insert("channels".into(), json!(u16::from_le_bytes([bytes[body + 2], bytes[body + 3]])));
            facts.insert(
                "sampleRate".into(),
                json!(u32::from_le_bytes([bytes[body + 4], bytes[body + 5], bytes[body + 6], bytes[body + 7]])),
            );
            facts.insert("bitsPerSample".into(), json!(u16::from_le_bytes([bytes[body + 14], bytes[body + 15]])));
        }
        if id == b"data" {
            facts.insert("dataBytes".into(), json!(size));
        }
        offset = body + size + (size % 2);
    }
    let ok = facts.contains_key("sampleRate") && facts.contains_key("dataBytes");
    json!({"probeOk": ok, "format": "wav", "facts": Value::Object(facts)})
}

fn probe_ogg(bytes: &[u8]) -> Value {
    let ok = bytes.len() >= 27 && &bytes[0..4] == b"OggS" && bytes[4] == 0;
    let mut codec = Value::Null;
    if bytes.windows(7).any(|window| window == b"\x01vorbis") {
        codec = json!("vorbis");
    }
    if bytes.windows(8).any(|window| window == b"OpusHead") {
        codec = json!("opus");
    }
    json!({"probeOk": ok, "format": "ogg", "facts": {"codec": codec}})
}

fn probe_package(bytes: &[u8]) -> Value {
    match std::str::from_utf8(bytes) {
        Ok(text) => {
            let scene = text.contains("[gd_scene") || text.contains("[gd_resource");
            let script = text.contains("extends ") || text.contains("preload(") || text.contains("load(");
            let ext = text.matches("[ext_resource").count();
            let loads = text.matches("preload(").count() + text.matches("load(").count();
            let ok = scene || script;
            json!({
                "probeOk": ok,
                "format": "godot-package",
                "facts": {"extResources": ext, "scriptLoads": loads, "executed": false},
                "reason": if ok { Value::Null } else { json!("NOT_A_GODOT_PACKAGE") },
            })
        }
        Err(_) => json!({"probeOk": false, "reason": "CORRUPT_ASSET_BODY"}),
    }
}

fn probe(media_type: &str, bytes: &[u8]) -> Value {
    match media_type {
        "image/png" => probe_png(bytes),
        "image/jpeg" => probe_jpeg(bytes),
        "model/gltf-binary" => probe_glb(bytes),
        "audio/wav" => probe_wav(bytes),
        "audio/ogg" => probe_ogg(bytes),
        "application/x-godot-package" => probe_package(bytes),
        _ => json!({"probeOk": false, "reason": "UNSUPPORTED_MEDIA_TYPE"}),
    }
}

impl TaskJournal {
    /// Closes claims whose owner can no longer report: the host timed out,
    /// crashed or restarted. A version never stays pending forever.
    pub fn asset_preview_sweep(&self) -> Result<usize> {
        let now = crate::worlds::timestamp()?;
        Ok(self.db.execute(
            "UPDATE craftmine_asset_previews
                SET status='failed', detail='PREVIEW_CLAIM_EXPIRED',
                    claim_id='', claim_owner='', claim_deadline=0
              WHERE status='pending' AND claim_id<>'' AND claim_deadline>0 AND claim_deadline<?1",
            params![now],
        )?)
    }

    #[allow(clippy::too_many_arguments)]
    fn write_preview_claim(
        &self,
        asset_id: &str,
        version: u64,
        content_hash: &str,
        settings_hash: &str,
        attempt: u64,
        claim_id: &str,
        owner: &str,
        deadline: i64,
        now: i64,
    ) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO craftmine_asset_previews(asset_id,version,content_hash,
                previewer_version,engine_version,settings_hash,status,detail,facts,created_at,
                attempt,claim_id,claim_owner,claim_deadline)
             VALUES(?1,?2,?3,?4,?5,?6,'pending','','{}',?7,?8,?9,?10,?11)",
            params![
                asset_id,
                version as i64,
                content_hash,
                PREVIEWER_VERSION,
                engine_version(),
                settings_hash,
                now,
                attempt as i64,
                claim_id,
                owner,
                deadline
            ],
        )?;
        Ok(())
    }

    /// Claims a preview slot for one exact content hash and issues the attempt
    /// identity. The cache key is the content identity; the claim is the
    /// execution identity. Re-opening a live claim resumes the same attempt
    /// instead of starting a second decoder run.
    pub fn asset_preview_begin(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &["assetId", "version", "settingsHash", "owner", "force"],
        )?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?.to_string();
        let version = number(args, "version", contract::MAX_VERSION)?;
        let settings_hash = args["settingsHash"].as_str().unwrap_or("default").to_string();
        contract::validate_identifier(&settings_hash, "INVALID_SETTINGS_HASH")?;
        let owner = args["owner"].as_str().unwrap_or("").to_string();
        ensure!(owner.len() <= 120, "INVALID_CLAIM_OWNER");
        let force = args["force"].as_bool().unwrap_or(false);
        let row = store::version_row(&self.db, &asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let key = cache_key(&asset_id, version, &row.content_hash, &settings_hash);
        self.asset_preview_sweep()?;
        let now = crate::worlds::timestamp()?;
        let claim = |attempt: u64, claim_id: String, deadline: i64| {
            json!({
                "attempt": attempt,
                "claimId": claim_id,
                "owner": owner,
                "deadline": deadline,
            })
        };
        let Some(state) = preview_state(&self.db, &asset_id, version, &settings_hash)? else {
            let claim_id = new_claim(&asset_id, version, &settings_hash, 1, now);
            let deadline = now + PREVIEW_CLAIM_TTL_MS;
            self.write_preview_claim(
                &asset_id,
                version,
                &row.content_hash,
                &settings_hash,
                1,
                &claim_id,
                &owner,
                deadline,
                now,
            )?;
            return Ok(json!({
                "jobId": format!("apv-{key}"),
                "cacheKey": key,
                "cached": false,
                "retried": false,
                "resumed": false,
                "previousStatus": Value::Null,
                "staleClaim": false,
                "timeoutMs": PREVIEW_TIMEOUT_MS,
                "claim": claim(1, claim_id, deadline),
                "preview": {
                    "status": "pending", "detail": "", "facts": {}, "createdAt": now, "attempt": 1,
                },
            }));
        };
        if state.active(now) && !force {
            // Only one valid execution per claim: a second caller resumes it.
            return Ok(json!({
                "jobId": format!("apv-{key}"),
                "cacheKey": key,
                "cached": true,
                "retried": false,
                "resumed": true,
                "previousStatus": "pending",
                "staleClaim": false,
                "timeoutMs": PREVIEW_TIMEOUT_MS,
                "claim": claim(state.attempt, state.claim_id.clone(), state.claim_deadline),
                "preview": state.json(now),
            }));
        }
        if matches!(state.status.as_str(), "ok" | "partial") && !force {
            return Ok(json!({
                "jobId": format!("apv-{key}"),
                "cacheKey": key,
                "cached": true,
                "retried": false,
                "resumed": false,
                "previousStatus": state.status,
                "staleClaim": false,
                "timeoutMs": PREVIEW_TIMEOUT_MS,
                "claim": Value::Null,
                "preview": state.json(now),
            }));
        }
        // failed / timeout / cancelled, an expired claim, or an explicit force:
        // a new attempt with a new claim. The old attempt is dead and any late
        // result for it is rejected by the attempt check in `finish`.
        let attempt = state.attempt.saturating_add(1).max(1);
        let claim_id = new_claim(&asset_id, version, &settings_hash, attempt, now);
        let deadline = now + PREVIEW_CLAIM_TTL_MS;
        self.write_preview_claim(
            &asset_id,
            version,
            &row.content_hash,
            &settings_hash,
            attempt,
            &claim_id,
            &owner,
            deadline,
            now,
        )?;
        Ok(json!({
            "jobId": format!("apv-{key}"),
            "cacheKey": key,
            "cached": false,
            "retried": true,
            "resumed": false,
            "previousStatus": state.status,
            "staleClaim": state.status == "pending",
            "timeoutMs": PREVIEW_TIMEOUT_MS,
            "claim": claim(attempt, claim_id, deadline),
            "preview": {
                "status": "pending", "detail": "", "facts": {}, "createdAt": now, "attempt": attempt,
            },
        }))
    }

    /// Records the real decoder result for the attempt that owns the live
    /// claim. A late result from a cancelled or superseded attempt is reported
    /// as stale and never overwrites the current state. `ok` requires decoder
    /// evidence: a placeholder never becomes a successful preview.
    pub fn asset_preview_finish(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "assetId",
                "version",
                "settingsHash",
                "status",
                "detail",
                "facts",
                "claimId",
                "attempt",
            ],
        )?;
        let operation_id = text(args, "operationId", 240)?.to_string();
        let request_hash = crate::digest(&serde_json::to_string(args)?);
        if let Some(existing) =
            store::operation(&self.db, &operation_id, "asset.previewFinish", &request_hash)?
        {
            return Ok(existing);
        }
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?.to_string();
        let version = number(args, "version", contract::MAX_VERSION)?;
        let settings_hash = args["settingsHash"].as_str().unwrap_or("default").to_string();
        let claim_id = text(args, "claimId", 120)?.to_string();
        let attempt = number(args, "attempt", contract::MAX_VERSION)?;
        let status = text(args, "status", 16)?.to_string();
        ensure!(
            matches!(status.as_str(), "ok" | "partial" | "failed" | "timeout" | "cancelled"),
            "INVALID_PREVIEW_STATUS"
        );
        let detail = args["detail"].as_str().unwrap_or("").to_string();
        ensure!(detail.len() <= 240, "INVALID_PREVIEW_DETAIL");
        let facts = args["facts"].clone();
        let row = store::version_row(&self.db, &asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let key = cache_key(&asset_id, version, &row.content_hash, &settings_hash);
        self.asset_preview_sweep()?;
        let now = crate::worlds::timestamp()?;
        // A finish without a claimed begin would let any caller mark a version
        // previewable with an arbitrary digest.
        let state = preview_state(&self.db, &asset_id, version, &settings_hash)?
            .context("PREVIEW_NOT_CLAIMED")?;
        if state.claim_id != claim_id || state.attempt != attempt || state.status != "pending" {
            // The attempt is no longer current (cancelled, superseded by a
            // retry, or already finished). This is not a conflict: the caller
            // gets an explicit "not applied" result and the state is untouched.
            return Ok(json!({
                "operationId": operation_id,
                "method": "asset.previewFinish",
                "assetId": asset_id,
                "version": version,
                "cacheKey": key,
                "status": state.status,
                "detail": state.detail,
                "attempt": state.attempt,
                "applied": false,
                "stale": true,
                "reason": "STALE_PREVIEW_ATTEMPT",
                "replayed": false,
            }));
        }
        if matches!(status.as_str(), "ok" | "partial") {
            let decoder = facts["decoder"].as_str().unwrap_or("");
            let digest = facts["digest"].as_str().unwrap_or("");
            ensure!(!decoder.is_empty(), "PREVIEW_EVIDENCE_REQUIRED");
            contract::validate_sha256(digest)
                .map_err(|_| anyhow::anyhow!("PREVIEW_EVIDENCE_REQUIRED"))?;
            // A thumbnail is small by design; a full body must never travel as
            // base64 through the preview record.
            if let Some(thumbnail) = facts["thumbnailBase64"].as_str() {
                ensure!(
                    thumbnail.len() <= 700_000
                        && thumbnail
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric()
                                || matches!(byte, b'+' | b'/' | b'=')),
                    "INVALID_PREVIEW_THUMBNAIL"
                );
            }
        }
        let result = json!({
            "operationId": operation_id,
            "method": "asset.previewFinish",
            "assetId": asset_id,
            "version": version,
            "cacheKey": key,
            "status": status,
            "detail": detail,
            "attempt": attempt,
            "applied": true,
            "stale": false,
            "replayed": false,
        });
        let tx = rusqlite::Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)?;
        let updated = tx.execute(
            "UPDATE craftmine_asset_previews
                SET status=?1, detail=?2, facts=?3, created_at=?4,
                    claim_id='', claim_owner='', claim_deadline=0
              WHERE asset_id=?5 AND version=?6 AND settings_hash=?7 AND previewer_version=?8
                AND engine_version=?9 AND attempt=?10 AND claim_id=?11",
            params![
                status,
                detail,
                serde_json::to_string(&facts)?,
                now,
                asset_id,
                version as i64,
                settings_hash,
                PREVIEWER_VERSION,
                engine_version(),
                attempt as i64,
                claim_id
            ],
        )?;
        ensure!(updated == 1, "STALE_PREVIEW_ATTEMPT");
        store::record_operation(
            &tx,
            &operation_id,
            "asset.previewFinish",
            &request_hash,
            &result,
            now,
        )?;
        tx.commit()?;
        Ok(result)
    }

    pub fn asset_preview_read(&self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "version"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let version = number(args, "version", contract::MAX_VERSION)?;
        store::version_row(&self.db, asset_id, version)?.context("ASSET_NOT_FOUND")?;
        self.asset_preview_sweep()?;
        let now = crate::worlds::timestamp()?;
        let mut statement = self.db.prepare(
            "SELECT previewer_version,engine_version,settings_hash,status,detail,facts,created_at,
                    attempt,claim_id,claim_owner,claim_deadline
             FROM craftmine_asset_previews WHERE asset_id=?1 AND version=?2
             ORDER BY created_at DESC",
        )?;
        let rows = statement.query_map(params![asset_id, version as i64], |row| {
            let status: String = row.get(3)?;
            let claim_id: String = row.get(8)?;
            let deadline: i64 = row.get(10)?;
            let active = status == "pending" && !claim_id.is_empty();
            Ok(json!({
                "previewerVersion": row.get::<_, String>(0)?,
                "engineVersion": row.get::<_, String>(1)?,
                "settingsHash": row.get::<_, String>(2)?,
                "status": status,
                "detail": row.get::<_, String>(4)?,
                "facts": serde_json::from_str::<Value>(&row.get::<_, String>(5)?).unwrap_or(Value::Null),
                "createdAt": row.get::<_, i64>(6)?,
                "attempt": row.get::<_, i64>(7)?.max(0) as u64,
                "activeClaim": active,
                "claimExpired": active && deadline > 0 && deadline < now,
            }))
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(json!({"assetId": asset_id, "version": version, "items": items, "total": items.len()}))
    }

    /// Structural probe only. It never claims a pixel or audio decode.
    pub fn asset_probe(&self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "version", "path"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let version = number(args, "version", contract::MAX_VERSION)?;
        store::version_row(&self.db, asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let files = store::files_of(&self.db, asset_id, version)?;
        let wanted = args["path"].as_str();
        let file = match wanted {
            Some(path) => files
                .iter()
                .find(|file| file.path == path)
                .context("ASSET_FILE_NOT_FOUND")?,
            None => files.first().context("ASSET_FILE_NOT_FOUND")?,
        };
        let blobs = store::blob_root(&self.directory, false)?;
        let bytes = read_prefix(&blobs, file)?;
        let mut probe = probe(&file.media_type, &bytes);
        if let Some(object) = probe.as_object_mut() {
            object.insert("path".into(), json!(file.path));
            object.insert("mediaType".into(), json!(file.media_type));
            object.insert("bytes".into(), json!(file.bytes));
            object.insert("decoder".into(), json!(PROBE_DECODER));
            object.insert("pixelDecoded".into(), json!(false));
        }
        Ok(probe)
    }

    /// Records a base-compatibility check for one exact content hash.
    pub fn asset_record_check(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "assetId",
                "version",
                "baseId",
                "baseVersion",
                "engineVersion",
                "target",
                "checkerVersion",
                "status",
                "detail",
            ],
        )?;
        let operation_id = text(args, "operationId", 240)?.to_string();
        let request_hash = crate::digest(&serde_json::to_string(args)?);
        if let Some(existing) =
            store::operation(&self.db, &operation_id, "asset.recordCheck", &request_hash)?
        {
            return Ok(existing);
        }
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?.to_string();
        let version = number(args, "version", contract::MAX_VERSION)?;
        let base_id = text(args, "baseId", contract::MAX_ID_BYTES)?.to_string();
        let base_version = number(args, "baseVersion", contract::MAX_VERSION)?;
        let engine = text(args, "engineVersion", 80)?.to_string();
        let target = text(args, "target", 80)?.to_string();
        let checker = text(args, "checkerVersion", 80)?.to_string();
        let status = text(args, "status", 16)?.to_string();
        ensure!(
            matches!(status.as_str(), "passed" | "failed" | "error"),
            "INVALID_CHECK_STATUS"
        );
        let detail = text(args, "detail", 240)?.to_string();
        let row = store::version_row(&self.db, &asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let created_at = crate::worlds::timestamp()?;
        let result = json!({
            "operationId": operation_id,
            "method": "asset.recordCheck",
            "assetId": asset_id,
            "version": version,
            "contentHash": row.content_hash,
            "status": status,
            "replayed": false,
        });
        let tx = rusqlite::Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT OR REPLACE INTO craftmine_asset_checks(asset_id,version,content_hash,base_id,
                base_version,engine_version,target,checker_version,status,detail,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                asset_id,
                version as i64,
                row.content_hash,
                base_id,
                base_version as i64,
                engine,
                target,
                checker,
                status,
                detail,
                created_at
            ],
        )?;
        store::record_operation(
            &tx,
            &operation_id,
            "asset.recordCheck",
            &request_hash,
            &result,
            created_at,
        )?;
        tx.commit()?;
        Ok(result)
    }
}
