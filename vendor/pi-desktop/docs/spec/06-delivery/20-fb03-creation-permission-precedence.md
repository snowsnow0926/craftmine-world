# FB03 creation permission precedence

Creation auto-adoption uses the same effective permission mode as host-core:
an explicit session mode wins; `inherit` uses the application default; an absent
default remains Ask. No session and unknown explicit modes never authorize
automatic adoption. A global Auto setting cannot override a session explicitly
set to Ask or Accept edits. Existing captured-context and task authorization
checks remain in force at application time.

Creating a new world from a selected conversation copies that conversation's
permission mode. An unrelated home draft configuration must not override it:
home Auto plus a selected Ask conversation still creates Ask. An inherited
source retains the application's global choice. Only an entry without a source
session reads the home draft's permission. The normal successful session
creation still consumes the home configuration; it is not cleared beforehand
as a workaround for precedence. Actual-store regressions cover explicit modes,
inherited/global choices and both home-only modes through the create API receipt.

The FB03 AK47 failed turn reached no model request: its retained session is
DeepSeek Flash expires0910 / max, with inherited permission and no global default
(effective Ask). Separate dialogue-entry screenshots show DeepSeek V4 Pro /
medium / Ask. Evidence must retain these distinctions instead of inferring
the failed turn's configuration from adjacent screenshots.
