# P8 second authorization phase: not accepted

The user explicitly removed the request count limit; the previous token-total
limit had already been removed. The original 16-admission journal remains byte
identical. A new independent journal records 34 admitted requests, all HTTP 200:
50 historical plus current admissions in total. No model fallback occurred.
Requested deepseek-v4.1-flash-expires-on-0910 and reported deepseek-flash remain
separate identities. Hammer produced no source patch/candidate; dog made zero
requests. This report does not call the task completed.

Raw run: D:/cm-fb4-20260910/test-results/desktop-native-p8-t6g5Us.
New journal: D:/cm-fb-p8-20260910/test-results/p8-phase2-unlimited-20260910/p8-phase2-admissions.ndjson.
Old journal: D:/cm-fb2-20260910/test-results/p8-authorized-20260910.ndjson.

Provider usage sum: 1093206 tokens; prompt 939310 (cache 426496 included),
completion 153896 (reasoning 94780 included). No verified billing receipt exists;
monetary fees are unknown. The last local metric snapshot was still running and
must not be relabeled a finalized complete task metric.

Request 29 ended length with 16384 completion and 16384 reasoning tokens, no
text/tool calls. Actual wire omitted thinking despite off-only configuration.
Summary request 26 ended length at its 13107 output limit. The task repeatedly
read old source/check information after compaction. Read-file metadata itself
was now correctly preserved, so this was not the earlier empty-readFiles defect.

The parent requested immediate stop. The existing driver had no external IPC
abort control while waiting; only its own failure path could invoke abort.
The exact owned packaged child PID/parent/executable was checked and terminated.
Exit 4294967295 is an explicit strict shutdown failure, not waived. The driver
exited 1 and closed its relay/journal; no owned direct children remained. The
next runner must support an explicit bounded abort request before another run.

An earlier phase2 startup attempt YJsNKX consumed zero requests. A narrow
external-driver correction recognizes the existing Error prefix for runtime
startup and no longer starts dog after pre-binding failure. Both reports remain.
Frozen b6 package/source were never changed by this subtask.

Repair evidence: 12 actual SDK/PI/runtime controlled checks passed, zero external
requests/configuration reads; runtime strict TypeScript passed; 46 provider,
reasoning and compaction regressions passed (109 unrelated tests skipped by
explicit name filter). These are offline checks, not successful model creation.
SDK tests preserve exact model/endpoint and validate disabled thinking despite
off-only metadata. Actual runtime checkpoint construction rejects length/tool
results; original transcript preparation remains unchanged. Concise summary
focus is verified in the actual PI request. New sealed/native creation pending.
