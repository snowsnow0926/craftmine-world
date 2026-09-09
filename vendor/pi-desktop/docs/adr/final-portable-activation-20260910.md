# Activate restored profiles through a verified relative pointer

The portable archive already carries source blobs and Git objects, but the
desktop backup service only called the older domain JSON API. Restoring files
without switching the process would also leave users in the original profile.

Use one private CoreClient transition and a controlled sibling restore
directory. Retain original and restored directories. Publish an activation
pointer only after the new core proves the archive's committed restore mark.
On restart, verify that mark again. A generic database fingerprint is not a
restore identity: task recovery and the restore mark itself change it.

The native runtime/task lifecycle must quiesce before switching and rebind
afterward. This service does not fabricate that integration or replay models.
Failure rollback is explicit, and unknown/failed rollback keeps the UI frozen
until host recovery resolves the current profile. No broad filesystem grant,
arbitrary path, new account, visible window or input simulation is introduced.
