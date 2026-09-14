# Remove implicit cumulative limits from ordinary player creation

Date: 2026-09-14

Status: accepted for the Craftmine player product

## Context

A real DeepSeek creation task repeatedly compacted and stopped at the local
8-compaction limit. The durable default also imposed 80 requests and the private
host added a 30-minute task deadline. These limits were not player choices and
made authentic creation terminate independently of model capacity or user stop.

## Decision

New ordinary owners use nullable cumulative request and compaction limits, with
no implicit whole-turn deadline. Keep durable counters, explicit token budgets,
single-request capacity checks, cancellation, and immutable owner policies.

Do not infer provenance from old numeric values or rewrite old owners on load.
Instead provide an explicit player-only recovery action for an interrupted task
whose durable execution limit is exhausted. It records previous/new policies,
retains the token budget, and lets the normal resume path keep the same draft
and accounting owner. A read-only exact receipt lookup supports lost responses
and restart after head advancement. No model tool can request this authority.

## Consequences

Ordinary work may continue until it completes, is cancelled, reaches actual
provider/request capacity, or consumes an explicit budget. Historical errors are
retained. Existing capped tasks require explicit player recovery; upgrading the
application alone does not silently change their policy. Summary-loop defects
must be fixed at their triggering algorithm, rather than hidden by another
arbitrary whole-task counter.

The explicit player recovery is exposed through the existing Main panel and
persistent operation journal, with a failure-card and task-workbench action.
See [the UI/host contract](../spec/player-execution-limit-recovery-ui.md).
This extends the existing panel allowlist; it adds no model tool, direct renderer
Core identity, automatic migration, or provider credential access.
