# Validate the actual broker log set before bounded import recovery

The production broker declares `preflight.json` and `task.log`. The recovery
guard incorrectly required one declared file, while its scripted test broker
created two files but declared only the engine log. Actual native import
failures therefore never reached the existing one-retry decision.

Accept exactly the two current declared log names and verify each file's type,
size and full SHA256. Bound native JSON to 4096 bytes and compare its complete
six denied checks to the already-verified broker receipt. Preserve every
existing process, network, pin, source, cleanup, journal and budget gate. Do not
increase retry counts or permit export replay. Identity sidecars remain outside
the declared-log set.

The protocol fixture now declares both logs. Its positive recovery case uses
the actual 4097-byte side-view import log, SHA256
`a6fd727c7e52d069d76b57208e07faea3d84389dc449c2e497ee1316dfb95dbc`.
Negative cases cover changed/missing/duplicate/unknown logs, native observation
mismatch, malformed native facts, a directory, script errors and a second crash.
The file symlink case is explicitly skipped when the host cannot create one.

Ordinary source A/B runs used the unchanged sealed b6 broker in
`D:/cm-sideview-ab-0910-shoijP`: original and self-factory-modified inputs both
imported/exported with exit zero, four calls total. That comparison did not
distinguish the native fault, so the speculative source modification was not
adopted. This change repairs recovery admission; it does not claim to fix the
pinned engine's access violation.

Validation: 31 protocol tests pass, zero fail, one file-symlink capability skip.
The captured log is genuine engine output; simulated crash responses remain
protocol fixtures, not new native crash/recovery evidence.
