# Keep native maintenance usage visibly incomplete

The real segmented recovery completed native compact turns, but the application
displayed all-zero transport usage. A scoped read-only audit of that exact test
thread found separate native token_usage_record entries totaling 464,357 tokens
after three maintenance turns. Each was followed by a token_count notification
with zero total counters and a context-shaped last total. The zero notification
did not mean free model work. The application has not verified/consumed a protocol
usage-record channel for this maintenance data.

Do not fabricate a complete total from context resets or private file reads. Once
native maintenance is observed, generic operation usage remains absent. A new
optional coverage object records incomplete status, the maintenance-unreported
reason, completed maintenance count, observed elapsed time (nullable), and any
subsequently reported creation counters. The same object appears in active status
and the existing Rust-owned codexUsage message metadata. It is not a new usage or
history store. Generic aggregators cannot mistake a partial count for a full
total because the normal usage fields remain omitted.

Composer and transcript metrics state that maintenance usage is unreported and
total usage incomplete. Old contradictory capacity markers are filtered only
when rendering, without rewriting old records. Rust roundtrip, actual React
projection, adapter reset/abort/creation regressions and offline export coverage
verify preservation. External native usage audits remain separate evidence with
their own source/deduplication rules. No model call, account-usage request, model
substitution or new authoring budget is introduced by this change.
