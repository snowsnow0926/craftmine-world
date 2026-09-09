@tool
class_name EquipmentDefinition
extends Resource

## One piece of equipment.
##
## Everything the player sees and does while this item is active is derived from
## this single resource: the displayed model and its camera mount, the crosshair
## visibility and style, and the attack mode, damage, range, cooldown and
## ammunition. No other node keeps a second copy of "what is equipped", so a
## model that edits damage or swaps the mesh cannot desynchronise the interface.

enum AttackMode { NONE, RANGED, MELEE }

@export var id: StringName = &""
@export var display_name: String = ""
@export_multiline var description: String = ""

@export_group("Attack")
@export var attack_mode: AttackMode = AttackMode.NONE
@export var damage: float = 10.0
@export var cooldown_seconds: float = 0.4
@export var range_meters: float = 60.0
## Ranged: number of rays per shot. Melee ignores this.
@export var pellets: int = 1
## Ranged: cone half-width in degrees. Zero means a perfectly straight shot.
@export var spread_degrees: float = 0.0
## Melee: full arc width in degrees around the aim direction.
@export var melee_arc_degrees: float = 70.0
@export_flags_3d_physics var hit_mask: int = 3

@export_group("Ammunition")
## Magazine capacity. Zero means the item never consumes ammunition.
@export var magazine_size: int = 0
@export var reload_seconds: float = 1.2
## Rounds in the magazine at a fresh start. Negative means "full magazine".
@export var starting_ammo: int = -1
## Rounds held in reserve at a fresh start. Reloading draws from here.
@export var starting_reserve: int = 0

@export_group("Display")
@export var display_mesh: Mesh
@export var display_material: Material
## Position of the model under the camera. The model is a child of the camera,
## so it always follows the real camera transform.
@export var mount_offset: Vector3 = Vector3(0.24, -0.20, -0.42)
@export var mount_rotation_degrees: Vector3 = Vector3.ZERO
@export var display_scale: Vector3 = Vector3.ONE

@export_group("Interface")
@export var crosshair_visible: bool = true
@export var crosshair_style: CrosshairStyle


func uses_ammo() -> bool:
	return magazine_size > 0


func initial_ammo() -> int:
	if not uses_ammo():
		return 0
	return magazine_size if starting_ammo < 0 else clampi(starting_ammo, 0, magazine_size)


func attack_mode_name() -> String:
	return ["NONE", "RANGED", "MELEE"][int(attack_mode)]


## Returns the first problem that would make this definition unusable, or "".
func validate() -> String:
	if id.is_empty():
		return "Equipment id is empty"
	if damage < 0.0 or not is_finite(damage):
		return String(id) + ": damage must be a finite non-negative number"
	if cooldown_seconds < 0.0 or not is_finite(cooldown_seconds):
		return String(id) + ": cooldown must be a finite non-negative number"
	if range_meters <= 0.0 or not is_finite(range_meters):
		return String(id) + ": range must be a finite positive number"
	if magazine_size < 0:
		return String(id) + ": magazine size cannot be negative"
	if reload_seconds < 0.0:
		return String(id) + ": reload time cannot be negative"
	if attack_mode == AttackMode.RANGED and pellets < 1:
		return String(id) + ": a ranged item needs at least one pellet"
	if crosshair_visible and crosshair_style == null:
		return String(id) + ": a visible crosshair needs a style resource"
	return ""
