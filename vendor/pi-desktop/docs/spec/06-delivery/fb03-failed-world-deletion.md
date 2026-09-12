# FB03-005 failed-world deletion

The left and secondary world lists use the same host-backed controller. A
failed row exposes Delete only when the host advertises the capability.
Recently deleted lists archived rows with Restore. Both actions show real host
errors and refresh normal and archived lists from Rust; there is no local world
database or optimistic DOM-only removal.

Deletion is reversible and retains files. Current-world deletion completes its
normal departure before archiving. Unfinished initialization, active model
work, current candidate transactions and profile restore block deletion.
Progress revision and build conflicts reject the archive without changing the
saved world. A completed historical session does not disable the Delete button.

Restore only returns a row to the normal list. Its initialization failure and
history remain intact. Further initialization uses the existing explicit retry
flow. Archived identities reject direct opens, progress writes, new authoring
turns, candidate preparation and executor claims. Read-only history remains
available to the host, and archive state survives portable backup and restore.

## Targeted validation

- Rust `world_archive` cases: idle failed-world admission, lease and CAS refusal,
  unknown-field refusal, idempotence, complete world/Git/job/session retention,
  restart, restore, and portable backup restoration of an archived source.
- `craftmine-world-removal.test.mjs`: current and unselected worlds, no remaining
  available world, failed departure, active-work refusal, explicit restoration,
  strict navigation schema and lost-reply reconciliation.
- `tests/fb03-world-removal-headless.mjs`: actual WorldListPanel and React hook,
  main navigation gate, deletion service, private JavaScript router and real
  Rust process. Delete, busy refusal, Recently deleted, Restore, core restart,
  current-world departure and original world/Git retention are checked through
  actual button callbacks. Navigation is a finite callback fixture; this does
  not claim native engine validation.

All tests use independent data directories, do not modify a player profile,
and send no physical mouse or keyboard input, focus or Pointer Lock requests.
