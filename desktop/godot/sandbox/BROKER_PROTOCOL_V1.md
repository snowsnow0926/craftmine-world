# Private Windows Godot broker protocol, version 1

The host launches its pinned `godot-host-broker.exe run` with private redirected
stdin/stdout/stderr and CREATE_NO_WINDOW. No page or model chooses this executable.
There is no shell command, argument, capability, environment, trusted flag or
caller-supplied receipt in the request. Unknown request fields are rejected.

Write one compact JSON line to stdin and flush; keep stdin open. EOF or any
subsequent input cancels. The documented cancellation frame is `{"cancel":true}`.
The final response is one JSON line on stdout. Diagnostic text uses stderr and
task log files. After the response the broker exits; stdin can then be closed.

Request fields, all required except projectRoot:

| Field | Type / meaning |
| --- | --- |
| schemaVersion | integer 1 |
| requestId, taskId | validated ASCII task identifiers; taskId must be fresh |
| operation | exactly `version`, `import`, or `exportWeb` |
| projectRoot | absolute ordinary source directory for import/export; omitted/null for version |
| tasksRoot | absolute existing ordinary parent for exclusively created task directory |
| engineRoot | absolute cached engine directory; executable/templates still checked against compiled fixed hashes |
| sourceBinding | `{worldId:string,buildId:string,sourceRevision:u64,sourceDigest:lowercaseSha256}` |
| inputHash | lowercase SHA-256 correlation hash, echoed unchanged |

The binding is correlation data, not authorization. The core compares it to its
pending BuildJob and never accepts a caller's `sourceDigest` as measured input.

The full execution response has these stable fields:

| Field | Type / meaning |
| --- | --- |
| schemaVersion, requestId, taskId, operation, sourceBinding, inputHash | exactly echoed request identity |
| sourceSnapshotDigest | SHA-256 of compact UTF-8 JSON array of actual copied input file records, sorted by path |
| sourceFiles | sorted `[{path,bytes,sha256}]`; field order path,bytes,sha256 in the digest; `/` separators, paths relative to projectRoot |
| state | lowercase `succeeded`, `failed`, or `cancelled` |
| exitCode | actual Godot u32 exit code, or null if it did not start |
| policyVersion | exactly `craftmine.windows.lpac-registry.v1` |
| processVerification | actual Godot host-read object, or null on failure; includes `verified:true` only after checks and successful resume |
| networkPreflight | per-task native result, or null on failure; includes `verified:true` only after all required denials and positive controls |
| artifacts | `[{path,bytes,sha256}]`; paths relative to artifactsRoot, e.g. `index.html`, with **no** `web/` prefix |
| artifactsRoot | parent-owned handoff directory; core copies files into its own `web/` directory and rehashes |
| logsRoot | parent-owned task log directory |
| logs | `[{path,bytes,sha256}]`, path relative to logsRoot; normally `preflight.json` and `task.log` |
| cleanup | `{verified,profileHresult,workRemoved,error}` |
| recoveryJournal | `{path,policyVersion,cleared,error}`; `cleared:true` only after the final response retired the entry |
| resourceEnforcement | sampled `work`/log budget result, or null when no Godot child ran |
| error | diagnostic string or null |
| brokerSha256 | digest measured from the broker executable, to compare with the host's own pin |

Process verification fields: `verified`, `policyVersion`, `pid`,
`creationTimeFiletime` (decimal string of Windows FILETIME u64, not Unix time;
serialized as a string to preserve precision across JavaScript), `imagePath`,
`appContainerSid`, `capabilitySids`, `integrityRid`, `isAppContainer`,
`lpacQueryValue`, `lpacQueryError`, `lpacCreationAttribute`,
`jobMembershipVerified`, `jobLimitFlags`, `activeProcessLimit`,
`processMemoryBytes`, `verifiedBeforeResume`, `resumePreviousCount`.
`lpacQueryError:87` is preserved as unsupported, not rewritten into a successful
query. The versioned construction policy, exact host token checks and matching
native policy evidence are the contract's independent evidence.

Network preflight fields: `verified`, `policyVersion`, `hostPositiveControls`
(`tcp4Echo,tcp6Echo,udp4Echo,udp6Echo`), `hostReceivedCounts` (four zeros),
`exactTaskExempt:false`, `processVerification` (native process), and `observation`:
`{winsockStartup:0,checks:[{name,ok:false,rawOsError:10013,errorKind:"PermissionDenied"}]}`.
Ordered check names are `tcp4,tcp6,tcpExternal,udp4,udp6,udpExternal`.

