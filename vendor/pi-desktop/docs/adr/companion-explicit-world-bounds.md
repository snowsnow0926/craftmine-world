# Version companion bounds without rewriting published state

Date: 2026-09-14

A real city companion could not save after crossing z=-80 because its published
script embedded a prototype range. The city itself permits z down to -300.

Publish v3 with explicit finite receiving-world bounds, keep the state schema and
all old archives, and provide versioned recipe configuration plus an exact-hash
source-local upgrade plan. Unknown worlds require source review. Never rescue a
save by clamping or moving the pet, bypassing later field checks, or using the
player capsule's collision validator for the pet. Keep its own native shape
validation and the existing 2 mm contact inset.
