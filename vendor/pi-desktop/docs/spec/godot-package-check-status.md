# Pending source package checks

The native package service accepts `package.request` with method `sourceJob`
and only `{worldId,jobId}`. It validates the selected world before and after the
private `godotBuild.read`, accepts only a `gjob-` SHA256 identity, and projects
only worldId, jobId, status and terminal. No source, file path, token or raw job
output crosses this route.

The package panel disables new and repeated imports while its actual job is
pending. Passed, failed, cancelled and interrupted are terminal. Blocked jobs
may be queued again, so blocked or failed queries stop polling and offer a
manual status retry without repeating installation. Closing the panel clears
timers and invalidates late replies; reopening the same world resumes its known
pending query. Switching worlds clears the previous import grant and job.

Acceptance: `tests/godot-final-install-assets/package-native.test.mjs` exercises
identity and projection; `package-ui-pending.test.mjs` covers terminal, blocked,
query failure and unmount races. `package-ui-headless.mjs` verifies the actual
DOM without input simulation in a private headless browser. These fixtures are
separate from the complete-client source import/check/apply/restart scenario.
