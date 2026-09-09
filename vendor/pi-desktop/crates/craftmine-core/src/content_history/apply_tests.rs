//! VM2 reference-transaction tests: every crash point between the Git
//! reference update and the deployment record is recoverable, and no path
//! reports success that the Git side does not prove.

use anyhow::Result;
use serde_json::json;

use super::apply::*;
use super::contract::OperationContext;
use super::git::{GitAdapter, GitIdentity};
use super::repo::{ContentFile, RepositoryStore, MAIN_BRANCH};
use crate::TaskJournal;

struct Fixture {
    _dir: tempfile::TempDir,
    journal: TaskJournal,
    store: RepositoryStore,
}

fn fixture() -> Result<Fixture> {
    let dir = tempfile::tempdir()?;
    let journal = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    journal.db.execute(
        "INSERT INTO craftmine_worlds(id,title,revision,updated_at,document,content_hash)
         VALUES('world-1','World',0,0,'{}',?1)",
        rusqlite::params![crate::digest("{}")],
    )?;
    let store = RepositoryStore::open(
        &dir.path().join("content-history"),
        GitAdapter::discover(
            &dir.path().join("git-config"),
            &[],
            GitIdentity::local("Craftmine Tester", "test-stable-id")?,
        )?,
    )?;
    Ok(Fixture {
        _dir: dir,
        journal,
        store,
    })
}

/// One applied commit plus one candidate commit on a plan branch.
fn seeded(fixture: &mut Fixture) -> Result<(String, String)> {
    let layout = fixture.store.create("world-1-repo", "sha1", None)?;
    let applied = fixture.store.commit(
        &layout,
        MAIN_BRANCH,
        None,
        &[ContentFile::text("project.godot", "config_version=5\n")],
        "applied\n",
    )?;
    fixture
        .store
        .set_applied(&layout, "world-1", &applied, None)?;
    let candidate = fixture.store.commit(
        &layout,
        "plan-a",
        None,
        &[ContentFile::text("project.godot", "config_version=5\nname=\"a\"\n")],
        "candidate\n",
    )?;
    Ok((applied, candidate))
}

fn context(applied: Option<&str>, candidate: &str) -> OperationContext {
    OperationContext {
        operation_id: "op-1".to_string(),
        world_id: "world-1".to_string(),
        repo_id: "world-1-repo".to_string(),
        branch_id: "plan-a".to_string(),
        expected_head_oid: Some(candidate.to_string()),
        expected_applied_oid: applied.map(|oid| oid.to_string()),
        expected_progress_revision: Some(7),
    }
}

/// Synthetic deployment evidence that binds `content_oid` to the same world and
/// to one step past the operation's expected progress revision.
fn evidence(content_oid: &str) -> DeploymentEvidence {
    DeploymentEvidence {
        application_id: "application-1".to_string(),
        build_id: "build-1".to_string(),
        content_oid: content_oid.to_string(),
        candidate_id: "candidate-1".to_string(),
        check_job_id: "check-1".to_string(),
        check_output_hash: "c".repeat(64),
        input_revision: 7,
        world_revision: 8,
        instance_id: "instance-1".to_string(),
    }
}

#[test]
fn git_advance_and_database_confirmation_are_separate_durable_steps() -> Result<()> {
    let mut fixture = fixture()?;
    let (applied, candidate) = seeded(&mut fixture)?;
    let layout = fixture.store.layout("world-1-repo")?;

    let intent = prepare(
        &mut fixture.journal.db,
        &context(Some(&applied), &candidate),
        OperationKind::Apply,
        &candidate,
        "apply plan-a candidate",
    )?;
    assert_eq!(intent.state, OperationState::Prepared);
    assert_eq!(intent.target_oid, candidate);
    assert_eq!(intent.expected_applied_oid.as_deref(), Some(applied.as_str()));

    // Nothing has moved yet: recovery must not claim an application.
    let report = recover(&fixture.journal.db, &fixture.store, "world-1")?;
    assert_eq!(report.applied_oid.as_deref(), Some(applied.as_str()));
    assert_eq!(
        report.actions,
        vec![RecoveryAction::RollBack {
            operation_id: "op-1".to_string(),
            expected_applied_oid: Some(applied.clone()),
        }]
    );

    let advanced = advance(&mut fixture.journal.db, &fixture.store, "op-1")?;
    assert_eq!(advanced.state, OperationState::ReferenceAdvanced);
    assert_eq!(
        fixture.store.applied(&layout, "world-1")?,
        Some(candidate.clone())
    );
    // Repeating advance is idempotent.
    let again = advance(&mut fixture.journal.db, &fixture.store, "op-1")?;
    assert_eq!(again.state, OperationState::ReferenceAdvanced);

    // The Git side moved but the caller has not committed its deployment, so
    // recovery reports "complete the deployment or roll back", never success.
    let report = recover(&fixture.journal.db, &fixture.store, "world-1")?;
    assert_eq!(
        report.actions,
        vec![RecoveryAction::Complete {
            operation_id: "op-1".to_string(),
            target_oid: candidate.clone(),
        }]
    );

    let committed = confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &evidence(&candidate),
        "deployment record written",
    )?;
    assert_eq!(committed.state, OperationState::Committed);
    assert_eq!(
        committed.application_id.as_deref(),
        Some("application-1")
    );
    // A lost response is answered by the same operation, not by applying again.
    let replay = confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &evidence(&candidate),
        "deployment record written",
    )?;
    assert_eq!(replay.state, OperationState::Committed);
    let mut forged = evidence(&candidate);
    forged.application_id = "application-2".to_string();
    assert!(confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &forged,
        "another deployment",
    )
    .unwrap_err()
    .to_string()
    .starts_with("REPLAY_MISMATCH"));
    assert!(recover(&fixture.journal.db, &fixture.store, "world-1")?
        .actions
        .is_empty());
    Ok(())
}

