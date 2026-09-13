//! Opt-in portable player feedback. Reports are data, never task authority.
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use super::{digest, TaskJournal};

const FORMAT: &str = "craftmine.playtest-feedback/1";
const LIMIT: usize = 800_000;
pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_playtest_feedback (
      world_id TEXT NOT NULL REFERENCES craftmine_worlds(id), id TEXT NOT NULL,
      body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(world_id,id));")?;
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Report { format: String, id: String, created_at: u64, context: ContextRecord,
    client: Client, description: String, expected: String, reply_to: Option<String>, screenshot: Option<Screenshot> }
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct ContextRecord { world_id: String, build_id: String, world_revision: u64, content_hash: String,
    base_id: String, base_version: String, engine_version: String, progress_format: String }
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Client {version: String, commit: Option<String>}
#[derive(Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Screenshot {png_base64: String, sha256: String, world_id: String, build_id: String}
fn short(value: &str, max: usize) -> bool { !value.is_empty() && value.len()<=max && !value.chars().any(char::is_control) }
fn hash(value: &str) -> bool {value.len()==64 && value.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())}
fn report_id(value: &str) -> bool {value.strip_prefix("feedback-").is_some_and(hash)}
fn identity(value: &Value) -> Result<String> {
    let mut body=value.clone();body.as_object_mut().context("PLAYTEST_INVALID_REPORT")?.remove("id");
    Ok(format!("feedback-{}",digest(&serde_json::to_string(&body)?)))
}
fn validate(value: &Value) -> Result<Report> {
    ensure!(serde_json::to_vec(value)?.len()<=LIMIT,"PLAYTEST_TOO_LARGE");
    let report:Report=serde_json::from_value(value.clone()).context("PLAYTEST_INVALID_REPORT")?;
    ensure!(report.format==FORMAT && report.id==identity(value)? && report.created_at>0,"PLAYTEST_INVALID_REPORT");
    super::worlds::validate_id(&report.context.world_id)?;
    ensure!(short(&report.context.build_id,128)&&hash(&report.context.content_hash)
      &&short(&report.context.base_id,80)&&short(&report.context.base_version,80)
      &&short(&report.context.engine_version,80)&&short(&report.context.progress_format,80),"PLAYTEST_INVALID_CONTEXT");
    ensure!(short(&report.client.version,80)&&report.client.commit.as_ref().is_none_or(|s|s.len()==40&&s.bytes().all(|b|b.is_ascii_hexdigit())),"PLAYTEST_INVALID_CLIENT");
    ensure!(!report.description.trim().is_empty()&&report.description.len()<=16_000&&report.expected.len()<=8_000
      &&!report.description.contains('\0')&&!report.expected.contains('\0')
      &&report.reply_to.as_ref().is_none_or(|s|report_id(s)),"PLAYTEST_INVALID_TEXT");
    if let Some(image)=&report.screenshot {
      ensure!(image.world_id==report.context.world_id&&image.build_id==report.context.build_id,"PLAYTEST_SCREENSHOT_MISMATCH");
      let bytes=STANDARD.decode(&image.png_base64).context("PLAYTEST_INVALID_SCREENSHOT")?;
      ensure!(bytes.len()<=512*1024&&bytes.starts_with(b"\x89PNG\r\n\x1a\n")&&hash(&image.sha256),"PLAYTEST_INVALID_SCREENSHOT");
      use sha2::Digest;
      ensure!(sha2::Sha256::digest(&bytes).iter().map(|b|format!("{b:02x}")).collect::<String>()==image.sha256,"PLAYTEST_INVALID_SCREENSHOT");
    }
    Ok(report)
}
fn exact(args:&Value, keys:&[&str])->Result<()> {ensure!(args.as_object().is_some_and(|v|v.keys().all(|k|keys.contains(&k.as_str()))),"PLAYTEST_INVALID_PARAMS");Ok(())}
impl TaskJournal {
    pub fn playtest_request(&mut self, method:&str, args:&Value)->Result<Value> {
      if method=="playtest.validate" {exact(args,&["report"])?;validate(&args["report"])?;return Ok(args["report"].clone());}
      let world=args["worldId"].as_str().context("PLAYTEST_WORLD_REQUIRED")?;
      let current=self.world_read(world)?;
      let context=json!({"worldId":world,"buildId":current.world.build["id"],"worldRevision":current.summary.revision,
        "contentHash":current.content_hash,"baseId":current.world.snapshot["baseId"],"baseVersion":current.world.snapshot["baseVersion"],
        "engineVersion":current.world.build["godot"]["engineVersion"],"progressFormat":current.world.snapshot["format"]});
      if method=="playtest.context" {exact(args,&["worldId"])?;return Ok(context);}
      if method=="playtest.list" {
        exact(args,&["worldId"])?;
        let mut stmt=self.db.prepare("SELECT body FROM craftmine_playtest_feedback WHERE world_id=?1 ORDER BY created_at DESC,id LIMIT 100")?;
        let rows=stmt.query_map([world],|row|row.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let items=rows.into_iter().map(|body|->Result<Value>{let report:Value=serde_json::from_str(&body)?;Ok(json!({"id":report["id"],"createdAt":report["createdAt"],"description":report["description"],"context":report["context"],"replyTo":report["replyTo"],"sameBuild":report["context"]["buildId"]==context["buildId"]}))}).collect::<Result<Vec<_>>>()?;
        return Ok(json!({"items":items}));
      }
      if method=="playtest.read" {
        exact(args,&["worldId","id"])?;
        let id=args["id"].as_str().context("PLAYTEST_ID_REQUIRED")?;
        let body:String=self.db.query_row("SELECT body FROM craftmine_playtest_feedback WHERE world_id=?1 AND id=?2",params![world,id],|row|row.get(0)).optional()?.context("PLAYTEST_NOT_FOUND")?;
        return Ok(serde_json::from_str(&body)?);
      }
      ensure!(method=="playtest.record","PLAYTEST_METHOD_DENIED");
      exact(args,&["worldId","report","origin"])?;
      let report=validate(&args["report"])?;
      let origin=args["origin"].as_str().context("PLAYTEST_ORIGIN_REQUIRED")?;
      ensure!(matches!(origin,"local"|"imported"),"PLAYTEST_ORIGIN_REQUIRED");
      if origin=="local" {
        // Keep the reviewed timestamp, progress revision/hash and screenshot
        // unchanged after autosave. Formal content and world identity must
        // still match; a later adopted build requires a new review.
        let reviewed=serde_json::to_value(&report.context)?;
        ensure!(["worldId","buildId","baseId","baseVersion","engineVersion","progressFormat"].iter()
          .all(|key|reviewed[*key]==context[*key]),"PLAYTEST_WORLD_CHANGED");
      }
      let body=serde_json::to_string(&report)?;
      if let Some(old)=self.db.query_row("SELECT body FROM craftmine_playtest_feedback WHERE world_id=?1 AND id=?2",params![world,report.id],|row|row.get::<_,String>(0)).optional()? {
        ensure!(old==body,"PLAYTEST_ID_CONFLICT");return Ok(json!({"id":report.id,"status":"recorded","reused":true}));
      }
      let count:i64=self.db.query_row("SELECT count(*) FROM craftmine_playtest_feedback WHERE world_id=?1",[world],|row|row.get(0))?;
      ensure!(count<100,"PLAYTEST_RECORD_LIMIT");
      self.db.execute("INSERT INTO craftmine_playtest_feedback(world_id,id,body,created_at) VALUES(?1,?2,?3,?4)",params![world,report.id,body,super::worlds::timestamp()?])?;
      Ok(json!({"id":report.id,"status":"recorded","reused":false}))
    }
}

#[cfg(test)]
mod tests {
 use super::*;
 fn sample()->Value {let mut v=json!({"format":FORMAT,"createdAt":1,"context":{"worldId":"world-one","buildId":"build-one","worldRevision":0,"contentHash":"a".repeat(64),"baseId":"creation-sandbox","baseVersion":"1","engineVersion":"4.7.2","progressFormat":"craftmine.godot-progress/1"},"client":{"version":"0.14.4-preview.22","commit":null},"description":"Tree blocks the door","expected":"Walk through the door","replyTo":null,"screenshot":null});v["id"]=identity(&v).unwrap().into();v}
 #[test]fn portable_schema_rejects_tamper_and_unknown_fields(){let good=sample();assert!(validate(&good).is_ok());let mut bad=good.clone();bad["description"]="changed".into();assert!(validate(&bad).is_err());bad=good;bad["privatePath"]="secret".into();bad["id"]=identity(&bad).unwrap().into();assert!(validate(&bad).is_err());}
 #[test]fn portable_schema_rejects_unbound_screenshots(){let mut v=sample();v["screenshot"]=json!({"worldId":"other","buildId":"build-one","pngBase64":"iVBORw0KGgo=","sha256":"a".repeat(64)});v["id"]=identity(&v).unwrap().into();assert!(validate(&v).is_err());}
 #[test]fn imported_reports_are_world_scoped_idempotent_and_survive_reopen(){
   let dir=tempfile::tempdir().unwrap();let path=dir.path().join("feedback.sqlite");
   let mut journal=TaskJournal::open(&path).unwrap();
   let world=super::super::WorldDocument {build:json!({"id":"build-a","scene":{"format":"craftmine.scene/3","objects":[]}}),snapshot:json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}}),extensions:vec![]};
   journal.world_create("author","Author",&world).unwrap();journal.world_create("other","Other",&world).unwrap();
   let report=sample();let args=json!({"worldId":"author","report":report,"origin":"imported"});
   assert_eq!(journal.playtest_request("playtest.record",&args).unwrap()["reused"],false);
   assert_eq!(journal.playtest_request("playtest.record",&args).unwrap()["reused"],true);
   let mut forged=args.clone();forged["origin"]="local".into();assert!(journal.playtest_request("playtest.record",&forged).is_err());
   drop(journal);let mut journal=TaskJournal::open(&path).unwrap();
   assert_eq!(journal.playtest_request("playtest.read",&json!({"worldId":"author","id":report["id"]})).unwrap(),report);
   assert!(journal.playtest_request("playtest.read",&json!({"worldId":"other","id":report["id"]})).is_err());
   let rows=journal.playtest_request("playtest.list",&json!({"worldId":"author"})).unwrap();assert_eq!(rows["items"].as_array().unwrap().len(),1);assert_eq!(rows["items"][0]["sameBuild"],false);
 }
}
