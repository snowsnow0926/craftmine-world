# J-20 exterior model handoff

Authored in this CLI session from the supplied AI four-view image, which was
visually inspected before modeling. No finished model, image plane, external
texture, or third-party geometry was used. The public photo page was not used
as a measured drawing. The Pomeranian files were not edited by this session.

Source: `examples/blender-models/j20.py`.
Artifacts: `test-results/codex-models/artifacts/j20/`.

## Actual delivered data

- `model.glb`: 1,130,080 bytes; SHA-256
  `458105858e12f513dbef111672e83a9897f274796d4321358425a479f094bafe`.
- `source.blend`: editable Blender source, 2,866,787 bytes.
- GLB: 21 meshes, 22 nodes, 36,307 exported vertices, 41,884 triangles,
  25 PBR materials, no animations or external resources.
- Blender source: 29,085 vertices and 21,519 polygons.
- Display dimensions: length 20.802 m, span 12.960 m, height 4.630 m.
  These are authored proportions, not measured aircraft specifications.
- Blender orientation: nose -Y, Z up. The standard exporter converts to glTF Y up.
- `receipt.json` records successful normal import, job
  `c425b0a9-1dfa-45fd-835c-a7d4bb3421d8`, isolated project revision 1.
- `geometry-audit.json` records valid indices, finite positions, unit normals,
  zero degenerate triangles, matching source/import hashes, and no model lights
  or cameras. Reproduce with `node test-results/codex-models/artifacts/j20/audit-glb.mjs`.

## Geometry and visual review

The exterior uses a continuous chined fuselage loft with a recessed single
cockpit, thick cambered delta wings and canards, two canted vertical tails,
lower fins, open intake lips with deep ducts, and two hollow exhausts with
individual metal petals and inner liners. Coating panels are clipped to the
underlying triangles and inherit their normals. Major edges retain their shape;
small bevels and smooth canopy/engine surfaces provide highlights.

All five final 1280 x 1280 previews were rendered from the actual final GLB and
personally inspected: `hero.png`, `top.png`, `side.png`, `back.png`, `front.png`.
The final review found a coherent single-seat canard/delta/twin-tail silhouette,
bilateral intakes, readable hollow nozzles, and no obvious floating stray parts
or remaining panel overlap artifacts. The backdrop and shadow floor are added
only by the trusted preview renderer and are absent from the asset.

The initial Blender run failed because this bundled version returns indices
from polygon tessellation. That was corrected only in the model script.
Visual iterations corrected the nose tip, engine casing transition, overlapping
coating layers, canopy curvature, material balance and nozzle wall normals.
`review-01/` retains the first overexposed previews; `review-02/` retains the dark
second pass. During work the coordinator changed the trusted preview lighting
and framing to studio-v2. This modeling session did not edit either adapter or
renderer, change import policy, touch packaged resources, use a GUI, or delegate.

## Remaining visual limits

Panel layouts and proportions are an exterior interpretation of the AI reference,
not a production-airframe reconstruction. The canopy is strongly tinted and
reflective; the simplified seat and instrument hood are difficult to see in the
standard previews. Exhaust and intake interiors convey depth but are simplified
display forms. There is no weathering texture, detailed instrumentation, rig,
landing-gear deployment, collision setup or flight system. Normal GLB import is
verified; world placement and playable application verification are not claimed.

## Regenerate and render

```powershell
node scripts/blender-model-demo.mjs generate j20 examples/blender-models/j20.py
node scripts/blender-model-demo.mjs render j20 hero
node scripts/blender-model-demo.mjs render j20 top
node scripts/blender-model-demo.mjs render j20 side
node scripts/blender-model-demo.mjs render j20 back
node scripts/blender-model-demo.mjs render j20 front
```

No Git commit or merge was made by this modeling session.
