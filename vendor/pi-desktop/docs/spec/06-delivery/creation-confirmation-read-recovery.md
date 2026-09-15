# Creation confirmation read recovery

Fresh template import can register a world successfully while the initial build
makes a subsequent `world.list` read time out. The registered world may then
become ready even though the creation form stopped before its enter callback.
The production creation controller now retries that read without restarting the
creation operation.

Only an actual `Error` whose message exactly matches
`Craftmine Rust request timed out`, optionally prefixed once with `Error: `,
qualifies. Thrown strings, wrapped messages, candidate conflicts, other timeout
families and initialization failures remain ordinary errors. The classifier
matches the existing P8 observation helper, but imports no test deadlines into
the product.

The retry applies only to the list reads confirming the current creation:
after its receipt, after an explicit preparation retry and during initialization
polling. It waits using the existing 2,500 ms polling interval. The pending UI
continues to show preparation and retain cancellation; a timeout is not evidence
of failed initialization. Successful list data, including a failed world row,
returns to the existing controller logic unchanged. A terminal failure retains
the ordinary explicit retry flow.

Before and after every asynchronous read and retry wait, the operation must
still own the mounted controller, uncancelled attempt and pending-operation
references. Cancellation, unmounting or supersession discards a late receipt and
prevents another read. This helper has no creation, initialization retry or world
switch capability. It neither changes the world/operation identity nor retries
the initial mutating creation call. Existing cancellation restoration remains
owned by the controller.

No global RPC timeout, model budget, turn limit or version is changed. Validation
includes asynchronous ownership/error tests and the real React form/controller
under isolated headless execution: timeout then ready with one create, pending
cancellation, terminal failure with retained retry, and existing lost-ACK and
explicit-initialization recovery. Native packaged validation remains separate.
