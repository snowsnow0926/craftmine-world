# Recover one fully reclaimed native import crash

The packaged client observed a Godot access violation after source scanning,
without script errors. A new isolated run of the same side-view base succeeded.
Allow one narrowly authenticated import retry to handle this failure class.
Do not relax the normal receipt success gate: a failed native import can only
authorize a new task, and the complete build/runtime check must subsequently
pass. Persist the first failure and consumed retry. This preserves a visible
failure on repeat crashes or unverified cleanup and prevents retry loops.
