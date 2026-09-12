# Godot query source evidence and continuation

Date: 2026-09-12. Status: accepted for GU2 implementation.

The initial Godot query capped symbol discovery at 24 scripts without a resumable file offset, omitted identity from script and symbol results, and parsed capped resources without an incompleteness signal. A model could miss a feature or dependency without knowing how to retrieve the remaining evidence.

Keep the existing tool and formats, add immutable revision pins and file-page continuation, and label all query results as static source evidence. Whole-selection completeness and current-page coverage have distinct fields. Oversized scripts/resources are explicitly omitted; exact file reading remains available. This preserves bounded individual tool replies while allowing any eligible project file to be inspected over further calls without imposing a whole-turn or model-request budget.

Engine semantic indexing and runtime node inspection remain separate GU2/GU4 work. A successful text parser must not be promoted into an engine or gameplay assertion.
