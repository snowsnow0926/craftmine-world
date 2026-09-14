# Author-owned source installation and adoption status

`godot_source_library` supports explicit `install` and `install-group` modes for
an active Godot author turn with a current host-captured `full-auto` authorization.
The host identity, selected world, effective permission and cancellation fence
are checked before installation and before each mutation. The model cannot supply
an execution context, filesystem path, asset bytes or permission flag.

The existing managed installer validates immutable catalog and archive identities,
source requirements, scene insertion, asset locks and source CAS. It writes through
the existing author task and starts a check owned by that task. It does not create
a parallel player-install lease or end the author turn. The existing completion
queue alone may adopt the checked candidate after the author turn finishes.
Returned job IDs and instance IDs describe actual source installation, not visual
or adoption proof. Read `godot_build_read` for the check and application outcome.

`propose` and `propose-group` remain non-installing suggestions. Read-only and
discussion turns cannot install. A revoked permission, world switch, foreign
context, superseded request or stopped turn refuses further mutations. Failed
source work remains recoverable; the UI cannot retry an author operation as a new
manual installation. Replaying one author tool call keeps the same frozen operation,
source identity and check, including an uncertain response after source writing.

The public `package.request/sourceJob` receipt retains its existing check status
and adds optional `application`: `ready`, `applied`, `historical` or `unknown`.
Main rereads the exact Core candidate and checks world, job, build, revision,
manifest and output hash. Only matching Core adoption evidence can produce
`applied`; a passed check or model completion message is insufficient. Failed
checks remain failed, including historical failures.

The existing conversation's asset reuse card refreshes outstanding passed jobs
until adoption becomes known. It shows “Added to world” only for verified adoption,
and historical results separately. It no longer requires the player to refresh
manually after application, or presents an applied candidate as still awaiting
application. This does not prove placement quality or gameplay interactions.
