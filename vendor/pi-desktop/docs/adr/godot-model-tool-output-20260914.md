# Keep complete Godot evidence behind an explicit model read

The real DeepSeek V4.1 Flash retained-task continuation on 2026-09-14 produced
one Blender model and one checked source patch, then repeatedly reconstructed
facts. Eleven facts reads and eleven build reads repeated the same successful
check and engine log observations. The last actual text blocks were 61,667 and
52,000 characters. Persisted UI envelopes were larger; their duplicated details
must not be counted as additional model input.

Use a pure model-facing projection, not destructive truncation of Core or
transcript data. Share repeated diagnostic source identity, aggregate exactly
matching observations with occurrence counts, and replace bulky raw logs and
default snapshots with hash/pointer descriptors. Add an explicit full-read
option through the existing tool and authorization path. Preserve the
separation between a passed check, source freshness, application authority and
actual gameplay validation.

This changes the default model read representation; consumers requiring the
original complete diagnostic/output representation must request `detail=full`.
No executor, context budget, compaction policy, persistence, network or player
permission policy changes here. Original failed model/tool calls remain evidence.
