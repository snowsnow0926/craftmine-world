# Godot Web audio initialization and exit

Godot 4.7.2 creates its AudioWorklet node in a continuation of the promise returned
by `audioWorklet.addModule`. Its exit handler clears the audio context. A quit
that runs before the node continuation can therefore construct a node against
null and leave the engine's exit promise unresolved.

The page bridge observes module loads while returning the original promise to
the engine. The observer is registered first; the quit continuation it releases
runs after the engine's node continuation. Pending loads delay quit without a
fixed sleep. A module failure remains observable, a thrown quit is reported as a
runtime error, and a load that never settles remains subject to the host's
bounded teardown and failure reporting.

The deterministic barrier tests exercise the actual bridge bytes, including a
fixed-order counterexample. The offscreen witness binds its served bridge to the
declared source before starting a renderer, records both hashes and the entry
hash, and separately checks engine exit and the outer Electron process exit.
Timeout and signal termination cannot pass. Its standalone preload-error probe
does not load a Godot build and is separate from the build identity gate.
Raw reports and streams are awaited before a result is returned.

The source-runtime witness is not a full packaged-client acceptance. For a
release, run the barrier tests against the packaged bridge, verify the witness
export uses identical bridge bytes, and run the packaged-client shutdown audit
as well. An explicitly bound old-bridge counterexample is diagnostic evidence;
it is never included in candidate verification. Every browser process uses
independent data with hidden, non-focusable offscreen windows and no input.
