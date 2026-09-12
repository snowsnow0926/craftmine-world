# Separate retrying preparation from repeating world creation

Status: accepted for the September 13 Godot reliability repair.

The form kept a stable operation ID but re-enabled title/base fields after an
initialization failure. The host correctly rejected changed attributes with
WORLD_EXISTS. Repeating the unchanged create merely returned the existing failed
record, since recovering initialization is a separate explicit operation. The
form therefore looked editable and retryable without performing either action.

Retain the acknowledged request in the controller and freeze its registered
attributes. Route explicit retry through a fresh list read, normal selection and
the existing scoped initialization retry. Preserve the original return world
across attempts. Unknown create replies retain the original request until host
idempotency confirms it. This repairs the form without weakening host identity
checks, adding write channels or discarding the failed world's source.
