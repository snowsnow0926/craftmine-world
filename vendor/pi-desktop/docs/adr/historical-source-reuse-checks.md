# Distinguish historical reuse failures from current source

A real combined companion/aircraft install produced a failed v6 check. Later
authoring changed the source and a different check became the applied formal
build. The reuse card still presented the old failure as its only status because
the native projection dropped Core `sourceStale`, terminal jobs were not refreshed,
and local cached job state took precedence over later reads.

Forward only the existing boolean and refresh the exact job alongside proposal
reads. Do not infer that this job passed from another job, current gameplay or
source edits. A stale failed job is historical; missing staleness metadata keeps
the old conservative status. No domain writes, automatic retry, receipt rewrite,
hidden history or added authority is involved. The existing checks surface is
the destination for reviewing this history and newer results.
