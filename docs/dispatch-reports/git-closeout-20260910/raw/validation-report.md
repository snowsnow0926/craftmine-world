# Merged next-candidate targeted verification

Source HEAD: 7a089d6537b6da0c9f9511c96f3d8635adbbebf1. Tracked working tree remains clean. No source edits or Git ref changes.

- Retirement/executor: 53/53 passed.
- Asset Main/annotation/R6: 43/43 passed, including eight R6 service tests in addition to the requested 35 and an actual isolated Core persistence check. The borrowed Core source matches the frozen 827 Core subtree; executable identity is recorded in evidence-index.json.
- Broker: offline test compilation succeeded; 36/36 library tests passed. Existing sandbox target was used only for test output.
- Complete desktop TypeScript: exit 0 using this candidate's actual tsconfig and a temporary node_modules junction to existing dependency files. No package installation.

Initial missing-environment asset runs and the failed ad-hoc TypeScript dependency-resolution attempt remain as raw logs. They were setup failures; their successful corrected runs are separately recorded. No actual Godot, Electron, browser, model, packaging, or full Core regression was performed. These checks do not make unsealed next-candidate changes part of the frozen 827 player package.

Cleanup limitation: automatic approval review rejected the command to remove only the newly created dependency junction, reporting blocked by policy. No retry or alternate deletion API was attempted. The link remains at C:/cm-git-closeout-20260910/vendor/pi-desktop/apps/desktop/node_modules and targets C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop/node_modules. Root has been notified. Shared dependencies were not modified.
