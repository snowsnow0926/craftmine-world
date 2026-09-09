@tool
class_name CrosshairStyle
extends Resource

## Screen-space crosshair appearance. Selected by the active EquipmentDefinition,
## so the drawn reticle always matches the equipped item.

enum Shape { CROSS, DOT, CIRCLE, CROSS_DOT }

@export var shape: Shape = Shape.CROSS
## Full arm length of a cross, or diameter of a circle/dot, in pixels. For a
## cross this is the total span, so each arm is half of it.
@export var size_px: float = 14.0
@export var thickness_px: float = 2.0
## Empty space between the centre and the start of each cross arm.
@export var gap_px: float = 3.0
@export var color: Color = Color(1.0, 1.0, 1.0, 0.9)
## Tint applied for a short moment after a confirmed hit.
@export var hit_color: Color = Color(1.0, 0.45, 0.30, 1.0)
## Tint applied while the item is cooling down or reloading.
@export var cooldown_color: Color = Color(1.0, 0.80, 0.35, 0.9)
@export var outline: bool = true

func validate() -> String:
	if size_px <= 0.0 or not is_finite(size_px):
		return "Crosshair size must be a finite positive number"
	if thickness_px <= 0.0 or not is_finite(thickness_px):
		return "Crosshair thickness must be a finite positive number"
	if gap_px < 0.0 or not is_finite(gap_px):
		return "Crosshair gap must be a finite non-negative number"
	return ""
