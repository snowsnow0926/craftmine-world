# ADR 0320: Bind a content apply to a launch-confirmed deployment

Status: accepted
Owner: S1 (core transactions and RPC)

## Context

`content.apply.confirm` used to accept `{operationId, appliedOid, detail}`. The
only checks were that `appliedOid` equalled the intent's `targetOid` and that
`refs/craftmine/applied/<world>` already pointed at it. Both values were chosen
by the caller, so a page or a model could mark content applied by restating an
object id and the words "host committed deployment". The audit of round two
recorded exactly this: Git content and the game deployment were separate facts
that never had to agree.

## Decision

`content.apply.confirm` takes `{operationId, applicationId, detail}` and resolves
the deployment itself. It commits only when all of the following hold:

1. `craftmine_godot_applications[applicationId]` is `applied` for the
   operation's world.
2. Its launch evidence is a real instance: `passed`, a non-empty `instanceId`
   and a 64-hex `stateHash`.
3. The candidate it consumed is `ready`/`applied` and its check job is `passed`
   with exactly the recorded `checkOutputHash`.
4. The published build's `content_oid` equals the operation's `targetOid`.
5. The application's `input.revision` equals the operation's
   `expectedProgressRevision`, and the formal world is now exactly one revision
   further.
6. `refs/craftmine/applied/<world>` still points at the target.

The operation then moves to `committed` and stores the application id in the new
`craftmine_content_operations.application_id` column. Repeating the call with the
same application returns the stored intent, so a lost response is answered from
the same operation instead of applying again; a different application is
`REPLAY_MISMATCH`.

`godotApplication.commit` remains the only producer of the launch evidence, so
neither the page nor the model can grant a check or an application.

## Consequences

* The old request shape is rejected by `deny_unknown_fields`; consumers must
  pass the applied application id.
* A deployment that only prepared, never launched, or published other content
  cannot commit a content operation.
* `craftmine_content_operations` gained a nullable `application_id` column; the
  migration is additive and backfills existing rows as `NULL`.
* Content restore and branch application follow the same rule: whatever content
  becomes the applied reference must have run in a confirmed instance.
