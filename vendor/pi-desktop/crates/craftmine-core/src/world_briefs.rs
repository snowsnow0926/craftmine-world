//! Player-owned creation goals survive task boundaries. Reviews are explicitly
//! human judgments bound to a formal build, never model-written verification.
use super::{digest, workspaces, worlds, TaskJournal, WorkspaceContext};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[cfg(test)]
#[path = "world_briefs_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_world_briefs (
        world_id TEXT PRIMARY KEY REFERENCES craftmine_worlds(id),
        revision INTEGER NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS craftmine_world_brief_operations (
        world_id TEXT NOT NULL REFERENCES craftmine_worlds(id), operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(world_id,operation_id));
        CREATE TABLE IF NOT EXISTS craftmine_world_brief_proposals (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
        task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), request_hash TEXT NOT NULL,
        body TEXT NOT NULL, created_at INTEGER NOT NULL, accepted INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS craftmine_world_brief_proposal_world
        ON craftmine_world_brief_proposals(world_id,created_at);")?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Goal {
    id: String,
    kind: String,
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reviewed_build_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reviewed_at: Option<i64>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Brief { revision: u64, entries: Vec<Goal> }

fn fields(v: &Value, allowed: &[&str]) -> Result<()> {
    let object = v.as_object().context("WORLD_BRIEF_INVALID_REQUEST")?;
    ensure!(object.keys().all(|k| allowed.contains(&k.as_str())), "WORLD_BRIEF_INVALID_REQUEST");
    Ok(())
}
fn text<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let value = v[key].as_str().context("WORLD_BRIEF_INVALID_TEXT")?;
    ensure!(!value.trim().is_empty() && value.len() <= max
        && !value.chars().any(|c| c.is_control() && c != '\n' && c != '\t'), "WORLD_BRIEF_INVALID_TEXT");
    Ok(value)
}
fn identifier<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    let value = text(v, key, 240)?;
    ensure!(value.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b)), "WORLD_BRIEF_INVALID_ID");
    Ok(value)
}
fn kind(v: &Value) -> Result<&str> {
    let value = text(v, "kind", 16)?;
    ensure!(matches!(value, "goal" | "preserve"), "WORLD_BRIEF_INVALID_KIND");
    Ok(value)
}
fn load(db: &Connection, world_id: &str) -> Result<Brief> {
    let row: Option<(i64, String, String)> = db.query_row(
        "SELECT revision,body,hash FROM craftmine_world_briefs WHERE world_id=?1", [world_id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let Some((revision, body, hash)) = row else { return Ok(Brief::default()) };
    ensure!(body.len() <= 128_000 && digest(&body) == hash, "WORLD_BRIEF_CORRUPT");
    let brief: Brief = serde_json::from_str(&body)?;
    ensure!(i64::try_from(brief.revision)? == revision && brief.entries.len() <= 32, "WORLD_BRIEF_CORRUPT");
    Ok(brief)
}
fn goals(brief: &Brief, build_id: &Value, compact: bool) -> Vec<Value> {
    brief.entries.iter().take(if compact {8} else {32}).map(|entry| {
        let body: String = if compact {entry.text.chars().take(240).collect()} else {entry.text.clone()};
        let review = match &entry.reviewed_build_id {
            None => "not-reviewed",
            Some(id) if build_id.as_str() == Some(id.as_str()) => "player-accepted-current-build",
            Some(_) => "player-accepted-older-build",
        };
        json!({"id":entry.id,"kind":entry.kind,"text":body,"truncated":body!=entry.text,
            "review":review,"reviewedBuildId":entry.reviewed_build_id,"reviewedAt":entry.reviewed_at})
    }).collect()
}
fn recent_requests(db: &Connection, world_id: &str, limit: i64, text_limit: usize) -> Result<Vec<Value>> {
    // Recovery can copy the same original request into another task. Show its
    // newest task reference once while preserving every original row in Rust.
    let mut statement = db.prepare("SELECT r.task_id,r.request_id,r.kind,r.text,r.created_at,t.status
        FROM craftmine_task_requirements r JOIN craftmine_workspaces w ON w.task_id=r.task_id
        JOIN craftmine_tasks t ON t.id=r.task_id WHERE w.world_id=?1
        AND r.rowid=(SELECT MAX(r2.rowid) FROM craftmine_task_requirements r2
        JOIN craftmine_workspaces w2 ON w2.task_id=r2.task_id
        WHERE w2.world_id=?1 AND r2.request_id=r.request_id)
        ORDER BY r.created_at DESC,r.rowid DESC LIMIT ?2")?;
    let rows = statement.query_map(params![world_id,limit], |r| {
        let original: String = r.get(3)?;
        let excerpt: String = original.chars().take(text_limit).collect();
        Ok(json!({"taskId":r.get::<_,String>(0)?,"requestId":r.get::<_,String>(1)?,
            "kind":r.get::<_,String>(2)?,"text":excerpt,"truncated":excerpt!=original,
            "characters":original.chars().count(),"createdAt":r.get::<_,i64>(4)?,"taskStatus":r.get::<_,String>(5)?}))
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub(super) fn projection(db: &Connection, world: &worlds::WorldRecord) -> Result<Value> {
    let brief = load(db, &world.summary.id)?;
    Ok(json!({"format":"craftmine.world-brief-context/1","worldId":world.summary.id,
        "revision":brief.revision,"entries":goals(&brief,&world.world.build["id"],true),
        "totalEntries":brief.entries.len(),"recentRequests":recent_requests(db,&world.summary.id,3,400)?,
        "historyIsNotNewWork":true}))
}

impl TaskJournal {
    pub fn world_brief_read(&self, args: &Value) -> Result<Value> {
        fields(args, &["worldId"])?;
        let world_id = text(args,"worldId",80)?;
        worlds::assert_not_archived(&self.db,world_id)?;
        let world = worlds::read(&self.db,world_id)?;
        let brief = load(&self.db,world_id)?;
        let proposals = self.db.prepare("SELECT id,body,created_at FROM craftmine_world_brief_proposals
            WHERE world_id=?1 AND accepted=0 ORDER BY created_at DESC,id DESC LIMIT 8")?
            .query_map([world_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?
            .map(|row| {let (id,body,at)=row?;Ok(json!({"id":id,"proposal":serde_json::from_str::<Value>(&body)?,"createdAt":at}))})
            .collect::<Result<Vec<_>>>()?;
        let check = self.db.query_row("SELECT id,build_id,status,check_requirements_hash,updated_at
            FROM craftmine_godot_jobs WHERE world_id=?1 AND kind='check'
            ORDER BY updated_at DESC,id DESC LIMIT 1",[world_id],|r| {
                let build: String=r.get(1)?;
                Ok(json!({"jobId":r.get::<_,String>(0)?,"buildId":build,
                    "status":r.get::<_,String>(2)?,"requirementsHash":r.get::<_,Option<String>>(3)?,
                    "updatedAt":r.get::<_,i64>(4)?,"matchesFormalBuild":world.world.build["id"]==build,
                    "verifiesAllPlayerGoals":false}))
            }).optional()?;
        Ok(json!({"format":"craftmine.world-brief/1","worldId":world_id,"worldTitle":world.summary.title,
            "formalBuildId":world.world.build["id"],"revision":brief.revision,
            "entries":goals(&brief,&world.world.build["id"],false),"proposals":proposals,
            "recentRequests":recent_requests(&self.db,world_id,12,600)?,"latestNativeCheck":check}))
    }

    /// Private desktop mutation. The model route only exposes read/history and
    /// advisory proposals; it cannot invoke this endpoint or forge a review.
    pub fn world_brief_edit(&mut self, args: &Value) -> Result<Value> {
        let action = text(args,"action",32)?;
        let mut allowed=vec!["worldId","action","operationId","expectedRevision"];
        allowed.extend(match action {
            "add" => vec!["kind","text"], "update" => vec!["id","kind","text"],
            "remove" => vec!["id"], "review" => vec!["id","buildId","accepted"],
            "accept-proposal" | "dismiss-proposal" => vec!["proposalId"],
            _ => anyhow::bail!("WORLD_BRIEF_INVALID_ACTION"),
        });
        fields(args,&allowed)?;
        let world_id=text(args,"worldId",80)?;
        let operation=identifier(args,"operationId")?;
        let expected=args["expectedRevision"].as_u64().context("WORLD_BRIEF_REVISION_REQUIRED")?;
        let request_hash=digest(&serde_json::to_string(args)?);
        let tx=self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        worlds::assert_not_archived(&tx,world_id)?;
        let world=worlds::read(&tx,world_id)?;
        let prior:Option<(String,String)>=tx.query_row("SELECT request_hash,result FROM craftmine_world_brief_operations
            WHERE world_id=?1 AND operation_id=?2",params![world_id,operation],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((hash,result))=prior {
            ensure!(hash==request_hash,"WORLD_BRIEF_OPERATION_CONFLICT");
            return Ok(serde_json::from_str(&result)?);
        }
        let leased:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_world_leases WHERE world_id=?1)",[world_id],|r|r.get(0))?;
        ensure!(!leased,"WORLD_BUSY");
        let mut brief=load(&tx,world_id)?;
        ensure!(brief.revision==expected,"WORLD_BRIEF_REVISION_CONFLICT");
        match action {
            "add" => {
                let id=format!("goal-{}",&digest(&format!("{world_id}:{operation}"))[..24]);
                brief.entries.push(Goal{id,kind:kind(args)?.into(),text:text(args,"text",2000)?.into(),reviewed_build_id:None,reviewed_at:None});
            },
            "accept-proposal" | "dismiss-proposal" => {
                let id=identifier(args,"proposalId")?;
                let (body,accepted):(String,i64)=tx.query_row("SELECT body,accepted FROM craftmine_world_brief_proposals
                    WHERE id=?1 AND world_id=?2",params![id,world_id],|r|Ok((r.get(0)?,r.get(1)?))).context("WORLD_BRIEF_PROPOSAL_NOT_FOUND")?;
                ensure!(accepted==0,"WORLD_BRIEF_PROPOSAL_RESOLVED");
                let proposal:Value=serde_json::from_str(&body)?;
                if action=="accept-proposal" {
                    ensure!(proposal["revision"]==expected,"WORLD_BRIEF_PROPOSAL_STALE");
                    for (index,entry) in proposal["entries"].as_array().context("WORLD_BRIEF_CORRUPT")?.iter().enumerate() {
                        brief.entries.push(Goal{id:format!("goal-{}",&digest(&format!("{id}:{index}"))[..24]),kind:kind(entry)?.into(),text:text(entry,"text",2000)?.into(),reviewed_build_id:None,reviewed_at:None});
                    }
                }
                tx.execute("UPDATE craftmine_world_brief_proposals SET accepted=?2 WHERE id=?1",params![id,if action=="accept-proposal"{1}else{2}])?;
            },
            _ => {
                let id=identifier(args,"id")?;
                let index=brief.entries.iter().position(|entry|entry.id==id).context("WORLD_BRIEF_GOAL_NOT_FOUND")?;
                if action=="remove" {brief.entries.remove(index);}
                else if action=="update" {
                    brief.entries[index].kind=kind(args)?.into();brief.entries[index].text=text(args,"text",2000)?.into();
                    brief.entries[index].reviewed_build_id=None;brief.entries[index].reviewed_at=None;
                } else {
                    let build=identifier(args,"buildId")?;
                    ensure!(world.world.build["id"]==build,"WORLD_BRIEF_BUILD_CHANGED");
                    let accepted=args["accepted"].as_bool().context("WORLD_BRIEF_REVIEW_REQUIRED")?;
                    brief.entries[index].reviewed_build_id=accepted.then(||build.into());
                    brief.entries[index].reviewed_at=if accepted{Some(worlds::timestamp()?)}else{None};
                }
            },
        }
        ensure!(brief.entries.len()<=32,"WORLD_BRIEF_GOAL_LIMIT");
        brief.revision=brief.revision.checked_add(1).context("WORLD_BRIEF_REVISION_LIMIT")?;
        let body=serde_json::to_string(&brief)?;
        tx.execute("INSERT INTO craftmine_world_briefs(world_id,revision,body,hash) VALUES(?1,?2,?3,?4)
            ON CONFLICT(world_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,hash=excluded.hash",
            params![world_id,i64::try_from(brief.revision)?,body,digest(&body)])?;
        let result=json!({"worldId":world_id,"operationId":operation,"revision":brief.revision,"status":"saved"});
        tx.execute("INSERT INTO craftmine_world_brief_operations(world_id,operation_id,request_hash,result)
            VALUES(?1,?2,?3,?4)",params![world_id,operation,request_hash,serde_json::to_string(&result)?])?;
        tx.commit()?;
        Ok(result)
    }

    pub fn world_brief_tool(&mut self,args:&Value)->Result<Value> {
        let mode=text(args,"mode",20)?;
        fields(args,match mode {
            "read"=>&["context","mode"],
            "history"=>&["context","mode","taskId","requestId","start","limit"],
            "propose"=>&["context","mode","operationId","expectedRevision","entries"],
            _=>anyhow::bail!("WORLD_BRIEF_INVALID_ACTION"),
        })?;
        let context:WorkspaceContext=serde_json::from_value(args["context"].clone())?;
        let workspace=workspaces::inspect(&self.db,&context)?;
        worlds::assert_not_archived(&self.db,&workspace.world_id)?;
        if mode=="read" {return self.world_brief_read(&json!({"worldId":workspace.world_id}));}
        if mode=="history" {
            let task=identifier(args,"taskId")?;let request=text(args,"requestId",240)?;
            let start=args.get("start").map(|v|v.as_u64().context("WORLD_BRIEF_INVALID_PAGE")).transpose()?.unwrap_or(0);
            let limit=args.get("limit").map(|v|v.as_u64().context("WORLD_BRIEF_INVALID_PAGE")).transpose()?.unwrap_or(4000);
            ensure!((1..=4000).contains(&limit) && start<=1_000_000,"WORLD_BRIEF_INVALID_PAGE");
            let (body,kind):(String,String)=self.db.query_row("SELECT r.text,r.kind FROM craftmine_task_requirements r
                JOIN craftmine_workspaces w ON w.task_id=r.task_id WHERE w.world_id=?1 AND r.task_id=?2 AND r.request_id=?3",
                params![workspace.world_id,task,request],|r|Ok((r.get(0)?,r.get(1)?))).context("WORLD_BRIEF_REQUEST_NOT_FOUND")?;
            let total=body.chars().count() as u64;ensure!(start<=total,"WORLD_BRIEF_INVALID_PAGE");
            let excerpt:String=body.chars().skip(start as usize).take(limit as usize).collect();let end=start+excerpt.chars().count() as u64;
            return Ok(json!({"worldId":workspace.world_id,"taskId":task,"requestId":request,"kind":kind,
                "text":excerpt,"totalCharacters":total,"start":start,"next":if end<total{Some(end)}else{None},"historical":task!=workspace.task.binding.task_id}));
        }
        workspaces::assert_live(&self.db,&workspace)?;
        let operation=identifier(args,"operationId")?;
        let entries=args["entries"].as_array().context("WORLD_BRIEF_INVALID_PROPOSAL")?;
        ensure!(!entries.is_empty()&&entries.len()<=8,"WORLD_BRIEF_INVALID_PROPOSAL");
        for entry in entries {fields(entry,&["kind","text"])?;kind(entry)?;text(entry,"text",2000)?;}
        let id=format!("brief-proposal-{}",&digest(&format!("{}:{}:{operation}",workspace.world_id,workspace.task.binding.task_id))[..24]);
        let request_hash=digest(&serde_json::to_string(args)?);
        let prior:Option<(String,String)>=self.db.query_row("SELECT request_hash,body FROM craftmine_world_brief_proposals WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((hash,body))=prior {ensure!(hash==request_hash,"WORLD_BRIEF_OPERATION_CONFLICT");return Ok(json!({"id":id,"worldId":workspace.world_id,"status":"proposed","proposal":serde_json::from_str::<Value>(&body)?}));}
        let brief=load(&self.db,&workspace.world_id)?;
        ensure!(args["expectedRevision"].as_u64()==Some(brief.revision),"WORLD_BRIEF_REVISION_CONFLICT");
        let pending:i64=self.db.query_row("SELECT COUNT(*) FROM craftmine_world_brief_proposals WHERE world_id=?1 AND accepted=0",[&workspace.world_id],|r|r.get(0))?;
        ensure!(pending<8,"WORLD_BRIEF_PROPOSAL_LIMIT");
        let world=worlds::read(&self.db,&workspace.world_id)?;
        let proposal=json!({"revision":brief.revision,"buildId":world.world.build["id"],"taskId":workspace.task.binding.task_id,"entries":entries,"authority":"agent-proposal"});
        self.db.execute("INSERT INTO craftmine_world_brief_proposals(id,world_id,task_id,request_hash,body,created_at)
            VALUES(?1,?2,?3,?4,?5,?6)",params![id,workspace.world_id,workspace.task.binding.task_id,request_hash,serde_json::to_string(&proposal)?,worlds::timestamp()?])?;
        Ok(json!({"id":id,"worldId":workspace.world_id,"status":"proposed","proposal":proposal}))
    }
}
