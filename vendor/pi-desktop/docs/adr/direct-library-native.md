# Native direct-use operations reuse the package and candidate owners

Date: 2026-09-13. Status: accepted for the first independent creation plan.

The current catalog already owns exact immutable versions, while the installer
owns source planning/checks and the candidate coordinator owns safe formal
adoption. Asking an Agent to add an already selected asset adds model setup and
latency without resolving additional intent. A direct-use flow is now explicit
player consent for that selected archive and bounded placement.

Decision: add a native operation orchestrator and narrow private catalog adapter.
Do not create another source installer, fabricate model turns or bypass existing
Core/first-load checks. Core `godotProject.sourceContext` supplies read-only
inspection authority. `createPackageInstallBinding` supplies the existing
product installation scope only when start is explicit. The renderer never sees
that scope or the package bytes.

Native operation persistence records product intent/state; Core and installer
records remain authoritative for actual source/check/adoption effects. A retry
reconciles the same operation. A check is not success until native adoption
finishes. Interrupted work is visible and never automatically replayed at boot.
This avoids silently installing twice after a transport failure and keeps
ordinary saved progress protections intact.

Consequence: direct use supports only one declared scene root. Complex requests,
raw resources, new content and incompatible composites retain their established
creation/AI workflows. Eligibility is archive-only; actual target compatibility
is learned during the normal native check. No new Rust schema or model routing
change is introduced.
