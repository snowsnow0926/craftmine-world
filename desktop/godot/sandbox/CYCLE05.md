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

Read-only BFE and mpssvc queries reported Running. `Get-NetFirewallProfile` was
denied access, so firewall profile state is unknown. Two read-only loopback
exemption entries did not match either fresh task SID. This excludes those exact
exemptions as the explanation; it does not prove the complete host network policy.

## Remaining gates

No new real Godot import/export was reached through the strict full acceptance
gate during these runs. Historical pinned Godot success is not current proof of
network isolation. The LPAC registry candidate requires its final fixed native
measurement; plain LPAC's Winsock failure is not a usable solution.

The A/B execution adapter must continue to reject missing, unknown or timeout
network evidence. No public launch token, application API, core/TypeScript or
world-base code was changed. A verified per-task network boundary still needs
explicit authorization denial or appropriately correlated existing WFP evidence,
then a fresh pinned headless import/export. Do not enable machine-wide auditing
or add global policy automatically. Disk/CPU quotas, hostile reparse races and
authenticated log transport remain outside this cycle.

## Primary sources

- [Microsoft AppContainer and LPAC construction](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer): LPAC requires explicit resource capabilities, including `registryRead`; construction adds `ALL_APPLICATION_PACKAGES_POLICY` opt-out.
- [Microsoft loopback configuration query](https://learn.microsoft.com/en-us/windows/win32/api/networkisolation/nf-networkisolation-networkisolationgetappcontainerconfig): read-only exact package exemptions and ownership/freeing contract.
- [Microsoft connect completion semantics](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-connect): nonblocking completion needs its success/failure event result.
- [Microsoft firewall filter origin](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/filter-origin-documentation): AppContainer loopback drop filters exist; no universal allow claim follows from this host's ambiguous observation.
- [Godot StreamPeerTCP](https://docs.godotengine.org/en/4.7/classes/class_streampeertcp.html): connection status and errors require observation; a timeout is not an authorization decision.
