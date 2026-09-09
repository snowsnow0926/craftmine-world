//! Host-owned request accounting and short authoritative task facts.
use super::{assert_binding, digest, document, read_task, workspaces, worlds, TaskBinding, TaskJournal, WorkspaceContext};
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
#[cfg(test)]
#[path="durable_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_task_runtime (
      task_id TEXT PRIMARY KEY REFERENCES craftmine_tasks(id), generation INTEGER NOT NULL,
      budget_owner TEXT NOT NULL, recovery TEXT NOT NULL DEFAULT 'none');
    CREATE TABLE IF NOT EXISTS craftmine_budget_limits (
      owner TEXT PRIMARY KEY, limits TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS craftmine_budget_requests (
      owner TEXT NOT NULL, request_id TEXT NOT NULL, task_id TEXT NOT NULL,
      generation INTEGER NOT NULL, purpose TEXT NOT NULL, request_hash TEXT NOT NULL,
      estimate INTEGER NOT NULL, status TEXT NOT NULL, settlement TEXT,
      PRIMARY KEY(owner,request_id));
    CREATE TABLE IF NOT EXISTS craftmine_budget_events (
      owner TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(owner,event_id));
    CREATE TABLE IF NOT EXISTS craftmine_task_requirements (
      task_id TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,
      created_at INTEGER NOT NULL,PRIMARY KEY(task_id,request_id));")?;
    Ok(())
}