Malformed/preparation failures may return only `{schemaVersion:1,state:"failed",error}`
and exit nonzero. They are never accepted as execution receipts. The final
execution response can also be failed while the CLI transport exits normally;
the core must inspect state and all required evidence, not process exit alone.

Godot stdout and game-authored files remain untrusted diagnostics, even when
their digest is recorded. No network proof is derived from a script's generic
error or text. The native preflight is the same pinned broker executable copied
to the task bin; it runs before any project code and is host-verified suspended.

Every task repeats token and TCP/UDP checks. A version response does not certify
later imports/exports. Strongly terminating the broker closes the only task Job
handles and triggers KILL_ON_JOB_CLOSE; cancellation/EOF cooperatively terminate
and wait for the Job before cleanup. The core must also kill its broker process
on a transport timeout and verify the reported task PID no longer runs.

Before resuming each child the host exclusively creates and syncs an identity
sidecar (`process-verification.json` for Godot, `native-verification.json` for
preflight). These crash-diagnostic files have `resumePreviousCount:0`; only the
private final response records successful resume with count 1. They cannot
replace a final execution receipt. Strong broker termination kills the Job but
does not guarantee profile/work cleanup, because language-level destructors do
not run. A later host-owned recovery journal remains necessary for that case.

The host materializes a trusted Web export preset/shell before the call. The
snapshot digest includes these actual inputs. No native templates are copied,
and the broker supplies only the fixed `--headless --path ... --import` or
`--export-release Web .../index.html` argument set.

## Recovery journal (v1)

The broker writes one parent-owned journal entry per task to
`<tasksRoot>/.recovery-journal/<taskId>.json` and flushes it *before* any
restricted process starts. The task root also carries a parent-owned
`task-identity.json` with a random nonce; neither location is inside a directory
granted to the task SID, so the restricted child cannot forge or delete them.

| Journal field | Meaning |
| --- | --- |
| schemaVersion, policyVersion | `1` / `craftmine.windows.recovery-journal.v1` |
| taskId, requestId, operation | identity of the task being reclaimed |
| tasksRoot, taskRoot | absolute paths the entry is allowed to reclaim |
| profileName, profileSid | AppContainer profile and the SID measured at creation |
| identityNonce | must equal the nonce in the task's identity marker |
| startedAtUnixMs, state | `prepared` until the final response retires the entry |

`godot-host-broker.exe recover <absolute tasksRoot> [--json-out <path>]` is the
host-owned pass for a broker that died without a final response. It reclaims a
task only when all of the following hold, and otherwise reports the task under
`skipped` without deleting anything:

1. the entry's `tasksRoot` canonicalises to the root passed on the command line;
2. the recorded task root is exactly `tasksRoot/<taskId>`, has no reparse
   component, and canonicalises to the same directory;
3. `task-identity.json` matches both the task id and the journal nonce;
4. a surviving process is only terminated when the PID *and* the creation
   FILETIME match the host-written pre-resume sidecar and its image sits in the
   task's own `bin`; a reused PID is reported as `pid-reused` and left alone;
5. the profile SID re-derived from the recorded name equals the recorded SID
   before `DeleteAppContainerProfile` is called.

The report echoes `finalReceiptObserved:false` for every entry: a recovery pass
is by definition a run without a final broker response and never asserts
`cleanup.verified`. Directory removal is retried a bounded number of times
because a just-terminated child can still be releasing handles.

## Runtime resource budget (v1)

Every task samples its own writable `work` directory and its inherited log file
while the child runs. The defaults are 1 GiB of work bytes, 4 MiB of log bytes
and a 200 ms sampling interval. A breach terminates the whole job and the task
ends `failed` with `resourceEnforcement.enforced:true`, the reason string and
the maximum observed counters.

`resourceEnforcement.scope` and `hardFilesystemQuota:false` are part of the
contract: this is a sampled budget enforced by an external parent, not a
per-directory filesystem quota. A task can overshoot by up to one sampling
interval plus one write burst; the measured overshoot in the fixed inflation
case is about 1.4 MiB. Hosts that need a hard quota must supply a volume-level
mechanism outside this crate. Project materialisation is separately bounded to
4096 files, 256 MiB per file and 512 MiB total before any process starts.
