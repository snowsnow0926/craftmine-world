# Direct input after entering the Web world

Entering the Web slot through the trusted desktop already expresses the player's
intent to play. The iframe must not require a second Enter world click merely
to enable W/E controls. The trusted view now carries its immersive-active state
with load and immersion messages. The existing source/origin/nonce message checks
remain in force.

The real Web engine enables keyboard input and hides the duplicate entry gate
when immersive, unfrozen and not covered by dialogue/pause. This transition does
not focus any element or window and does not request Pointer Lock. The original
canvas gesture remains available for optional mouse-look capture. Pausing or
leaving immersion disables input and clears held keys. Returning to play enables
input again; duplicate unchanged presentation messages do not clear a held key.
Standalone embedded/manual play and draft previews retain their original gate.

The isolated game test runs the actual game document and voxel engine. Trusted
host messages enable controls; DOM callback events exercise real W movement and
E interaction dispatch. It verifies pause isolation, held-key clearing, resumption
and no focus/Pointer Lock calls. This is not physical keyboard acceptance.

The earlier offscreen Web image showing a 1200x800 world within a 2560x1440 view
was an early resize observation, not proof of a permanently broken layout. The
same unchanged package naturally reached full iframe/canvas size. Native visual
and normal attachment tests now wait for two consistent samples matching the
actual viewport, without writing view bounds or forcing a repaint. This is an
acceptance correction; no product resize workaround was added for screenshots.
