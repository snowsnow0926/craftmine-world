# ADR 0310: Native request acceptance and player application

Status: Accepted. Date: 2026-09-09. Implements the integration part of ADR 0309.

## Decision

Electron attaches the latest actual user message ID/content and executor model to
Craftmine tool invocations. Model tool arguments cannot override this provenance.
Verification snapshots that provenance in Rust. After a machine pass, the built-in
plugin schedules one independent PI completion using that captured model. This
uses the existing provider resolver, credentials, rate limit and one-shot helper;
there is no second Agent loop. The private completion operation has a cancellation
ID so ending a turn can abort a review even after the submitting tool has returned.

The review response is data: a Chinese summary, advisory verdict/suggestions,
limitations, bounded event steps and 2–24 request assertions. Plans must include
noErrors and an observable effect. Invalid/duplicate assertions, nonexistent step
labels, undeclared keys and arbitrary scripts are rejected. Rust seals the exact
response and plan before execution. Failures retain the response and usage when
available. Editing, stopping or superseding a draft revokes review publication.

The review prompt supplies authoritative terrain coordinates (ground y=6), anchor
semantics and visibility/mesh observations. It distinguishes module fixture traces
from native renderer evidence. A real-model run exposed false ground-y=0 and
hidden-mesh assumptions when this context was missing; the corrected run passed
14 request assertions. The Agent's verification read includes the latest review
and at most six bounded failure details so it can repair actual failed requirements.

The isolated native renderer loads the baseline and candidate in separate runs.
Each uses the actual game/Workers and denied input/navigation/privileges. Read-only
observations include actual mesh presence; bounded request steps dispatch gameplay
events directly, without mouse/keyboard simulation. The unchanged assertion DSL
evaluates those observations. A failure to hide a mesh therefore remains visible
even when a valid command changed its color. These steps do not prove walking
physics, weapon controls, sound perception or visual aesthetics; the UI preserves
the review's limitations and the independent preview.

The preview shows the captured request, actual assertions and advisory suggestions.
The player can Apply only a current check with completed review and passing machine
assertions. Even a reviewer verdict of block does not veto those results. Application
saves/freezes the formal runtime, prepares migration using pure compatibility code,
checks collision against saved overrides, and asks the private native service to
load/render the candidate with that exact progress. Rust commits atomically; the
panel then loads the authoritative world. Uncertain replies are reconciled by the
same operation receipt while the original frame remains paused.

Both concurrent and persisted receipt replays must match the check, review, world
and saved revision. A lost commit reply recovers the current authoritative world
without repeating native application. Cancelled PI requests reject even a provider
that resolves successfully after abort; explicit cancellation is not a timeout.

The first compositor paint can lag the loaded message. Native capture explicitly
invalidates the offscreen view and requires real nonblack pixels within 2.5 seconds.
Persistent black frames still fail. Static HTTP routes add only request-plan and
preview-probe; the route file's frozen hash is updated, with no DSL relaxation.

## Validation and remaining scope

Native acceptance configures a provider in its isolated Rust settings and exercises
the real PI completion transport against a fixed loopback responder. It proves
actual event/mesh assertions, rejection of a wrong-effect implementation, advisory
block handling, panel application, preserved position and the next turn's new base.
That responder is a test fixture, not a real-model result or Agent-generated code.
An opt-in native run also configured the existing DeepSeek model in an isolated PI
profile, made a real completion and passed 33 lifecycle/application checks. The
draft remained fixture-authored; full native Agent-generated creation is separate.
The failed first review and corrected result are preserved in the batch evidence.

The 180k-character review input bound remains explicit. Request assertions are a
model interpretation shown to the player, not a proof of all natural-language intent.
Review usage is durable per job; aggregation across tasks/compaction remains W3.
History restore and backup UI remain W5. No visible/focused test window is used.
