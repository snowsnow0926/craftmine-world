# Original requirements across long tasks

The host records literal user requirements in the existing task journal. A compact task projection contains the first `request` followed by the three newest `correction` records. Each record retains its identity, kind, up to 1,000 Unicode scalar values, and `truncated`. Later requests cannot displace the original goal. Ordering uses recorded time and request ID; new records receive a monotonic per-task time so rapid corrections keep insertion order across recovery. Existing stored rows require no migration.

`TaskJournal::task_read_requirements` accepts only `{context, requestId?, start?, limit?}`. The Rust router exposes the private name `task.readRequirements`. The host tool `requirements_read` supplies the actual current workspace context and exposes only the optional request ID and pagination fields to the model. It accepts no project, session, task, turn or world identifier from model arguments.

The response is `{binding, worldId, items, start, next, totalChars, totalRecords}`. Items contain `{id, kind, text, start, totalChars, truncated}`. The outer offset is a Unicode scalar position across original record bodies ordered by ascending time and request ID. The inner offset is relative to that record's original text. An optional request ID filters the journal before offsets are evaluated. All original text, including tails omitted by compact context, can be read without mutation.

Pages contain at most 4,000 text characters and 32 record segments. Default start is zero and default limit is 4,000. `next` is null at the end; otherwise callers must use its returned value, because the segment limit may stop a page before the requested character limit. Invalid offsets, zero/oversized limits, unknown fields, unknown request IDs and foreign workspace identities fail explicitly. Empty journals return zero totals and no next page.

Explicit recovery copies requirements into the resumed task and preserves the original goal. An ordinary new turn has its own journal and cannot retrieve the prior goal through the new context. No summary output changes the original text or budget counters.

## Verification

`cargo test -p craftmine-core --lib` includes:

- More than four corrections retain the original goal and the latest three corrections; retrying an old requirement is idempotent and does not reorder it.
- A long mixed Chinese/emoji goal has a marked compact projection; reading all pages recovers its final requirement exactly.
- Forty-five records enforce both page bounds and preserve all code points across segments.
- Unknown fields, forged session identity, invalid limits/offsets and unknown original IDs fail.
- Explicit recovery retains the original and its tail; a subsequent ordinary task has neither the old projection nor access to that request under its new identity.

Native provider continuation and model tool invocation belong to the integration acceptance suite. These Rust tests do not claim a model call occurred.
