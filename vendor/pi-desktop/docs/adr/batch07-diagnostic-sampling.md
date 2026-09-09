# Bounded observational telemetry

The existing diagnostics service had no production timing feeds, so presenting its empty metrics could be mistaken for completed performance work. Add a small injectable Main-owned observer instead of a renderer-controlled telemetry RPC or unbounded log parser.

Use monotonic durations and bounded per-surface callback windows. Aggregate fixed source/outcome enums and never store prompt/error text or session identity in diagnostics. Task IDs remain private matching keys only. Preserve source distinctions: whole Agent jobs include tool time, while one-shot completion is separate. A manifest hash identifies supplied provenance and is not a claim about every installed byte.

Independent headless fixed-load measurements are separate artifacts with reproducible scene hashes and local reference thresholds. No performance optimization claim follows merely from adding instrumentation. No VM is available in this session; an explicit isolated-runner script improves reproducibility without mutating OS settings or falsely claiming clean-machine acceptance.
