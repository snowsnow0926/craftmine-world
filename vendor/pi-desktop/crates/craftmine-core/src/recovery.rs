//! Explicit recovery preserves drafts, while a fresh turn fences late writers.
use super::{durable::{budget,fields,runtime,text},read_task,TaskJournal,WorkspaceContext};
use anyhow::{ensure,Result};
use rusqlite::{params,TransactionBehavior};
use serde_json::{json,Value};

impl TaskJournal {
    /// Called once when the broker process starts, after job recovery.
    pub fn task_recover(&mut self)->Result<Value>{
        let tx=self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let tasks=tx.prepare("SELECT task_id FROM craftmine_world_leases")?.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for task in &tasks {runtime(&tx,task)?;
            tx.execute("UPDATE craftmine_task_runtime SET recovery='interrupted' WHERE task_id=?1",[task])?;
            tx.execute("UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1 AND status='running'",[task])?;
            super::verification::cancel_task(&tx,task)?;
        }
        tx.execute("DELETE FROM craftmine_world_leases",[])?;
        tx.execute("UPDATE craftmine_budget_requests SET status='unknown',settlement=json_object('status','unknown','errorCode','HOST_INTERRUPTED') WHERE status='reserved'",[])?;
        tx.commit()?;Ok(json!({"interruptedTasks":tasks,"modelReplay":false}))
    }
    pub fn task_recoverable(&self,args:&Value)->Result<Value>{
        fields(args,&["projectId","worldId"])?;let project=text(args,"projectId",240)?;
        let world=args.get("worldId").and_then(Value::as_str);
        let rows=self.db.prepare("SELECT r.task_id,r.generation,w.world_id FROM craftmine_task_runtime r JOIN craftmine_workspaces w ON w.task_id=r.task_id JOIN craftmine_tasks t ON t.id=r.task_id WHERE r.recovery='interrupted' ORDER BY r.rowid DESC LIMIT 64")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)? as u64,r.get::<_,String>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut items=Vec::new();for (id,generation,world_id) in rows{let task=read_task(&self.db,&id)?;if task.binding.project_id==project&&world.is_none_or(|w|w==world_id){items.push(json!({"taskId":id,"binding":task.binding,"generation":generation,"worldId":world_id,"draftRevision":task.revision,"draftHash":task.draft_hash,"status":"interrupted"}));}}
        Ok(json!({"items":items,"modelReplay":false}))
    }
    pub fn task_resume(&mut self,args:&Value)->Result<Value>{
        fields(args,&["taskId","context","generation"])?;let id=text(args,"taskId",240)?;
        let ctx:WorkspaceContext=serde_json::from_value(args["context"].clone())?;ctx.validate()?;
        let old=read_task(&self.db,id)?;let (generation,owner,recovery)=runtime(&self.db,id)?;
        ensure!(args["generation"].as_u64()==Some(generation),"STALE_GENERATION");
        ensure!(recovery=="interrupted","TASK_NOT_RECOVERABLE");
        ensure!(ctx.project_id==old.binding.project_id&&ctx.session_id==old.binding.session_id,"TASK_BINDING_MISMATCH");
        ensure!(ctx.turn_id!=old.binding.turn_id,"NEW_TURN_REQUIRED");
        let snapshot=self.workspace_open_recovery(&ctx,"",Some((id,generation,&owner)))?;
        Ok(json!({"workspace":snapshot,"generation":generation+1,"budget":budget(&self.db,&owner)?,"modelReplay":false}))
    }
    pub fn task_discard(&mut self,args:&Value)->Result<Value>{
        fields(args,&["taskId","projectId","generation"])?;let id=text(args,"taskId",240)?;
        let tx=self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task=read_task(&tx,id)?;ensure!(task.binding.project_id==text(args,"projectId",240)?,"TASK_BINDING_MISMATCH");
        let (generation,_,recovery)=runtime(&tx,id)?;ensure!(args["generation"].as_u64()==Some(generation),"STALE_GENERATION");
        if recovery=="discarded"{return Ok(json!({"taskId":id,"discarded":true,"preservedDraft":true}));}
        ensure!(recovery=="interrupted","TASK_NOT_RECOVERABLE");
        tx.execute("UPDATE craftmine_task_runtime SET recovery='discarded' WHERE task_id=?1",[id])?;
        tx.execute("UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1",[id])?;
        tx.execute("DELETE FROM craftmine_world_leases WHERE task_id=?1",[id])?;
        tx.execute("DELETE FROM craftmine_session_worlds WHERE head_task=?1",[id])?;
        tx.execute("INSERT OR IGNORE INTO craftmine_ended_turns(session_id,turn_id,status) VALUES(?1,?2,'aborted')",params![task.binding.session_id,task.binding.turn_id])?;
        tx.commit()?;Ok(json!({"taskId":id,"discarded":true,"preservedDraft":true,"modelReplay":false}))
    }
}
