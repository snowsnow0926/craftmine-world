# Remove the Web world's duplicate gameplay entry gate

Status: accepted for the approved two-world player flow.

The desktop's Web card opened the world, but `game.js` paused engine input after
load. Resume/immersion only activated simulation; the input flag stayed false
until the internal entry button invoked focus and Pointer Lock. Consequently the
outer entry could show a world while W/E remained gated behind another click.

Use the existing trusted presentation channel to express immersive gameplay
ownership independently from mouse capture. Enable keyboard input without focus
or Pointer Lock, and revoke it on dialogue/pause/leave transitions. Preserve the
manual gate outside immersive desktop play. This changes the actual engine input
state rather than simulating a click or adding test-only activation.

Input activation alone did not guarantee key delivery: the desktop focuses the
parent WebContents, while the game originally listened only inside its iframe.
Forward trusted parent gameplay keys through the existing scoped message channel
instead of introducing focus manipulation. The child invokes the same engine
handler, with its own state and world checks. This preserves native child-key
handling and application shortcuts while ensuring the outer entry can route W/E
without relying on an accidental prior iframe focus.