pub(super) fn fields(value: &Value, allowed: &[&str]) -> Result<()> {
    let object = value.as_object().context("PARAMS_OBJECT_REQUIRED")?;
    ensure!(object.keys().all(|key| allowed.contains(&key.as_str())), "UNKNOWN_FIELD");
    Ok(())
}
pub(super) fn text<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let s = v[key].as_str().context(format!("{key}: STRING_REQUIRED"))?;
    ensure!(!s.trim().is_empty() && s.len() <= max && !s.chars().any(|c| c.is_control() && c != '\n' && c != '\t'), "INVALID_TEXT");
    Ok(s)
}
pub(super) fn number(v: &Value, key: &str, max: u64) -> Result<u64> {
    let n = v[key].as_u64().context(format!("{key}: INTEGER_REQUIRED"))?;
    ensure!(n <= max, "NUMBER_LIMIT"); Ok(n)
}
pub(super) fn runtime(db: &Connection, task: &str) -> Result<(u64, String, String)> {
    read_task(db, task)?;
    db.execute("INSERT OR IGNORE INTO craftmine_task_runtime(task_id,generation,budget_owner) VALUES(?1,1,?1)",[task])?;
    Ok(db.query_row("SELECT generation,budget_owner,recovery FROM craftmine_task_runtime WHERE task_id=?1",[task],|r|Ok((r.get::<_,i64>(0)? as u64,r.get(1)?,r.get(2)?)))?)
}
fn identity(db: &Connection, args: &Value, live: bool) -> Result<(TaskBinding, String)> {
    let binding: TaskBinding = serde_json::from_value(args["binding"].clone())?;
    binding.validate()?;
    let task = read_task(db, &binding.task_id)?;
    assert_binding(&task, &binding)?;
    let (generation, owner, recovery) = runtime(db, &binding.task_id)?;
    ensure!(args["generation"].as_u64() == Some(generation), "STALE_GENERATION");
    if live {
        let review = args["purpose"] == "review";
        ensure!((task.status == "running" || review && task.status == "finished") && recovery == "none", "TASK_INACTIVE");
        let ctx = WorkspaceContext {project_id:binding.project_id.clone(),session_id:binding.session_id.clone(),turn_id:binding.turn_id.clone()};
        let snapshot = workspaces::inspect(db, &ctx)?;
        if review {
            let current:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_verifications WHERE task_id=?1 AND status='passed' AND json_extract(input,'$.draftHash')=?2)",params![binding.task_id,task.draft_hash],|r|r.get(0))?;
            ensure!(current,"REVIEW_CHECK_REQUIRED");
            let world=worlds::read(db,&snapshot.world_id)?;
            ensure!(world.world.build["id"]==binding.base_build,"WORLD_BUILD_CONFLICT");
        } else {workspaces::assert_live(db, &snapshot)?;}
    }
    Ok((binding, owner))
}
fn limits(db: &Connection, owner: &str) -> Result<Value> {
    let stored: Option<String> = db.query_row("SELECT limits FROM craftmine_budget_limits WHERE owner=?1",[owner],|r|r.get(0)).optional()?;
    Ok(stored.map(|s|serde_json::from_str(&s)).transpose()?.unwrap_or(json!({"maxRequests":80,"maxTokens":1000000,"maxCompactions":8,"deadlineAt":null})))
}
pub(super) fn budget(db: &Connection, owner: &str) -> Result<Value> {
    let mut requests = db.prepare("SELECT status,estimate,settlement FROM craftmine_budget_requests WHERE owner=?1")?;
    let rows = requests.query_map([owner],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)? as u64,r.get::<_,Option<String>>(2)?)))?;
    let (mut count,mut actual,mut reserved,mut unknown)=(0u64,0u64,0u64,0u64);
    for row in rows { let (status,estimate,settlement)=row?; count+=1;
        if status == "known" { let value:Value=serde_json::from_str(&settlement.context("CORRUPT_BUDGET")?)?; actual+=value["usage"]["totalTokens"].as_u64().context("CORRUPT_BUDGET")?; }
        else {reserved+=estimate; if status!="reserved" {unknown+=1;} }
    }
    let count_kind=|kind:&str| -> Result<u64> {Ok(db.query_row("SELECT COUNT(*) FROM craftmine_budget_events WHERE owner=?1 AND kind=?2",params![owner,kind],|r|r.get::<_,i64>(0))? as u64)};
    let limits=limits(db,owner)?;
    Ok(json!({"ownerTaskId":owner,"requestCount":count,"toolCallCount":count_kind("tool")?,"compactionCount":count_kind("compaction")?,"actualTokens":actual,"reservedTokens":reserved,"unknownRequestCount":unknown,"chargedTokens":actual+reserved,"remainingTokens":limits["maxTokens"].as_u64().unwrap().saturating_sub(actual+reserved),"limits":limits}))
}
impl TaskJournal {
    pub fn budget_call(&mut self, method:&str,args:&Value)->Result<Value>{
        let allowed=match method {"budget.inspect"=>vec!["binding","generation"],"budget.reserve"=>vec!["binding","generation","requestId","purpose","estimatedInputTokens","maxOutputTokens","limits"],"budget.settle"=>vec!["binding","generation","requestId","status","usage","errorCode"],"budget.boundary"=>vec!["binding","generation","eventId","kind"],_=>bail!("UNKNOWN_METHOD")};
        fields(args,&allowed)?;
        let tx=self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (binding,owner)=identity(&tx,args,matches!(method,"budget.reserve"|"budget.boundary"))?;
        if method=="budget.inspect" {return budget(&tx,&owner);}
        if method=="budget.reserve" {
            let request=text(args,"requestId",240)?; let purpose=text(args,"purpose",20)?;
            ensure!(["creation","summary","review","retry"].contains(&purpose),"INVALID_PURPOSE");
            let estimate=number(args,"estimatedInputTokens",100_000_000)?+number(args,"maxOutputTokens",100_000_000)?;
            ensure!(estimate>0,"EMPTY_RESERVATION");
            let hash=digest(&document(args)?);
            let prior:Option<String>=tx.query_row("SELECT request_hash FROM craftmine_budget_requests WHERE owner=?1 AND request_id=?2",params![owner,request],|r|r.get(0)).optional()?;
            if let Some(prior)=prior {ensure!(prior==hash,"REPLAY_MISMATCH");}
            else {
                if let Some(input)=args.get("limits") {
                    fields(input,&["maxRequests","maxTokens","maxCompactions","deadlineAt"])?;
                    let mut normalized=limits(&tx,&owner)?;
                    for (key,max) in [("maxRequests",10000),("maxTokens",100_000_000),("maxCompactions",100)] {if input.get(key).is_some(){let n=number(input,key,max)?;ensure!(n>0,"INVALID_BUDGET_LIMIT");normalized[key]=json!(n);}}
                    if input.get("deadlineAt").is_some(){normalized["deadlineAt"]=if input["deadlineAt"].is_null(){Value::Null}else{json!(number(input,"deadlineAt",i64::MAX as u64)?)};}
                    let prior:Option<String>=tx.query_row("SELECT limits FROM craftmine_budget_limits WHERE owner=?1",[&owner],|r|r.get(0)).optional()?;
                    if let Some(old)=prior{ensure!(serde_json::from_str::<Value>(&old)?==normalized,"BUDGET_LIMITS_IMMUTABLE");}
                    else{tx.execute("INSERT INTO craftmine_budget_limits(owner,limits) VALUES(?1,?2)",params![owner,serde_json::to_string(&normalized)?])?;}
                }
                let current=budget(&tx,&owner)?;let l=&current["limits"];
                ensure!(current["requestCount"].as_u64().unwrap()<l["maxRequests"].as_u64().unwrap(),"REQUEST_BUDGET_EXHAUSTED");
                ensure!(current["chargedTokens"].as_u64().unwrap()+estimate<=l["maxTokens"].as_u64().unwrap(),"TOKEN_BUDGET_EXHAUSTED");
                ensure!(l["deadlineAt"].as_i64().is_none_or(|at|at>worlds::timestamp().unwrap_or(i64::MAX)),"TASK_DEADLINE_EXCEEDED");
                tx.execute("INSERT OR IGNORE INTO craftmine_budget_limits(owner,limits) VALUES(?1,?2)",params![owner,serde_json::to_string(l)?])?;
                tx.execute("INSERT INTO craftmine_budget_requests(owner,request_id,task_id,generation,purpose,request_hash,estimate,status) VALUES(?1,?2,?3,?4,?5,?6,?7,'reserved')",params![owner,request,binding.task_id,args["generation"].as_i64(),purpose,hash,estimate as i64])?;
            }
        } else if method=="budget.settle" {
            let request=text(args,"requestId",240)?; let status=text(args,"status",20)?;
            ensure!(["known","unknown","cancelled"].contains(&status),"INVALID_SETTLEMENT");
            let (task,generation,prior):(String,u64,Option<String>)=tx.query_row("SELECT task_id,generation,settlement FROM craftmine_budget_requests WHERE owner=?1 AND request_id=?2",params![owner,request],|r|Ok((r.get(0)?,r.get::<_,i64>(1)? as u64,r.get(2)?))).context("RESERVATION_NOT_FOUND")?;
            ensure!(task==binding.task_id&&Some(generation)==args["generation"].as_u64(),"RESERVATION_BINDING_MISMATCH");
            let mut settlement=json!({"status":status});
            if status=="known" {
                let usage=&args["usage"];fields(usage,&["inputTokens","outputTokens","totalTokens"])?;
                let input=number(usage,"inputTokens",100_000_000)?;let output=number(usage,"outputTokens",100_000_000)?;
                let total=if usage.get("totalTokens").is_some(){number(usage,"totalTokens",200_000_000)?}else{input+output};
                ensure!(total>=input&&total>=output,"INVALID_USAGE_TOTAL");settlement["usage"]=json!({"inputTokens":input,"outputTokens":output,"totalTokens":total});
            }else{ensure!(args.get("usage").is_none_or(Value::is_null),"UNKNOWN_USAGE_MUST_BE_ABSENT");}
            if args.get("errorCode").is_some(){settlement["errorCode"]=json!(text(args,"errorCode",120)?);}
            if let Some(prior)=prior {ensure!(serde_json::from_str::<Value>(&prior)?==settlement,"SETTLEMENT_MISMATCH");}
            else{tx.execute("UPDATE craftmine_budget_requests SET status=?3,settlement=?4 WHERE owner=?1 AND request_id=?2",params![owner,request,status,serde_json::to_string(&settlement)?])?;}
        } else {
            let event=text(args,"eventId",240)?;let kind=text(args,"kind",20)?;ensure!(["compaction","tool"].contains(&kind),"INVALID_BOUNDARY");
            let prior:Option<String>=tx.query_row("SELECT kind FROM craftmine_budget_events WHERE owner=?1 AND event_id=?2",params![owner,event],|r|r.get(0)).optional()?;
            if let Some(old)=prior{ensure!(old==kind,"REPLAY_MISMATCH");}else{
                let current=budget(&tx,&owner)?;
                if kind=="compaction"{ensure!(current["compactionCount"].as_u64().unwrap()<current["limits"]["maxCompactions"].as_u64().unwrap(),"COMPACTION_BUDGET_EXHAUSTED");}
                tx.execute("INSERT INTO craftmine_budget_events(owner,event_id,kind) VALUES(?1,?2,?3)",params![owner,event,kind])?;
            }
        }
        let result=json!({"requestId":args["requestId"],"status":args.get("status").cloned().unwrap_or(json!("reserved")),"budget":budget(&tx,&owner)?});tx.commit()?;Ok(result)
    }
    pub fn task_context(&mut self,args:&Value)->Result<Value>{
        fields(args,&["context"])?;let ctx:WorkspaceContext=serde_json::from_value(args["context"].clone())?;
        let snapshot=workspaces::inspect(&self.db,&ctx)?;let task=&snapshot.task;
        let (generation,owner,recovery)=runtime(&self.db,&task.binding.task_id)?;
        let world=worlds::read(&self.db,&snapshot.world_id)?;
        let mut modified=Vec::new();
        for (kind,group) in [("object","objects"),("behavior","behaviors"),("system","systems")] {
            let empty=Vec::new();let before=world.world.build["scene"][group].as_array().unwrap_or(&empty);let after=task.draft["scene"][group].as_array().unwrap_or(&empty);
            for item in after{if !before.contains(item){if let Some(id)=item["id"].as_str(){modified.push(format!("{kind}:{id}"));}}}
            for item in before{if !after.iter().any(|a|a["id"]==item["id"]){if let Some(id)=item["id"].as_str(){modified.push(format!("{kind}:{id}"));}}}
        }
        let requirements=self.db.prepare("SELECT request_id,kind,text FROM craftmine_task_requirements WHERE task_id=?1 ORDER BY created_at DESC LIMIT 8")?.query_map([&task.binding.task_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"text":r.get::<_,String>(2)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let receipts=self.db.prepare("SELECT result FROM craftmine_receipts WHERE task_id=?1 ORDER BY rowid DESC LIMIT 12")?.query_map([&task.binding.task_id],|r|r.get::<_,String>(0))?.map(|r|Ok(serde_json::from_str::<Value>(&r?)?)).collect::<Result<Vec<_>>>()?;
        let jobs=self.db.prepare("SELECT id,status FROM craftmine_verifications WHERE task_id=?1 ORDER BY created_at DESC LIMIT 8")?.query_map([&task.binding.task_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"status":r.get::<_,String>(1)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let owned:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_world_leases WHERE task_id=?1)",[&task.binding.task_id],|r|r.get(0))?;
        Ok(json!({"binding":task.binding,"generation":generation,"status":task.status,"recovery":recovery,"world":{"id":snapshot.world_id,"revision":world.summary.revision,"buildId":world.world.build["id"],"hash":world.content_hash},"draft":{"revision":task.revision,"hash":task.draft_hash},"modifiedResources":modified,"requirements":requirements,"receipts":receipts,"jobs":jobs,"lease":{"owned":owned},"budget":budget(&self.db,&owner)?}))
    }
    pub fn task_record_context(&mut self,args:&Value)->Result<Value>{
        fields(args,&["context","requestId","text","kind"])?;let ctx:WorkspaceContext=serde_json::from_value(args["context"].clone())?;
        let task=workspaces::inspect(&self.db,&ctx)?;workspaces::assert_live(&self.db,&task)?;
        let id=text(args,"requestId",240)?;let body=text(args,"text",16000)?;let kind=text(args,"kind",20)?;ensure!(["request","correction"].contains(&kind),"INVALID_REQUIREMENT_KIND");
        let prior:Option<(String,String)>=self.db.query_row("SELECT kind,text FROM craftmine_task_requirements WHERE task_id=?1 AND request_id=?2",params![task.task.binding.task_id,id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((old_kind,old_body))=prior{ensure!(old_kind==kind&&old_body==body,"REPLAY_MISMATCH");}else{self.db.execute("INSERT INTO craftmine_task_requirements(task_id,request_id,kind,text,created_at) VALUES(?1,?2,?3,?4,?5)",params![task.task.binding.task_id,id,kind,body,worlds::timestamp()?])?;}
        Ok(json!({"id":id,"recorded":true}))
    }
}
