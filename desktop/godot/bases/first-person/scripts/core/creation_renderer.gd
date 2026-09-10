## Renders durable world/creation.json entities in the first-person world.
## Optional document: missing/invalid files leave authored scene untouched.
class_name CreationRenderer
extends Node3D

const PATH := "res://world/creation.json"
const POLL_SECONDS := 0.25
var entities: Array[Dictionary] = []
var revision := 0
var _stamp := -1
var _elapsed := 0.0

func _ready() -> void:
	_reload()

func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed < POLL_SECONDS: return
	_elapsed = 0.0
	var path := ProjectSettings.globalize_path(PATH)
	var stamp := FileAccess.get_modified_time(path) if FileAccess.file_exists(path) else 0
	if stamp != _stamp:
		_stamp = stamp
		_reload()

func _reload() -> void:
	for child in get_children(): child.queue_free()
	entities.clear()
	var file := FileAccess.open(PATH, FileAccess.READ)
	if file == null: return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not parsed is Dictionary or not parsed.get("entities") is Array: return
	revision = int(parsed.get("revision", 0))
	for value in parsed.entities:
		if value is Dictionary and value.get("id") is String and value.get("kind") is String:
			var entity: Dictionary = value.duplicate(true)
			entities.append(entity)
			_add_entity(entity)

func _add_entity(entity: Dictionary) -> void:
	var kind := String(entity.kind)
	var mesh: PrimitiveMesh
	match kind:
		"tree":
			var anchor := Node3D.new(); anchor.name = String(entity.id); add_child(anchor); _set_transform(anchor, entity)
			var trunk := MeshInstance3D.new(); var trunk_mesh := BoxMesh.new(); trunk_mesh.size = Vector3(0.35, 1.2, 0.35); trunk.mesh = trunk_mesh; trunk.position = Vector3(0, 0.6, 0); trunk.material_override = _material(Color("#76502f")); anchor.add_child(trunk)
			var crown := MeshInstance3D.new(); var crown_mesh := SphereMesh.new(); crown_mesh.height = 2.2; crown_mesh.radius = 1.0; crown.mesh = crown_mesh; crown.position = Vector3(0, 1.8, 0); crown.material_override = _material(_color(entity, Color("#84A866"))); anchor.add_child(crown); return
		"rock": mesh = SphereMesh.new()
		"chest": mesh = BoxMesh.new()
		"door": mesh = BoxMesh.new()
		_: mesh = CylinderMesh.new()
	var node := MeshInstance3D.new(); node.name = String(entity.id); node.mesh = mesh; node.material_override = _material(_color(entity, Color("#84A866"))); add_child(node); _set_transform(node, entity)

func _set_transform(node: Node3D, entity: Dictionary) -> void:
	var p: Variant = entity.get("position", [0, 0, 0]); if p is Array and p.size() == 3: node.position = Vector3(float(p[0]), float(p[1]), float(p[2]))
	var s: Variant = entity.get("scale", [1, 1, 1]); if s is Array and s.size() == 3: node.scale = Vector3(float(s[0]), float(s[1]), float(s[2]))
	node.rotation_degrees.y = float(entity.get("rotationY", 0.0))

func _color(entity: Dictionary, fallback: Color) -> Color:
	var value := String(entity.get("color", "")); return Color(value) if value.begins_with("#") else fallback

func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new(); material.albedo_color = color; return material
