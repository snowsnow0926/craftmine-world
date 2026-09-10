# P6 packaged 570 acceptance

Package/source commit: `570fed344ee775aa0cc8d4ef7d096bce96e1cc5f`.
Build manifest SHA256:
`f802fc7b23b350a0f6c5d4a6ac3cde9272da33ae9f5b26bccfb12efdb040f0c8`.
All runs independently checked the package on every process launch. Frozen
source and package were not modified. All eight accepted exits had code zero,
no signal, and empty violations/pageErrors/shutdownFailures.

| Driver | Checks | Strict exits | Raw report under `D:/cm-fb3-20260910/test-results/` |
| --- | --- | --- | --- |
| Assets, actual default import form and PNG decode | 12/12 | 2/2 | `desktop-native-assets-jcFlUW/report.json` |
| Target feedback defaults | 28/28 | 4/4 | `desktop-native-defaults-GOaNOU/report.json` |
| Selected issue export | 11/11 | 2/2 | `desktop-native-issue-export-uDfaxo/report.json` |

Report SHA256 values, in table order:

- `33a9af26ccd71e53eb6e1c2becc031ca11e86f8ee6ac8c6bd6a9fe6eeecc27fe`
- `ae353aedf22b213e36f90ca7efd7ea48815f9fd4600eb64778a0399830493aa5`
- `c3ec572282d6027ce08af112b863aa74b17c414e1bb0079c798c34463531e35b`

The original assets driver first failed after its first strict shutdown because
it compared initial legacy-world revision 0 against the first normal quit's
saved revision 1. That original report remains unchanged at
`desktop-native-assets-FccP6X/report.json`. The successful external driver is
`asset-shutdown-baseline-driver.mjs`, SHA256
`b614ad710b9785d24f96adbf870326c133f3b9e69f74e9799ac82100a4475d7a`.
Its path/hash and original driver hash are recorded in the successful report.

The test-source update preserves complete world-list comparisons (including
revision and update time) throughout asset operations, and adds full live
snapshot comparisons. After the first strict quit, actual Core must return that
exact snapshot; its complete durable record binds the restart baseline. After
reopen and the second strict quit, the complete Core world record must remain
identical. No world fields are dropped. The committed driver is equivalent to
the executed external driver after resolving import paths and removing only
external identity metadata; an esbuild-normalized comparison confirmed this.

Limits: generated local PNG fixtures, explicit owned picker directory, isolated
offscreen processes and no operating-system input/Pointer Lock/models. PNG
library preview does not prove world placement. The asset driver does not
exercise a player cancellation of a running preview; cancellation has separate
actual worker tests, not a claimed client UI acceptance. Installer execution,
clean-OS testing and code signing are outside these three drivers.
