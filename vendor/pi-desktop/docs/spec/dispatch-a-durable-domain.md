# Durable Craftmine request accounting and recovery

The Rust domain owns per-task request reservations, usage settlements and compaction/tool counters. Every request purpose shares one budget. Unknown requests retain their estimate; retries cannot reset limits. Provider totals do not double-count reasoning or cache detail. Limits are immutable after the first reservation.

Short task context is derived from the actual workspace, formal world, durable requirements, receipts, verification jobs and lease. Model summaries cannot replace these facts. Completed turn requirements do not become active instructions in the next ordinary task.

Startup recovery terminates pending jobs and releases stale world leases. Interrupted draft recovery is an explicit player action using a fresh host turn identity and generation; opening, copied requirements, retained budget owner and closing the old identity are atomic. Discard preserves draft history and formal world progress. No startup path replays model requests.
