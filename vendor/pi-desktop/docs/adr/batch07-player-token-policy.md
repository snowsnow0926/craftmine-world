# ADR: Player-owned cumulative token limits

A model context window measures one request. The existing one-million-token ledger measured accumulated usage across the complete task. Repeated valid requests could exhaust that ledger while the model still had ample context space.

Use unlimited cumulative tokens for new task owners, while retaining every usage record and independent request/compaction/deadline limit. Existing policies change only through an explicit player channel. Never discount cached tokens from actual usage or silently reset the owner at resume. Store player changes as immutable operation receipts and migrate domain archives to schema 3. The model dispatcher intentionally cannot call configuration.
