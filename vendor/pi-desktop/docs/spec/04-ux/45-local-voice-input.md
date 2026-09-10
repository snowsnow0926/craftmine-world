# Explicit local voice input

Voice input is a composer draft input, never a separate agent task. Holding the
microphone button (or holding Space/Enter while that button has focus) explicitly
arms one microphone request. Release stops capture and transcribes locally. The
result appends to the existing draft for correction; only the composer's existing
send action submits it.

The shipped adapter uses the Windows System.Speech installed dictation engine.
Capability enumeration opens no microphone. The UI exposes engine availability
and language in the microphone tooltip. It prefers the UI locale when installed
and otherwise uses the first installed recognizer. On this development Windows
machine, read-only enumeration found `MS-2052-80-DESK` (`zh-CN`). Other machines
need a compatible Windows desktop speech recognition language installed. No
cloud recognizer, API key, download, signup, or remote audio upload is implicit.
Unsupported platforms and missing engines disable the control accurately.

Capture uses an AudioWorklet at 16 kHz mono, with a 30-second wall-clock limit and
a separate 480,000-sample limit. The canonical PCM16 WAV is at most 960,044 bytes.
Main validates its entire fixed WAV header, size, encoding, channels, sample rate,
and declared payload length before starting recognition. Hidden PowerShell runs
a fixed script, receives JSON over stdin, reads audio using SetInputToWaveStream,
and returns bounded text. It never reads from the default audio device. Process
time is capped at 45 seconds and output at 32 KiB.

Starting, recording, transcribing, no speech, permission denial, missing microphone,
missing recognizer, and transcription failure have distinct UI states. Release
during a pending permission request cancels that gesture; if access arrives late,
all tracks stop immediately. Escape, cancel, window blur, hidden document,
disabled input, unmount, and session/world context change discard capture and
invalidate results. Main binds recognition to the originating WebContents and
kills jobs on cancellation/disposal. Audio lives only in bounded in-memory buffers
and process pipes; no audio files, attachments, history, telemetry, or logging are
created. Ordinary composer draft persistence may retain corrected transcript text.

The main-renderer IPC contract is defined in `packages/shared/src/voice-input.ts`.
`capability`, `arm`, `transcribe`, and `cancel` use the standard Result envelope.
Main must restrict these calls to the trusted main frame. `arm` grants one brief,
audio-only microphone permission opportunity; it cannot grant camera access or
permissions to a world/plugin view. Native blur/destruction clears that grant.
`VoiceMicrophonePermissionGate` validates the owner, exact document URL, main-frame
identity and bounded request/context identity. Grants expire after 10 seconds using
a monotonic clock and are consumed by one matching audio-only media request. The
permission check handler always returns false; only the request handler consumes
the grant. This follows [Electron's permission handler contract](https://www.electronjs.org/docs/latest/api/session).

## Validation

`node --test test/voice-input.test.mjs` covers fake capture/provider state changes,
stale result rejection, malformed/oversize WAV rejection, owner-scoped process
cancellation, missing capabilities, and installed Windows engine enumeration plus
synthetic silence recognition. Synthetic fixtures do not establish speech accuracy.
Automated tests never record a real microphone or simulate user input.

`node --test test/voice-microphone-permission.test.mjs` verifies one-use grants,
expiry, navigation, cancellation, and rejection of other documents, owners,
subframes, camera, mixed-media, and display-capture requests. The opt-in
`test/voice-permission-probe.cjs` requires `CRAFTMINE_VOICE_PROBE_DATA` (an isolated
temporary directory) and `CRAFTMINE_VOICE_GATE_BUNDLE` (the helper bundled to CJS).
Run it only with an explicitly supplied Electron executable. It starts headless
and offscreen with `show: false`, `focusable: false`, fake media devices, separate
user/session data, and disabled Pointer Lock. It records machine-readable results
in its data directory. Electron 43.5.0 passed: an always-false check handler still
allows one armed request-handler grant, with unarmed requests denied before and
after. No real microphone was opened. This is a permission plumbing check, not a
speech accuracy test.

Relevant API references: [Microsoft SpeechRecognitionEngine](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine?view=netframework-4.8.1)
and [SetInputToWaveStream](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.setinputtowavestream?view=netframework-4.8.1).
