# Cycle 6 sandbox: trusted host evidence and private broker

Base: `3f52ce6`; branch: `codex/godot-cycle06-sandbox`. This work owns only
`desktop/godot/sandbox/**` and this report directory. It does not register the
product executor, approve a page-supplied receipt, or perform browser acceptance.

## Delivered contract

The fixed private broker supports `version`, `import`, and `exportWeb` through
one bounded JSON request on private redirected stdin. No request can supply a
shell, arbitrary arguments, capabilities, environment, engine hash override,
or trusted flag. The host must pin the broker binary and construct its request
from an actual pending build. The full schema and failure semantics are in
[`BROKER_PROTOCOL_V1.md`](../../../../desktop/godot/sandbox/BROKER_PROTOCOL_V1.md).

Policy `craftmine.windows.lpac-registry.v1` uses a fresh task AppContainer SID,
LPAC creation opt-out, exactly one enabled `registryRead` capability, Low IL,
a private noninteractive desktop, fixed inherited log/NUL handles, minimal
environment, and a creation-time unnamed Job with active-process limit 1,
4 GiB process memory limit, and kill-on-close. It does not use the incompatible
child-process restriction attribute identified by the earlier loader tests.

Both actual Godot and native preflight start suspended. Before resuming, the
host queries the actual package SID, capability set and attributes, IL, image
path, PID and creation FILETIME, exact Job membership and limits. Resume must
return previous suspend count 1. Unsupported LPAC token query 87 remains
`lpacQueryValue:null,lpacQueryError:87`; it is not called a successful query.
The host records construction policy separately from queried facts.

Every task first launches a hash-checked copy of the host broker in its fixed
native preflight mode, under the same package and creation policy. Four host
TCP/UDP IPv4/IPv6 echo controls must succeed. All six native network operations
must then return explicit `PermissionDenied`/10013, with no restricted traffic
received by host controls and no exact task loopback exemption. UDP checks are
the complete bind/send chain: a denied bind is recorded as that operation's
denial, not falsely claimed as a successful bind followed by send denial.
Timeout, refusal, missing OS codes and Winsock initialization failure cannot
pass. The preflight is consumed before project code starts.

The broker measures the actual complete copied source snapshot, including host
presets/shell/bridge. Its digest is SHA-256 of compact UTF-8 JSON sorted records
`[{path,bytes,sha256}]`, with that field order and slash paths. A changed copy
is rejected before execution. `sourceBinding` and `inputHash` are correlation
echoes; core must check them against its claim and independently compare the
measured file manifest. Artifact paths are relative to `artifactsRoot`, without
`web/`; core owns copying, rehashing, compilation-log rejection and browser gates.

Source/artifact limits are 4096 files, 256 MiB per file, 512 MiB total. Logs
handed to core are bounded to 4 MiB each. These are ingestion/handoff limits,
not an OS disk quota during execution.

## Evidence and exact interpretation

Raw request, stdout, stderr and summary files are in [`evidence`](evidence).
The archive script also copies fixed task logs and records their SHA-256 in
`evidence/archived-log-manifest.json`. The fixed synthetic fixture binding uses
a zero sourceDigest; it is deliberately not a claim from a real core build.

| Fixed test | Raw evidence prefix | Observed result |
| --- | --- | --- |
| Restricted agent runner version | `g6-version-1788969699851830200` | Profile creation denied `0x80070005`; no process receipt, failed. Preserved. |
| Host runner version | `g6-version-1788969859675809600` | Godot 4.7.2 exit 0; process and per-task network verified; cleanup verified. |
| Host runner import | `g6-import-1788969887184623700` | Exit 0, both receipts verified, cleanup verified. |
| Host runner Web export | `g6-exportweb-1788969941139009800` | Exit 0, 9 artifacts, both receipts verified, cleanup verified. |
| Immediate stdin EOF | `g6-eof-1788969989956340300` | Cancelled before preflight; no Godot receipt; cleanup verified. |

