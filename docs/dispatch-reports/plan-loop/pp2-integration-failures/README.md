# Integrated client failures retained

`desktop-native-parameters-oUpnWZ` ran the actual compiled development client
and source/runtime commit `c38d8e46257411c4e74ede68ce29dbfe1ae8f8a7`, with
locally rebuilt core and host binaries identified in the raw report.

The first two checks passed: world creation and the real baseline broker/runtime
check. The third check failed because the finite headless guide probe omitted
the existing `showSurface` request's `surface` envelope. Commit `d413b68` corrects
that probe; the unchanged production navigation rejected the malformed request.
This run provides no acceptance evidence for the remaining parameter workflow.

The client exited with code 0 and no recorded input or page violations, but its
actual lifecycle log contains `PLUGIN_SHUTDOWN_INCOMPLETE` for all three plugin
UtilityProcesses. Therefore it does **not** establish successful resource cleanup.
The earlier exit audit did not include service shutdown failures. Follow-up work
must both expose those failures to native acceptance and correctly close owned
resources; an exit code of 0 cannot substitute for either requirement.

The three raw files are byte-preserving copies of the report, stderr and lifecycle
log. No private profile, credentials or user data is included.
