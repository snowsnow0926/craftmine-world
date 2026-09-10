# Local composer voice input

Status: Accepted for the Craftmine immersive first slice.

Voice is an explicit composer input adapter. Windows installed System.Speech is
the first recognizer, discovered without capture. This avoids assuming Chromium
Web Speech availability or reusing a model provider key for an unrelated service.
The renderer obtains audio only after a user gesture and main-owned permission
arm, emits bounded mono PCM WAV, and sends it through allowlisted preload IPC.
Electron main runs a fixed hidden local recognition process, with cancellation,
size/time limits, and no disk or network audio storage. Other recognizers require
an explicit future adapter and product decision.

Session and world identity travel with each recording and response. The composer
discards stale results and appends accepted text to its current draft. Voice never
invokes an agent or submits a prompt. Rust remains the owner of persisted session
data; this ephemeral device input service owns no database or provider secrets.

The tradeoff is dependence on an installed Windows desktop dictation language.
Availability is visible; speech accuracy still requires user-directed microphone
acceptance and is not claimed by fake-provider or synthetic-silence tests.
