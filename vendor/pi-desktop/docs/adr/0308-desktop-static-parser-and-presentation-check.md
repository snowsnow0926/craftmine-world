# ADR 0308: Desktop static parsing and presentation evidence

- Status: Accepted
- Date: 2026-09-09

## Evidence

Native acceptance exposed a compiler that invoked process.execPath as Node even
inside an Electron utility process. The check timed out. A later run passed the
loaded-message checks but produced a black preview: ResizeObserver cleared the
canvas after the explicit draw, while the hidden frame skipped its animation loop.
A shared HTTP verifier test also exposed missing collision/color observations,
which incorrectly rejected a working sliding door.

## Decision

Bundle the pinned Babel parser as trusted static code for desktop syntax checks,
including its license. Do not execute authored code or launch Electron as Node.
The web compiler keeps Node syntax checking and refuses accidental Electron use.

Share the browser checker across web and desktop. Observe runtime primitives and
state, including collision/color and saved resources. After hidden canvas resize,
redraw explicitly. Native verification checks actual composited pixels in addition
to the matching build ID and API/event reports.

## Limits

Pixel sampling detects empty/black presentation in the current ground-and-sky
world; it is not proof of artistic quality or player-request satisfaction. Mandatory
advisory review and a transactional apply barrier are subsequent work. No model
may return its own job completion verdict through the tool or panel APIs.
