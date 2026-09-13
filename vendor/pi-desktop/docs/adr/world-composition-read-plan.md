# Keep composition plans separate from source installation

Status: Accepted, 2026-09-14.

The product already owns versioned source ZIPs, a source installer, normal
checks/candidate adoption and a real Agent. Component resemblance or a model
name does not establish that arbitrary combinations work in a receiving world.
Introducing another mutation engine for recipes would duplicate existing source
ownership and risk treating static assets as playable content.

We therefore add a bounded product recipe catalog and a read-only source-bound
planner to the existing source-library service. Recipes pin exact immutable
package bytes/roots; their configurable fields are explicit player choices.
The source-library tool gains read modes, and the existing main-frame package
gateway gains two narrowly validated read methods. Main verifies world selection
on both sides of asynchronous reads. Rust remains source/SQLite authority.

Static preflight compares actual source descriptor hashes with component
requirements and reports runtime checks separately. It never emits a ready or
applied state. An aircraft still requires its real runway and gameplay tests;
collection and unlock integration is explicitly outstanding Agent work.

The PI asset library reviews the resulting plan, re-reads it before handoff and
appends an ordinary request to the selected world's existing Composer. The user
sends the request; model/backend/permissions are unchanged. The Agent must
re-evaluate the current task source and use existing source proposal/edit/check
and adoption tools. Recipe data and wishes do not silently become accepted
world goals or authoritative memory.

Consequence: composition plans are useful, reproducible starting points with
measured source and archive identities, while end-to-end playability remains an
independently tested result. Whole-city wishes remain intact even when a recipe
offers an optional street fragment. New recipes/asset versions require new
versioned catalog data and targeted verification, not mutating old pins.
