# Player source discovery recovery

The preview23 player request “再给我生成一只小狗” produced four avoidable
read-tool failures in session `9bf1a417-e9a2-4d40-8352-1b01e9b146b6`:
two project-index calls with limits 100 and 60, one asset search without scope,
and one guidance catalog request on source revision 5 / manifest
`9ce4e1f13dc9279adc258a4db738fc1494ba4da5d984bedd3e32f18525e53e84`.
This change covers discovery only. It does not claim that a source proposal
installs a second pet or that candidate adoption and rendering succeeded.

## Pagination and search

`godot_project_index` keeps the existing Core range 1–32 and default 32.
The schema already advertised maximum 32; the description now states this
explicitly. The broker rejects invalid limits/offsets and incomplete source pins
before opening a workspace, returning actionable details instead of only
`INVALID_PROJECT_PAGE`. Pages must follow `nextOffset` at a fixed returned
revision and manifest hash. Core remains authoritative for actual source bounds.

`asset_library` search defaults an omitted `scope` to `local-library`, matching
its optional schema field. Explicit null, empty or unknown values remain invalid.
`current-world` still gets the world ID exclusively from the host binding.
Search never imports, installs or modifies assets; read/versions are unchanged.

## Retained bundled guidance

Catalog 1.8.3 adds two complete 15-file cohorts for the retained player-collision
controller and engine-monitor bridge, with separate original-picker and ray-local
picker variants. The original mainline template supplies the exact first cohort;
the fixed observer picker upgrade supplies the second. The complete 54-file
actual player index is preserved as a hash-only source fixture.

Each member retains exact LF and CRLF hashes, including inherited adapter,
controller, camera, component-state, bridge and engine collector. Neither base ID
nor a top-level adapter hash alone establishes compatibility. Missing, modified,
aliased, duplicate and unknown mixed members still reject. Required recipe source
references retain their original bytes and hashes and are re-read at the pinned
source identity after the complete cohort matches. All seven old cohort entries,
recipe versions and body/reference bytes remain unchanged. No runtime generation
of trusted pins from a player's source is introduced.

Validation: 40 source/broker/packaging tests pass. The packaging test additionally
executes six existing engine-cohort cases and three retained-monitor cases against
the actually generated plugin. These are deterministic source and host-double
tests; they are not a real model turn, native rendering or second-pet acceptance.

## Guidance pagination follow-up

The separate ordinary model run in session
`d8e5b82a-8a52-44c8-ab5f-c081f545bc95` first requested guidance read limits 16000
and 12000, receiving bare `INVALID_GUIDANCE_PAGE` twice before omitting the limit.
The schema already capped reads at 8000. The tool description, catalog guidance
and validation errors now all state the same unchanged range: 1–8000 Unicode
characters, default 4000. Offset remains 0–200000, default 0, and cannot exceed
the selected text's character count. That last check now occurs before host reads,
alongside the existing exact ID/version/hash/pin and page validation. An offset
equal to the character count still returns the existing empty terminal page.
Follow `nextOffset` until null with the same text and source identity.

Tests replay both actual invalid limits, fractional/out-of-range values, and
default/max/final pages through source and generated-plugin routes. Original
failed player tool calls remain unchanged. This is clearer recovery for malformed
arguments, not evidence that a model will never make a pagination mistake.
