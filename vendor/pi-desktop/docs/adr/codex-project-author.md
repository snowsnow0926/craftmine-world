# Opt-in Codex project author

Date: 2026-09-13

## Decision

Add a project-owned Node CLI, `scripts/codex-world-author.mjs`, using the actual
local Codex app-server over private stdio. It does not replace the PI runtime,
provider adapters, account settings, desktop composer, or Rust data ownership.
An OpenAI account selected in PI is not this entry.

Use app-server dynamic tools instead of `codex exec` plus a separately listening
MCP server. Dynamic calls arrive at the trusted host with a thread/turn identity;
the host can bind existing Craftmine tool definitions to one native session,
fence cancellation, and retain Codex's own rollout history. The `craftmine`
namespace is explicitly direct-only so Codex does not wrap these calls in its
code-mode executor. No unrestricted shell or repository coding agent is exposed.

The installed `0.154.0-alpha.6.2` app-server schema is the implementation contract.
The CLI rejects other versions pending a deliberate compatibility review. Model
and reasoning effort are exactly `gpt-6-astra` and `xhigh`; initial fallback is
disabled, returned settings are checked, and rerouting ends the turn. No added
model-request, token, or whole-turn duration budget is introduced.

## Ownership and safety

Codex reads its own existing ChatGPT login. The adapter never reads or copies an
authentication file, requests access tokens, or prints account/config responses.
The subprocess inherits only OS/profile variables needed by Codex. Its working
directory is an empty directory, with environment access disabled on both initial
thread and every turn. Built-in shell, patch, image-file reads, browser, computer,
plugins, apps, hooks, memories and delegation features are disabled. Inherited
MCP entries are individually disabled before a thread starts; unsupported names
or custom provider endpoints fail closed. Raw stderr is discarded. Domain events
are projected and redacted, not a raw protocol transcript.

The CLI's session metadata and event journal are integration state, not a second
world store. Rust owns world/source revisions, requests, task recovery, receipts,
leases, build jobs and application state. The plugin is built from the current
checkout; native tools are read from an explicitly selected runtime directory.
Model arguments never choose those paths or identities. The advertised catalog
excludes cross-world proposals, legacy verification and model-selected recovery.

Cancellation marks the local invocation inactive synchronously, persists
`workspace.endTurn`, interrupts Codex, and drains active domain work. Queued and
late dynamic requests are refused. Failure to persist the fence is an error and
retains the recovery record; it cannot be reported as successful cancellation.
Recovery opens a fresh host turn with native `task.resume`, retaining the same
world/session/source and recorded requests. PI provider-window renewal is not
used because Codex owns its model requests.

## Reached surface and consequences

This is an opt-in project CLI, not a desktop player UI. The default entry can
author source, generate Blender assets, and submit native Godot builds. It has
no live player target, headless check verifier, preview host or automatic
adoption. A trusted caller may supply the existing verifier/tool-service
contracts; authored scripts cannot configure them. Source import, build, check,
candidate readiness and actual application stay distinct. The coordinator must
still run visual and playable acceptance through the ordinary native boundaries.

An empty Codex thread has no durable rollout until a turn is submitted. `doctor`
therefore uses an ephemeral thread and cannot leave an unusable continuation ID.
After a submitted turn, missing history fails visibly; the entry does not silently
start a replacement conversation. Tool-catalog changes similarly require an
explicit compatibility decision instead of reinterpreting stored history.

References: [spec](../spec/codex-project-author.md),
[official app-server documentation](https://learn.chatgpt.com/docs/app-server),
[official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).