#[test]
fn a_deployment_that_does_not_match_the_operation_is_refused() -> Result<()> {
    let mut fixture = fixture()?;
    let (applied, candidate) = seeded(&mut fixture)?;
    prepare(
        &mut fixture.journal.db,
        &context(Some(&applied), &candidate),
        OperationKind::Apply,
        &candidate,
        "apply plan-a candidate",
    )?;
    advance(&mut fixture.journal.db, &fixture.store, "op-1")?;

    // A deployment of different content never confirms this operation.
    let mut other_content = evidence(&candidate);
    other_content.content_oid = applied.clone();
    assert!(confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &other_content,
        "wrong content",
    )
    .unwrap_err()
    .to_string()
    .starts_with("CONTENT_OPERATION_TARGET_MISMATCH"));

    // A deployment prepared at a different formal progress is stale.
    let mut stale = evidence(&candidate);
    stale.input_revision = 6;
    assert!(confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &stale,
        "stale progress",
    )
    .unwrap_err()
    .to_string()
    .starts_with("CONTENT_PROGRESS_CONFLICT"));

    // A deployment that did not advance progress by exactly one step is stale.
    let mut skipped = evidence(&candidate);
    skipped.world_revision = 9;
    assert!(confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &skipped,
        "skipped progress",
    )
    .unwrap_err()
    .to_string()
    .starts_with("CONTENT_PROGRESS_CONFLICT"));

    // The operation is still open and the Git reference is unchanged.
    assert_eq!(
        intent(&fixture.journal.db, "op-1")?.state,
        OperationState::ReferenceAdvanced
    );
    Ok(())
}

#[test]
fn a_stale_expected_applied_value_refuses_to_move_the_reference() -> Result<()> {
    let mut fixture = fixture()?;
    let (applied, candidate) = seeded(&mut fixture)?;
    let layout = fixture.store.layout("world-1-repo")?;
    let mut ctx = context(Some(&applied), &candidate);
    // Another writer already applied something else.
    ctx.expected_applied_oid = Some("0".repeat(40));
    prepare(
        &mut fixture.journal.db,
        &ctx,
        OperationKind::Apply,
        &candidate,
        "stale",
    )?;
    let error = advance(&mut fixture.journal.db, &fixture.store, "op-1")
        .unwrap_err()
        .to_string();
    assert!(
        error.starts_with("GIT_REF_CAS_FAILED"),
        "unexpected error: {error}"
    );
    // The intent stays open and the reference is untouched.
    assert_eq!(fixture.store.applied(&layout, "world-1")?, Some(applied.clone()));
    let report = recover(&fixture.journal.db, &fixture.store, "world-1")?;
    assert!(matches!(
        report.actions.as_slice(),
        [RecoveryAction::Conflict { .. }]
    ));
    let aborted = abort(
        &mut fixture.journal.db,
        "op-1",
        "candidate became stale",
    )?;
    assert_eq!(aborted.state, OperationState::Aborted);
    assert!(recover(&fixture.journal.db, &fixture.store, "world-1")?
        .actions
        .is_empty());
    Ok(())
}

