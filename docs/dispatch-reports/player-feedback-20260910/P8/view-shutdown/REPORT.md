# Owned-view shutdown contract repair

Scope: independent branch codex/fb-view-close-20260910, based on frozen 570fed3.
No frozen package or root integration source was edited.

- Controlled actual-class/Main tests plus affected regressions: 34/34 passed.
- Strict TypeScript checking of owned-view-close, BrowserPane, BrowserHost and
  PluginViewHost: exit 0 using read-only root3 dependencies.
- Actual Electron offscreen ownership: 3/3, exit 0, no BrowserWindow; every view
  confirms the initialization Pointer Lock guard with count 0.
- Final native raw directory: D:/cm-fb-view-close-20260910/test-results/view-close-electron-vbovz9.

Earlier native C3ctwr failed because the fixture accessed view.webContents after
Electron cleared it. The original report remains; the harness and ownership code
now retain the original handle. Earlier fullscreen fixture failed its missing
new helper dependency (2 failures/1 pass); its actual-helper loader and destroyed
event fixture were updated, with all three existing assertions retained.

The reusable BrowserHost guest-disposal regression identified during independent
review is fixed and covered by reload, late navigation and close-failure tests.
Pre-owner export/turn-settlement failures no longer skip other resource barriers.

Limits: no model requests; no complete desktop/package test in this subtask.
This repairs a demonstrated early-completion contract gap and does not establish
that the historical IOCP crash has the same cause. Root integration owns the
full-client regression and any subsequent sealed package.
