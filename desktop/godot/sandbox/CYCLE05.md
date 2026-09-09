# Cycle 5 isolation investigation

The product execution gate remains closed. The principal finding is an evidence
classification bug, not proof that AppContainer loopback access is allowed.

## Finding and correction

The old probe logged `result.err().and_then(io::Error::raw_os_error)` and treated
`None` as connection success. `None` also represents an error with no raw Windows
error code, including a Rust-created connection timeout. The output now includes
`ok`, `ErrorKind`, raw OS error, and the complete error text. Regression coverage
separates a synthetic timeout with no raw OS code from a successful result.

The old README claim that a capability-free AppContainer permits loopback has
been retracted. A listener binding successfully establishes no cross-container
data channel. Neither silence at the host nor a timeout establishes policy denial.

## Changes

- `network-diag` is a fixed, no-argument diagnostic. It creates unique profiles,
  compares ordinary AppContainer, LPAC, and one final LPAC `registryRead`
  candidate. The latter grants no network capability. No product task uses LPAC.
- Each variant preserves the creation-time Job (one process, kill on close),
  private noninteractive desktop, scoped new directory DACLs, explicit inherited
  handle list, minimal environment and bounded wait. No global firewall, audit,
  loopback exemption, existing desktop ACL or input state is modified.
- Read-only `NetworkIsolationGetAppContainerConfig` matches the exact task SID;
  it does not log other applications' identities or modify exemption state.
- Native IPv4/IPv6 probes use host-owned ephemeral endpoints and concurrent
  fixed-byte echo servers. The host proves complete `CMGD5NET` round trips before
  each comparison. Client/server counts are independent observations.
- Direct `WSAEventSelect` / `WSAEnumNetworkEvents` captures the `FD_CONNECT` error,
  with a two-second wait distinct from the Rust timeout wrapper. Generic errors,
  unsupported queries and timeouts remain unknown. Winsock startup failures are
  recorded normally instead of triggering the Rust startup panic.
- The Godot editor fixture no longer labels generic socket errors or timeouts
  as denied. It recognizes only explicit `ERR_UNAUTHORIZED`; other statuses
  remain unknown. The native full acceptance gate requires explicit connection
  denial before proceeding to the pinned Godot fixture. Binding alone is not a gate.
- A pre-set cancellation flag prevents process creation. A failed profile
  deletion remains eligible for retry. `WAIT_FAILED` is returned as an error,
  never converted to a timeout.

## Observed validation before the final fixed comparison

Base: `2f84da9`; branch `codex/godot-cycle05-sandbox`, independent worktree
`D:/cm-gd5-sandbox`. Offline build of all four executables passed. Tests passed:
11 library tests and 2 native probe classification tests; no ignored tests.

The subagent's restricted runner could not create its worktree ref, write a
default target directory, or create AppContainer profiles (`0x80070005`). Root
created the worktree and executed the fixed diagnostic in its ordinary runner.
No elevation, permission change or alternative profile reuse was attempted.
Build output was placed in the separately owned primary test-results directory.

Root's real native runs retained under
`D:/Craftmine World/test-results/godot-cycle05-sandbox-network/`:

| Run directory suffix | Result |
| --- | --- |
| `craftmine.gd5.net.241144.1788965993869` | AppContainer token true; LPAC information query returned 87 before networking. Both task SIDs not exempt; cleanup 0. |
| `craftmine.gd5.net.251388.1788966135308` | Ordinary AppContainer had zero capabilities and raw error `None`; this is ambiguous, not success. LPAC Winsock startup panicked with 10107. |
| `craftmine.gd5.net.256756.1788966279844` | Blocking connect reached the 15-second Job limit; exit 92 and zero job members. This is unknown, not denied. LPAC again failed Winsock startup. |
| `craftmine.gd5.net.226688.1788966558157` | Both host echo positive controls passed. Ordinary AppContainer's IPv4/IPv6 `FD_CONNECT` waits timed out; no host accept/echo. Raw Rust connection error was `None`, but no `Ok` echo branch ran. Non-loopback TEST-NET connect returned 10013. LPAC startup returned 10107 normally. Both cleanup HRESULTs 0. |
| `craftmine.gd5.net.208848.1788966935728` | Final comparison confirms ordinary AppContainer returned `ok=false,kind=Some(TimedOut),os_error=None,detail=Some("connection timed out")`. LPAC without capabilities failed WSAStartup 10107. LPAC plus only `registryRead` initialized Winsock and returned explicit `PermissionDenied` / 10013 for IPv4, IPv6 and TEST-NET connections. Host echo positive controls passed; restricted host accepts/echoes stayed zero. All profile cleanups 0. |

The complete final host transcript is retained by root at
`D:/cm-gd5-core/docs/evidence/godot-cycle-05/network-final.log`, with the raw
per-variant child logs in the last directory above. In the final LPAC registry
variant, socket creation itself was denied with 10013, explaining why no
`FD_CONNECT` event was needed. The independently recorded Rust result also
returned an explicit permission error. The variant's token was AppContainer,
had exactly one capability, and had no matching loopback exemption. The optional
LPAC token query remained unsupported (87); the creation attribute and measured
resource restrictions are recorded without turning that query into success.

This is new positive native policy evidence and justifies a separate fixed Godot
compatibility run. The ordinary AppContainer result remains unknown rather than
allowed or policy-denied. These are different conclusions and must not be merged.

Read-only BFE and mpssvc queries reported Running. `Get-NetFirewallProfile` was
denied access, so firewall profile state is unknown. Two read-only loopback
exemption entries did not match either fresh task SID. This excludes those exact
exemptions as the explanation; it does not prove the complete host network policy.

