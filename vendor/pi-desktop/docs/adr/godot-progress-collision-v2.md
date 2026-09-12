# Add an immutable restore guard cohort for imported collision

Date: 2026-09-12. Status: accepted for new creation worlds.

The existing progress validator inspected structured creation entities, leaving
imported StaticBody geometry outside its overlap checks. Actual physics showed
wall penetration while the legacy validator returned success. A parameter edit
that changes imported geometry can therefore invalidate saved player placement.

Add a new pinned source cohort rather than modifying published v1 resources.
Validate the real player's full native shape after saved state reaches the
physics server. Fail the existing runtime load/check path on penetration or
inconclusive evidence. Keep ordinary source transactions and adoption ownership;
do not add a separate commit path or relocate the player to force acceptance.

The same guard runs on candidate checking and staging with latest saved
progress. Complete source/PCK/observer pin checks establish the finite guard's
presence. Legacy worlds remain explicitly outside this new protection until an
ordinary source migration is implemented and validated. Navigation, dynamic
changes after restore and complete gameplay correctness remain separate work.
