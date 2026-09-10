# Seal a portable derivative of an already verified release

Date: 2026-09-10. Status: accepted.

An externally created portable ZIP has no enforced link to a particular sealed
Windows application. A matching filename or commit label alone cannot prove
that it contains the already verified payload.

Create a fresh derivative directory under one explicit release run. Before and
after fixed compression/extraction operations, verify clean source identity,
run ownership, build manifest, original release seal, package evidence, and
the complete unpacked payload. Inherit the existing executable/library pins
for full 7-Zip; do not accept an unpinned fallback. Inspect archive paths before
extraction and compare every extracted file's bytes/hash afterward.

Keep the original seal and output immutable. A derivative gets separate ZIP,
evidence, seal, and failure reports. This preserves reproducible provenance
without treating compression as an application rebuild or claiming signing,
clean-machine validation, or identical compressed bytes across runs.

See [portable release sealing](../spec/portable-release-seal.md) for ownership,
limits, command syntax, failure behavior, and test/production evidence boundaries.
