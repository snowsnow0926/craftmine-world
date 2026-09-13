# Direct-use progress and read coalescing

Date: 2026-09-13. Previous measured component additions spent roughly 35–39
seconds in preparation/checks and 16–18 seconds in adoption. A generic waiting
message did not distinguish import, export and real runtime checking.

Expose the native worker's allowlisted stage/percent and optional measured
durations through the existing bounded product receipt. Keep old receipt
compatibility. Do not invent a percentage, ETA, historical duration or success.

Concurrent read-only inspections and status polling coalesce by exact identity
only while in flight. Subsequent reads verify again; no content or compatibility
cache can authorize installation/adoption. This reduces duplicate Core/archive
work without removing native checks. The dependency owner is drained before
shutdown. Timing data stays in native operation records; the renderer's durable
storage remains locator-only.
