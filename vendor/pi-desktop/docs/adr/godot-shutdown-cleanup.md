# Await Godot teardown before quitting Electron

The host previously detached its world and started asynchronous runtime
disposal without giving application shutdown a completion barrier. That leaves
owned loopback connections closing while Electron may stop its event loop.

Return a shared disposal promise and include it in the existing service
shutdown barrier. Keep the durable checkpoint prerequisite and runtime's
bounded socket cleanup. Do not add sleeps or turn nonzero process exits into
success. The observed native IOCP shutdown error remains a recorded failure;
the lifecycle omission is independently verified, and native retests decide
the practical result.

The PP2 follow-up closes additional ownership gaps: wait for formal world
WebContents destruction, await owned child process/stdio termination, and share
the complete HTTP runtime disposal promise. Deadlines produce named incomplete
teardown errors; main records these after collecting every service result.
No sleep is added and application exit-code acceptance is unchanged. This is
an independently justified lifecycle repair, not a proven explanation of the
IOCP crash. UtilityProcess has a distinct exit-plus-stream-close contract;
Node ChildProcess uses its native close event.
