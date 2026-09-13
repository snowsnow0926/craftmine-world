# Guided discovery without unverified installation

The previous PATH-only first-hit lookup missed existing Desktop/npm native
executables and let an incompatible executable mask a compatible one.
Enumerate bounded known locations and check exact versions, showing candidates
in the existing settings row. Do not scan arbitrary drives or execute wrappers.

Keep separate detection, account verification and save transitions. A version
match is not account/model authorization. Cancellation generations invalidate
late results. Official installer guidance is user-initiated; a public pin for the
required development build has not been established, so automatic downloading
would fabricate supply-chain and compatibility confidence.
