# Packaged client path-failure acceptance

The fixed runner `tests/plan-loop/task-path-client-native.mjs` accepts only an
explicit packaged directory, expected 40-character source commit, expected
build-manifest SHA256, ASAR-tool dependency directory and output parent named
`test-results`. It verifies packaged Main, core, host, plugins, source archive and
runtime against those identities before launch and again across restarts. No
development executable/runtime fallback is supported. Older packages lacking
the reviewed finite path-error mapping must not be used as evidence.

It creates a fresh dedicated `desktop-native-task-paths-*` directory and pads
only its private profile to produce a 266 UTF-16 unit cache path for the fixed
generated task-id shape. Through existing finite product navigation it creates
one first-person blank world, waits for a failed world-list row, and requires
GODOT_TASK_PATH_TOO_LONG, the concise Chinese message and identical build stage
in the creation summary, error and stage list. A ready/playable result fails.

The actual import attempt must have the explicit preparation failure, no engine
exit code, no task directory/log and no retry. A version preflight is allowed and
must not be misreported as an import launch. After a strictly audited shutdown,
the same package and profile must preserve world id, creation operation, failure
code/stage and job/attempt identity. The second shutdown must also be exit zero,
not forced, with empty violations, pageErrors and shutdownFailures arrays.

Example, after the new source has actually been packaged:

```powershell
node tests/plan-loop/task-path-client-native.mjs --packaged-root C:/release/win-unpacked --expected-commit <40-hex-commit> --expected-build-manifest-sha256 <64-hex-hash> --deps-app C:/source/vendor/pi-desktop/apps/desktop --output-parent C:/cm-path-package/test-results
```

The ordinary unit tests exercise argument/identity gates, misleading UI states
and rejected-import evidence handling. They do not launch or validate a package.
At preparation time no new package has been run; actual report and both exit
audits are required before claiming this acceptance passed. No generic script,
input dispatch, focus, Pointer Lock or model requests are used.
