# Bound the observed AppContainer cache-path failure

Frozen ae32974's broker imported the fixed project at 180 and 245-unit redirected
cache paths. At 266 units it returned engine exit zero but logged failure to
create the editor cache and failure saving editor settings. All three had the
same pinned engine, broker, isolated launch policy and verified cleanup. The
executor correctly refused the resulting error log. This distinguishes the
regression from a general task-directory write denial; it does not identify an
unobserved internal Win32 error code.

Choose early explicit rejection with an empirical conservative budget. Retain
the task layout and recovery ownership. Shortening the test profile is useful
as a positive control but is not the product fix. Arbitrary long-profile support
and a new owned scratch-root design remain separate changes. On this Windows
account the default LOCALAPPDATA/CraftmineWorld layout yields 186 units and fits
the budget; an unusually long account or configured profile can still reject.