#[test]
fn two_writers_cannot_both_advance_the_same_world() -> Result<()> {
    let mut fixture = fixture()?;
    let (applied, candidate) = seeded(&mut fixture)?;
    let layout = fixture.store.layout("world-1-repo")?;
    let second = fixture.store.commit(
        &layout,
        "plan-b",
        None,
        &[ContentFile::text("project.godot", "config_version=5\nname=\"b\"\n")],
        "second candidate\n",
    )?;
    let mut first = context(Some(&applied), &candidate);
    first.operation_id = "op-1".to_string();
    let mut other = context(Some(&applied), &second);
    other.operation_id = "op-2".to_string();
    other.branch_id = "plan-b".to_string();
    prepare(
        &mut fixture.journal.db,
        &first,
        OperationKind::Apply,
        &candidate,
        "first",
    )?;
    prepare(
        &mut fixture.journal.db,
        &other,
        OperationKind::Apply,
        &second,
        "second",
    )?;
    advance(&mut fixture.journal.db, &fixture.store, "op-1")?;
    let error = advance(&mut fixture.journal.db, &fixture.store, "op-2")
        .unwrap_err()
        .to_string();
    assert!(error.starts_with("GIT_REF_CAS_FAILED"));
    assert_eq!(fixture.store.applied(&layout, "world-1")?, Some(candidate));
    Ok(())
}

#[test]
fn rollback_restores_the_previous_applied_content_after_a_crash() -> Result<()> {
    let mut fixture = fixture()?;
    let (applied, candidate) = seeded(&mut fixture)?;
    let layout = fixture.store.layout("world-1-repo")?;
    prepare(
        &mut fixture.journal.db,
        &context(Some(&applied), &candidate),
        OperationKind::Apply,
        &candidate,
        "apply",
    )?;
    advance(&mut fixture.journal.db, &fixture.store, "op-1")?;
    assert_eq!(
        fixture.store.applied(&layout, "world-1")?,
        Some(candidate.clone())
    );
    let rolled = rollback(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        "deployment record could not be written",
    )?;
    assert_eq!(rolled.state, OperationState::Aborted);
    assert_eq!(
        fixture.store.applied(&layout, "world-1")?,
        Some(applied.clone())
    );
    assert!(recover(&fixture.journal.db, &fixture.store, "world-1")?
        .actions
        .is_empty());
    Ok(())
}

#[test]
fn operation_ids_are_idempotent_but_cannot_be_reused() -> Result<()> {
    let mut fixture = fixture()?;
    let (applied, candidate) = seeded(&mut fixture)?;
    let ctx = context(Some(&applied), &candidate);
    let first = prepare(
        &mut fixture.journal.db,
        &ctx,
        OperationKind::Apply,
        &candidate,
        "apply",
    )?;
    let repeated = prepare(
        &mut fixture.journal.db,
        &ctx,
        OperationKind::Apply,
        &candidate,
        "apply",
    )?;
    assert_eq!(first, repeated);
    assert_eq!(
        prepare(
            &mut fixture.journal.db,
            &ctx,
            OperationKind::Apply,
            &applied,
            "different target",
        )
        .unwrap_err()
        .to_string(),
        "CONTENT_OPERATION_ID_REUSED: op-1"
    );
    advance(&mut fixture.journal.db, &fixture.store, "op-1")?;
    confirm(
        &mut fixture.journal.db,
        &fixture.store,
        "op-1",
        &evidence(&candidate),
        "done",
    )?;
    assert_eq!(prepare(
        &mut fixture.journal.db,
        &ctx,
        OperationKind::Apply,
        &candidate,
        "again",
    )
    ?.state,OperationState::Committed);
    let mut different=ctx.clone(); different.branch_id="other".into();
    assert!(prepare(&mut fixture.journal.db,&different,OperationKind::Apply,&candidate,"same oid, wrong branch")
        .unwrap_err().to_string().starts_with("CONTENT_OPERATION_ID_REUSED"));
    Ok(())
}

#[test]
fn a_lost_response_is_answered_from_the_stored_receipt() -> Result<()> {
    let mut fixture = fixture()?;
    let result = json!({"operationId":"op-1","status":"ref-advanced"});
    store_receipt(
        &mut fixture.journal.db,
        "op-1",
        "call-1",
        &"a".repeat(64),
        &result,
    )?;
    assert_eq!(
        receipt(&mut fixture.journal.db, "op-1", "call-1", &"a".repeat(64))?,
        Some(result.clone())
    );
    assert_eq!(
        receipt(&mut fixture.journal.db, "op-1", "call-1", &"b".repeat(64))
            .unwrap_err()
            .to_string(),
        "REPLAY_MISMATCH"
    );
    assert_eq!(
        store_receipt(
            &mut fixture.journal.db,
            "op-1",
            "call-1",
            &"a".repeat(64),
            &json!({"status":"different"})
        )
        .unwrap_err()
        .to_string(),
        "REPLAY_MISMATCH"
    );
    // Repeating the identical call is idempotent.
    store_receipt(
        &mut fixture.journal.db,
        "op-1",
        "call-1",
        &"a".repeat(64),
        &result,
    )?;
    assert_eq!(
        receipt(&mut fixture.journal.db, "op-1", "missing", &"a".repeat(64))?,
        None
    );
    Ok(())
}
