# 827 terminal-recovery package acceptance

The installer and portable payload were rebuilt from 8276b4540289c0d397c382dff2123edfe1861d42. Source, package and extracted portable files were independently verified before and after execution. Later source commits are not included.

- complete: 55/55 attempted steps passed; whole suite passed; 8 clean client exits.
- parameters: 20/20 attempted steps passed; whole suite passed; 3 clean client exits.
- issues: 22/22 attempted steps passed; whole suite passed; 3 clean client exits.
- history: 9/9 attempted steps passed; whole suite passed; 1 clean client exits.
- export: 8/8 attempted steps passed; whole suite passed; 1 clean client exits.
- longPath: 7/7 attempted steps passed; whole suite passed; 2 clean client exits.
- capacityInterrupted: 29/29 attempted steps passed; whole suite failed; 2 clean client exits.

The first complete attempt stopped after 29 passing steps when its actual broker returned Windows error 112 (disk full). It remains a failed suite. A fresh private profile reran the unchanged package after lossless compression. No historical version counts are carried forward. The raw executor ledger retains the failed world, job, request and broker error.

Long task-path errors survive client restart without automatic retry or an engine launch for the rejected directory. Explicit recovery remains a separate action.

Limits: no real-model request or credential access; no installer execution, clean Windows upgrade or uninstall; unsigned local previews, 154 preflight warnings and prototype art/gameplay. Fixed native export tests do not imply full original model acceptance or production/legal release clearance.

All raw copies retain exact bytes. The immutable delivery directory contains logs, game-only captures, package seals, artifact hashes and Chinese reports:

C:/cm-plan-next-20260910/desktop/build/releases/8276b4540289-84495c89-013c-4c2e-a67d-1d6b60c6b0e6/delivery
