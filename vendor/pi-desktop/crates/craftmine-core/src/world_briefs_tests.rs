use super::*;
use crate::WorldDocument;

fn fixture() -> Result<(tempfile::TempDir,TaskJournal)> {
    let directory=tempfile::tempdir()?;
    let mut journal=TaskJournal::open(&directory.path().join("tasks.sqlite"))?;
    let world=WorldDocument{build:json!({"id":"v-base","scene":{"format":"craftmine.scene/3","objects":[]}}),
        snapshot:json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":7.6,"z":0.5,"yaw":0,"pitch":0}}),extensions:vec![]};
    journal.world_create("a","First",&world)?;journal.world_create("b","Second",&world)?;
    Ok((directory,journal))
}
fn context(turn:&str)->WorkspaceContext {
    WorkspaceContext{project_id:"project".into(),session_id:"author".into(),turn_id:turn.into()}
}
fn add(text:&str)->Value {json!({"worldId":"a","action":"add","operationId":"add-one","expectedRevision":0,"kind":"preserve","text":text})}

#[test]
fn world_brief_replays_cas_and_survives_cold_reopen_without_a_model() -> Result<()> {
    let (directory,mut journal)=fixture()?;
    let request=add("保留博美跟随，不改变背包奖励");
    let first=journal.world_brief_edit(&request)?;
    assert_eq!(first,journal.world_brief_edit(&request)?);
    assert!(journal.world_brief_edit(&add("different request")).is_err());
    let mut conflict=request.clone();conflict["operationId"]=json!("another");
    assert!(journal.world_brief_edit(&conflict).unwrap_err().to_string().contains("REVISION_CONFLICT"));
    drop(journal);
    let journal=TaskJournal::open(&directory.path().join("tasks.sqlite"))?;
    let read=journal.world_brief_read(&json!({"worldId":"a"}))?;
    assert_eq!(read["entries"].as_array().unwrap().len(),1);
    assert_eq!(read["entries"][0]["text"],request["text"]);
    assert_eq!(read["entries"][0]["review"],"not-reviewed");
    assert_eq!(journal.world_brief_read(&json!({"worldId":"b"}))?["entries"],json!([]));
    Ok(())
}

#[test]
fn human_review_is_build_bound_and_edits_clear_it() -> Result<()> {
    let (_directory,mut journal)=fixture()?;journal.world_brief_edit(&add("门可以打开"))?;
    let read=journal.world_brief_read(&json!({"worldId":"a"}))?;
    let review=json!({"worldId":"a","action":"review","operationId":"review-one","expectedRevision":1,
        "id":read["entries"][0]["id"],"buildId":"v-base","accepted":true});
    let mut forged=review.clone();forged["buildId"]=json!("foreign");assert!(journal.world_brief_edit(&forged).is_err());
    journal.world_brief_edit(&review)?;
    let brief=load(&journal.db,"a")?;
    assert_eq!(goals(&brief,&json!("v-base"),false)[0]["review"],"player-accepted-current-build");
    assert_eq!(goals(&brief,&json!("v-new"),false)[0]["review"],"player-accepted-older-build");
    journal.world_brief_edit(&json!({"worldId":"a","action":"update","operationId":"edit-one","expectedRevision":2,
        "id":read["entries"][0]["id"],"kind":"goal","text":"门可以打开和关闭"}))?;
    assert_eq!(journal.world_brief_read(&json!({"worldId":"a"}))?["entries"][0]["review"],"not-reviewed");
    Ok(())
}

#[test]
fn model_only_proposes_and_cannot_change_player_goals_or_other_worlds() -> Result<()> {
    let (_directory,mut journal)=fixture()?;
    let ctx=context("first");journal.workspace_open(&ctx,"a")?;
    assert!(journal.world_brief_edit(&add("busy")).unwrap_err().to_string().contains("WORLD_BUSY"));
    let proposal=json!({"context":ctx,"mode":"propose","operationId":"plan-one","expectedRevision":0,
        "entries":[{"kind":"goal","text":"收集三个物品后解锁飞机"}]});
    let result=journal.world_brief_tool(&proposal)?;
    assert_eq!(result,journal.world_brief_tool(&proposal)?);
    assert_eq!(journal.world_brief_tool(&json!({"context":ctx,"mode":"read"}))?["entries"],json!([]));
    for forged in [json!({"context":ctx,"mode":"edit","action":"review"}),
        json!({"context":ctx,"mode":"read","worldId":"b"}),
        json!({"context":{"projectId":"other","sessionId":"author","turnId":"first"},"mode":"read"})] {
        assert!(journal.world_brief_tool(&forged).is_err());
    }
    let mut forged=proposal.clone();forged["operationId"]=json!("fake-check");forged["entries"][0]["review"]=json!("passed");
    assert!(journal.world_brief_tool(&forged).is_err());
    journal.workspace_end_turn(&ctx.session_id,&ctx.turn_id,"completed")?;
    journal.world_brief_edit(&json!({"worldId":"a","action":"accept-proposal","operationId":"accept-one",
        "expectedRevision":0,"proposalId":result["id"]}))?;
    assert_eq!(journal.world_brief_read(&json!({"worldId":"a"}))?["entries"][0]["review"],"not-reviewed");
    Ok(())
}

#[test]
fn later_tasks_get_preserved_goals_and_exact_historical_unicode() -> Result<()> {
    let (_directory,mut journal)=fixture()?;journal.world_brief_edit(&add("保留城市的完整规模"))?;
    let one=context("one");let opened=journal.workspace_open(&one,"a")?;
    let original="原始城市需求🌧️".repeat(110);
    journal.task_record_context(&json!({"context":one,"requestId":"original","kind":"request","text":original}))?;
    journal.workspace_end_turn(&one.session_id,&one.turn_id,"completed")?;
    let two=context("two");journal.workspace_open(&two,"a")?;
    journal.task_record_context(&json!({"context":two,"requestId":"follow-up","kind":"request","text":"加入雨天，不改变其他玩法"}))?;
    let snapshot=journal.task_context(&json!({"context":two}))?;
    assert_eq!(snapshot["worldBrief"]["entries"][0]["text"],"保留城市的完整规模");
    assert_eq!(snapshot["worldBrief"]["recentRequests"].as_array().unwrap().len(),2);
    assert_eq!(snapshot["worldBrief"]["recentRequests"][1]["truncated"],true);
    let page=journal.world_brief_tool(&json!({"context":two,"mode":"history","taskId":opened.task.binding.task_id,
        "requestId":"original","start":3,"limit":31}))?;
    assert_eq!(page["text"],original.chars().skip(3).take(31).collect::<String>());
    assert_eq!(page["historical"],true);
    let foreign=WorkspaceContext{session_id:"other".into(),..context("other")};journal.workspace_open(&foreign,"b")?;
    assert!(journal.world_brief_tool(&json!({"context":foreign,"mode":"history","taskId":opened.task.binding.task_id,"requestId":"original"})).is_err());
    Ok(())
}

#[test]
fn stale_proposal_cannot_overwrite_new_player_goals() -> Result<()> {
    let (_directory,mut journal)=fixture()?;let ctx=context("first");journal.workspace_open(&ctx,"a")?;
    let proposal=journal.world_brief_tool(&json!({"context":ctx,"mode":"propose","operationId":"propose-one","expectedRevision":0,"entries":[{"kind":"goal","text":"旧建议"}]}))?;
    journal.workspace_end_turn(&ctx.session_id,&ctx.turn_id,"completed")?;
    journal.world_brief_edit(&add("更新的玩家要求"))?;
    assert!(journal.world_brief_edit(&json!({"worldId":"a","action":"accept-proposal","operationId":"accept-old","expectedRevision":1,"proposalId":proposal["id"]})).unwrap_err().to_string().contains("PROPOSAL_STALE"));
    assert_eq!(journal.world_brief_read(&json!({"worldId":"a"}))?["entries"].as_array().unwrap().len(),1);
    Ok(())
}
