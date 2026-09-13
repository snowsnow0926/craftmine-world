# First independent creation: product and implementation plan

Date: 2026-09-13. Accepted direction: a new player independently opens a world,
uses existing content, makes a change, saves/reopens, and gives the result to a
friend. Baseline: `475bc6a5`. Development uses a dedicated worktree and the
existing PI Desktop shell, world services, source installer and native checks.

## Product diagnosis

The current release proves playable examples, bundled modeling, real Codex
authoring and component/world-template reuse. It does not yet prove first-time
user success on another clean Windows machine. Known selected assets still
enter an AI conversation from the main library. First example preparation took
23–31 seconds and world switching 11–16 seconds in the measured runs. Composite
content has real placement, input, source and persistence requirements. README
and the current delivery page still point at preview.20. These are the immediate
product gaps; existing implementation reports remain historical evidence.

The next success criterion is a player-accepted, playable and retained change
without developer intervention. Generated code volume or an Agent's completion
message is not sufficient. The intended first users remain non-programming
creators and friends who play their creations.

## Development order

### A. Direct use of an explicitly selected compatible asset

Add a direct-use action to the existing asset detail, alongside AI modification.
For supported source packages, the player selects an exact immutable version and
placement, then explicitly asks the application to check and add it. Ordinary
native installation, build validation, progress protection and adoption run with
no model call, CLI login or Composer mutation. Unsupported kinds and detected
incompatibilities explain their actual limitation; they do not silently become
different content. World templates keep their independent-world creation flow.

Native main owns asset bytes, selection, operation identity, source/build scope
and any sampled position. The renderer receives bounded product results, never
filesystem paths, source text, execution credentials or arbitrary RPC access.
Reads may describe eligibility but cannot claim target compatibility until the
actual target checks pass. Retries recover the same operation. Cancelled or
stale work cannot later apply to another world. Failed installation/checks must
preserve the original formal world and clearly distinguish retained draft work.

Use the current parameter editing and history features for subsequent changes.
Natural-language modification and new content still use the player's chosen
Agent and model; this is not keyword-based imitation of an arbitrary wish.

### B. One understandable creation journey in PI Desktop

Use the current sidebar, library, world view and conversation. Explain the
current step and the available next action: preparing, checking, added, or an
actionable failure. Preserve useful progress when a panel closes or the user
returns. Keep AI add/modify available and independent of the direct path.
Provide a concise first-use guide for examples, direct use, a supported edit,
save/reopen and portable world sharing. Existing controls must not be rebuilt
as a second frontend.

### C. Consistent distribution and first-time evaluation

Update README/current-release documentation to the actual delivered version and
location, clearly separating the accepted preview from new development. Record
the GitHub default-branch discrepancy without silently changing repository
settings. Keep play-without-AI and optional Codex connection distinct.

Prepare an evaluation packet for approximately five to eight new users and a
clean Windows machine: their own actions, original requests, observed blockers,
developer assistance, full time to playable result, revision attempts, and
save/reopen/share results. No participant result or clean-machine pass may be
invented from developer-machine automation. External participants/machines are
an availability dependency, not a reason to stop the independent development.

### D. Follow measured bottlenecks

Use observed first-use failures and stage timings to select loading/context
optimizations. Turn repeated successful assemblies into configurable validated
templates using the existing asset/version system. Community distribution and
multiplayer follow evidence of useful reusable supply and sustained creation.
Any later model-routing experiment preserves explicit model choices and records
its own actual quality/time/usage results.

## First implementation acceptance

1. A fresh isolated client with no model connection adds an existing supported
   companion through the real asset-detail direct action, native check and
   formal adoption. Its exact model bytes remain unchanged.
2. Two direct additions have distinct instance identities; the selected version
   and normal placement are retained. Existing player and world source survive.
3. A supported ordinary modification can be saved; cold reopening restores the
   formal content and progress. Existing world-template export/import remains
   usable for giving the creation to another player.
4. An unsupported/raw resource or incompatible target has a meaningful refusal.
   A whole-world template never becomes an object install. Source/asset changes,
   cancellation, lost acknowledgements and world switching cannot duplicate or
   misapply a late operation. Retained operations can be inspected/recovered.
5. Actual PI renderer forms and an independent offscreen native client prove the
   product route. Focus, real mouse/keyboard input and Pointer Lock remain
   forbidden in automation. Historical input-simulation tests are not run.
6. Record actual model-call count (zero for direct use), stage timings, check and
   adoption receipts, visual scope and persistence evidence. UI fixture success
   is not a substitute for native gameplay or human acceptance.

First-session independent completion, time to a playable accepted result,
successful second edits and durable reopening/sharing are the evaluation
measures. Suggested speed goals are measurement targets, not automatic timeouts.
No extra token, inference-count or whole-turn cap is added to real-player Agent
evaluation, and no user request is reduced to make a test pass.

## Delivery boundaries

The first implementation delivers the direct-use route, existing-UI integration,
focused regression/native acceptance, refreshed current-release pointers and a
ready evaluation packet. Human participation, a clean external Windows test and
future distribution services remain explicitly unverified until actually run.
No remote messages, automatic model calls, repository setting changes or new
GitHub publication are implied by preparing those materials.

Preserve the accepted Windows payload and approved worlds. Development caches
stay inside their owner worktree. Dependency links must be detached before any
later cleanup; no recursive operation may follow them into another checkout.
