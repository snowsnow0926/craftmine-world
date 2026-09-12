# Keep preparation text independent from the previous session

Date: 2026-09-12. Status: accepted.

FB03-001 showed that disabling the entire chat with `inert` prevented players
from typing while a new world initialized. Simply enabling that surface would
send through the previous session until the new session existed.

Use an independent preparation editor from the first render, create the new
ordinary session as soon as its world id is known, and hand text to that
session only after actual readiness. An explicit queued submission uses the
normal host capture and ordinary prompt path; typing alone is never consent to
send. Preparation text is retained on cancellation, and pending replies cannot
restore the new selection after the original context has been restored.

This is a renderer ownership boundary, not a new model workflow. Model
configuration, permission handling, ordinary composer behavior and host world
identity checks remain authoritative. Scoped initializer cancellation is
provided by the private navigation host and never broadens candidate cleanup.

See [the behavior and integration scenario](../spec/dialogue-preparation-draft.md).