These first successful fixtures used broker SHA-256
`7363a9dce65fed7cf211765b2b7847f715e3b782075801167ba0b8e92affc849`.
The final source adds bounded source-size hashing, cleanup-preserving log error
handling, and immutable pre-resume identity sidecars. Its compiled broker SHA-256
is `c9cd349615215e291c25df61330c8356dd5bc0a79a8d555c3977a0f9b015b331`.
Further final-binary fixed cases and the actual core-claimed project are
recorded separately; the earlier runs are not silently relabelled.

Version evidence contains different actual native/Godot PIDs with the same
package SID and registryRead SID. Both show IL 4096, exact Job flags 8456,
active limit 1, memory 4294967296, verification before resume, and resume count
1. All six network checks show 10013, four positive controls completed, and
received counts are `[0,0,0,0]`.

Final unit regressions: 16 library plus 2 native tests passed, zero ignored;
all five binary targets compile offline. Complete output is saved as
`evidence/cargo-test-final.log` and `evidence/cargo-build-final.log`.

The harness also provides fixed running-child cancellation, broker hard-kill,
and malicious `@tool`/editor-plugin cases against a newly created synthetic
world sentinel. It does not enumerate or touch actual world data or user UI.
Their raw results determine acceptance; merely having a case implemented does
not establish a passing result.

## Why the policy evidence changed

Cycle 5 preserved ordinary AppContainer loopback results as unknown timeouts,
not allowed and not denied. Plain LPAC failed Winsock startup with 10107.
LPAC plus registryRead gave exact native denials and compatible Godot import
and export, while the legacy Godot script gate remained unknown at error 1.
Those failed/unknown facts remain unchanged.

The pinned Godot implementation returns generic `FAILED` when `socket()`
returns `INVALID_SOCKET`; that path does not preserve raw WSA 10013 for GDScript.
The v1 contract therefore requires host-read process policy identity and an
independent matching native preflight. It never rewrites Godot error 1 into an
OS error, trusts a game's printed denial, or skips a per-task check. Fixed
adversarial fixture logs intentionally contain errors. Ordinary model project
errors must still fail the core compiler gate even if Godot exits zero.
The archived import log also contains native editor initialization diagnostics
before any plugin runs (`get_system_dir`, `GetAdaptersAddresses`,
`get_filesystem_type`, and editor TCP-server setup). A blanket ERROR rejection
can therefore reject otherwise usable restricted imports. If the core later
classifies these, it must use a narrow pinned native diagnostic definition;
this report neither permits arbitrary errors nor certifies compilation from
an exit-zero sandbox response.

## Remaining limits

- Hard broker termination closes Job handles and kills the child tree, but
  does not run profile/work destructors. A persistent host recovery journal
  and narrowly scoped orphan recovery remain future work. Do not claim
  `cleanup.verified` after a killed broker with no final response.
- Pre-resume identity sidecars are crash diagnostics with resume count 0;
  they cannot replace the final private response. PID reuse is checked against
  exact creation time when a matching process can still be opened.
- Actual core source binding, host preset ownership, strict receipt parsing,
  rejecting compiler errors, candidate Web execution and durable application
  are the parent integration's responsibilities, not proven by fixed fixtures.
- This policy is demonstrated on the current Windows host. Unsupported token
  queries are explicit; another host must pass all per-task checks. No firewall,
  machine-global ACL, audit configuration or privilege changes were made.
- No runtime disk quota is supplied. Output caps apply at snapshot/handoff;
  timeout and process memory limits do not bound all disk consumption.

## Primary references

- [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
  and [ResumeThread](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-resumethread): suspended creation and prior suspend count.
- [GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
  and [IsProcessInJob](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob): actual host queries.
- [Implementing an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer): token capability and resource access model.
- [NetworkIsolationGetAppContainerConfig](https://learn.microsoft.com/en-us/windows/win32/api/networkisolation/nf-networkisolation-networkisolationgetappcontainerconfig): read-only exemption inspection.
- [Winsock connect](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-connect): WSA errors, including access denial.
- [Pinned Godot Windows socket implementation](https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/drivers/windows/net_socket_winsock.cpp): generic socket-creation failure.
