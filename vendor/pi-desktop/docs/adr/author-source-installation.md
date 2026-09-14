# Explicit source installation in the active author turn

The reported preview.23 request “再给我生成一只小狗” ran in full-auto mode but
could only create a source proposal. After manual installation the check passed
and the candidate was actually adopted; the conversation still showed a passed
check and asked the player to apply it. This obscured the separate view recovery
failure and left the player unable to tell whether the second dog existed.

Keep proposal semantics unchanged and add explicit write modes to the same bounded
source-library tool. Use a private installer binding to the current author lease,
reusing the existing installation and checking implementation. Do not turn a read
or proposal into an implicit write, create a second world lease, or add a new
adoption authority. Current full-auto capture and host permission remain required.

Project adoption state separately from check status at Main's existing package
boundary. Reread Core evidence instead of trusting immutable installation receipts
or assistant wording. A missing confirmation remains unknown. No storage schema
migration, new remote API, credential sharing or player-world conversion is needed.

See [the contract](../spec/author-source-installation.md) and
[acceptance scenarios](../e2e/player-source-installation-20260914.md).
