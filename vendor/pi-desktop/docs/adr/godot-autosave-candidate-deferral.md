# Give periodic autosave an explicit deferred result

Date: 2026-09-14

The page's periodic save only knew its own preview state, while automatic
application was owned by Main. During that application, save was rejected and
the generic page action handler immediately attempted a second rejected resume.
This produced a visible error even when creation and application succeeded.

Use a dedicated background-save route with an explicit host-owned deferred
result. Do not infer success or suppress exceptions by matching generic error
text. Keep manual-save failures, original candidate guards, runtime identity
checks and persisted receipts. The existing timer supplies the next attempt;
there is no new task duration or request budget.