## Remaining gates

The final native LPAC registry candidate passed the explicit network checks.
A fixed Godot follow-up was run as
`craftmine-godot-sandbox-probe.exe --lpac-registry`: native boundary checks first,
then the pinned engine's version, headless import and Web export. It accepts no
arbitrary project or command. Generic Godot API errors remain unknown; after a
passing native gate, the trusted fixture may still be exported to collect
compatibility evidence, but unknown editor-time evidence makes the final gate
exit unsuccessfully. Plain LPAC's Winsock failure is not a usable solution.

The real follow-up finished in approximately 9.5 seconds. The native full
boundary passed; pinned Godot `4.7.2.stable.official.ed1daf0bf` version, headless
import and Web export all exited 0. Export produced 9 parent-hashed artifacts,
including `index.wasm` (39,514,754 bytes, SHA-256
`fc74679e3b97f76878947fcd4fbe1268cbfa6188182a2e33bbc3f5dc9bfa57d0`).
Private desktop cleanup and profile cleanup succeeded. This establishes fixed
runtime compatibility with the native candidate, not full product acceptance.

Both editor plugin and `@tool` resource ran. Their synthetic cross-directory
file operations and child spawn were denied, while their network APIs returned
`unknown(error=1)`. The engine emitted socket creation and child-process failure
messages. Thus `editor_time_boundary_verified=false` and the overall gate exited
1, as designed. No executor was enabled and no unknown result was rewritten.

Raw fixture/output directory:
`D:/cm-gd5-sandbox/desktop/godot/sandbox/out/craftmine.gd0.gate.255464.1788967116412`.
Root retained the full host transcript at
`D:/cm-gd5-core/docs/evidence/godot-cycle-05/godot-lpac.log`.

The A/B execution adapter must continue to reject missing, unknown or timeout
network evidence. No public launch token, application API, core/TypeScript or
world-base code was changed. A verified per-task network boundary still needs
explicit authorization denial or appropriately correlated existing WFP evidence,
then a fresh pinned headless import/export. Do not enable machine-wide auditing
or add global policy automatically. Disk/CPU quotas, hostile reparse races and
authenticated log transport remain outside this cycle.

## Proposed next-cycle evidence contract (not implemented or enabled)

Requiring GDScript to expose raw WSA 10013 is not an appropriate permanent gate.
The pinned Godot source's `NetSocketWinSock::open` returns the generic Godot
`FAILED` value when `socket()` fails, before the error mapping used by other
operations. Therefore `error=1` is expected to lose the Windows detail. It is
compatible with the native observation but cannot independently prove it.

The next cycle should make the host responsible for the OS evidence:

1. Use one immutable, versioned policy recipe for the native preflight and
   pinned Godot process: AppContainer SID, LPAC opt-out, the exact derived
   `registryRead` SID only, Job limits, desktop, directory grants, inherited
   handles and environment. Bind a host-created receipt to their hashes, task
   ID, fresh profile SID, PID and process creation time.
2. Create Godot suspended inside the creation-time Job. Before resuming, query
   the actual process token for AppContainer identity, exact package SID,
   capability SID set and integrity; query the actual Job limits and membership.
   A mismatch or failed required query terminates the Job before model code runs.
   Preserve unsupported LPAC-query 87 explicitly; do not manufacture a successful
   token result. The reviewed construction attribute and native resource-policy
   measurement must be explicit parts of the contract, subject to review.
3. The same recipe's trusted native preflight must show successful Winsock
   initialization, functioning host IPv4/IPv6 echo positive controls, explicit
   10013 permission denials, and no task SID loopback exemption. Timeouts remain
   unknown. Add UDP socket denial coverage because the current proof is TCP.
4. Treat Godot's generic socket failure as compatibility/attempt evidence only.
   Never accept game-authored JSON or stdout as token, policy or authorization
   evidence. Keep API observations separate from host-verified OS restrictions.
5. Preserve per-launch terminal status, cancellation/Job cleanup, pinned inputs
   and parent-verified artifact hashes. A receipt must be minted by the broker,
   bound to the exact build/source revision, and unavailable to page callers.
6. Only after these host checks and the existing B/C integration gates pass
   should a future change reconsider the editor raw-error requirement. This
   cycle deliberately leaves the existing final gate unsuccessful.

## Primary sources

- [Microsoft AppContainer and LPAC construction](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer): LPAC requires explicit resource capabilities, including `registryRead`; construction adds `ALL_APPLICATION_PACKAGES_POLICY` opt-out.
- [Microsoft loopback configuration query](https://learn.microsoft.com/en-us/windows/win32/api/networkisolation/nf-networkisolation-networkisolationgetappcontainerconfig): read-only exact package exemptions and ownership/freeing contract.
- [Microsoft connect completion semantics](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-connect): nonblocking completion needs its success/failure event result.
- [Microsoft firewall filter origin](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/filter-origin-documentation): AppContainer loopback drop filters exist; no universal allow claim follows from this host's ambiguous observation.
- [Godot StreamPeerTCP](https://docs.godotengine.org/en/4.7/classes/class_streampeertcp.html): connection status and errors require observation; a timeout is not an authorization decision.
- [Pinned Godot Windows socket implementation](https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/drivers/windows/net_socket_winsock.cpp): `open` converts failed socket creation into generic `FAILED`.
- [Microsoft CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw) and [GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation): process creation and host token inspection foundations for the proposed receipt.
