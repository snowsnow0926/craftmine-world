# Craftmine host turn scope

The Electron orchestrator binds a world-creation turn to a host session, durable
turn, project and selected world before dispatch. The sidecar cannot supply those
domain identities in a context or budget request. The private request allowlist
does not expose arbitrary core RPCs. A response arriving after turn replacement
or cancellation cannot be used as current context.

For bound turns, host tool dispatch permits only exact registered Craftmine tool
names. Generic file, shell, browser, other-plugin and MCP tools cannot bypass the
Rust world transaction boundary. Ordinary PI sessions outside a world turn keep
their existing tool policy. This is a host tool gate, not an OS plugin sandbox.

E2E scenarios: create a bound turn, attempt Write/Bash/other-plugin dispatch and
observe refusal before execution; change the visible world during a request and
observe the original binding; stop/replace a turn during context retrieval and
reject its late response. Logic coverage lives in `tests/dispatch/g/gateway.test.mjs`.
Actual native integration evidence must separately identify its source version.

The built-in plugin accepts a private parent lifecycle request, separate from
panel invocation. It reads Rust task context and validates full binding and
generation claims for each budget reservation. The host initializes a 30-minute
deadline once, alongside the durable request/token/compaction limits. Later
requests, review and compaction share those limits. An exact existing request may
settle after cancellation; it cannot start another request or apply late output.
The latest actual host user message is recorded as a correction when its durable
message ID changes. Reusing an ID with different text is rejected.

`tests/dispatch/g/host-domain.test.mjs` exercises the real Rust process with an
independent marked data directory. It covers current requirements, subsequent
corrections, world selection isolation, forged identity/limit refusal and exact
settlement after stopping. Native PI request dispatch remains a separate gate.
