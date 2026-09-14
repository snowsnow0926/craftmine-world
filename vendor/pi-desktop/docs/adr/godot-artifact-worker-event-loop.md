# Run complete artifact verification on a fixed worker event loop

Status: accepted for implementation; ordinary packaged continuation pending.

The real old-profile verifier continued processing bytes but exhausted its
30-second shared startup deadline. Increasing the bounded stream from 64KiB to
1MiB reduced IO completions without resolving the observed throughput. Main-loop
load is a plausible contributor, not a proven sole cause.

Reuse the existing asset-preview architecture: a separately bundled, fixed Node
Worker entry. Move the same lstat/traversal/type/size/full-SHA routine to that
worker, preserving 1MiB reads and the same absolute deadline. The main process
keeps the existing timeout race and all later native checks. This avoids another
whole-file buffer, synchronous main IO or relaxed acceptance.

Private requests and bounded replies bind the random attempt and exact native
job/world/build/input hash. No arbitrary script, environment or entry is exposed
to the renderer or model. A result alone is insufficient: require worker exit.
Cancel/timeout terminates the worker; unconfirmed termination is explicit and
blocks additional workers in the verifier. Progress is sampled, not emitted per
file/chunk. Missing or stale progress remains visibly incomplete.

The compiled entry, including its actual dependency chunks and top-level await,
has a real Electron Node-only ASAR test. Normal Windows package loading and the
original profile's ordinary check still require integration evidence. Prior
failed jobs and generated world source remain immutable.
