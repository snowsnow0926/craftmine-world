## 兼容旧世界中的静态创作显示；正式交互使用 creation-sandbox。
## 仅在候选运行时启动时读取，正式世界不轮询尚未采用的磁盘源码。
class_name CreationRenderer
extends Node3D

const PATH := "res://world/creation.json"
const HALF_EXTENTS := {"tree": Vector3(0.6, 2, 0.6), "rock": Vector3(0.7, 0.7, 0.7), "chest": Vector3(0.6, 0.55, 0.5), "door": Vector3(0.8, 1.3, 0.25), "marker": Vector3(0.3, 0.7, 0.3)}
var entities: Array[Dictionary] = []
var revision := 0

func _ready() -> void:
	_reload()

func _valid_entity(value: Variant) -> bool:
	if not value is Dictionary or not value.get("id") is String or not HALF_EXTENTS.has(value.get("kind")):
		return false
	for key in ["position", "scale"]:
		var vector: Variant = value.get(key)
		if not vector is Array or vector.size() != 3:
			return false
		for item in vector:
			if not (item is int or item is float) or not is_finite(float(item)):
				return false
	for item in value.scale:
		if item < 0.25 or item > 4: return false
	var angle: Variant = value.get("rotationY")
	return (angle is int or angle is float) and is_finite(float(angle)) and absf(float(angle)) <= 180 and value.get("color") is String and Color.html_is_valid(value.color)

func _reload() -> void:
	var file := FileAccess.open(PATH, FileAccess.READ)
	if file == null: return
	if file.get_length() > 131072:
		file.close()
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not parsed is Dictionary or parsed.get("format") != "craftmine.creation-scene/1" or not parsed.get("entities") is Array or parsed.entities.size() > 128: return
	for value in parsed.entities:
		if not _valid_entity(value): return
	for child in get_children():
		remove_child(child)
		child.queue_free()
	entities.clear()
	revision = int(parsed.get("revision", 0))
	for value in parsed.entities:
		var entity: Dictionary = value.duplicate(true)
		entities.append(entity)
		_add_entity(entity)

func _mesh(parent: Node3D, primitive: PrimitiveMesh, position: Vector3, color: Color) -> void:
	var node := MeshInstance3D.new()
	node.mesh = primitive
	node.position = position
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	node.material_override = material
	parent.add_child(node)

func _add_entity(entity: Dictionary) -> void:
	var anchor := Node3D.new()
	anchor.name = String(entity.id)
	add_child(anchor)
	anchor.position = Vector3(entity.position[0], entity.position[1], entity.position[2])
	anchor.scale = Vector3(entity.scale[0], entity.scale[1], entity.scale[2])
	anchor.rotation_degrees.y = float(entity.rotationY)
	var half: Vector3 = HALF_EXTENTS[entity.kind]
	var color := Color(entity.color)
	if entity.kind == "tree":
		var trunk := BoxMesh.new()
		trunk.size = Vector3(0.25, 2.2, 0.25)
		_mesh(anchor, trunk, Vector3(0, 1.1, 0), Color("715c46"))
		var crown := SphereMesh.new()
		crown.radius = half.x
		crown.height = 2
		_mesh(anchor, crown, Vector3(0, 3, 0), color)
	elif entity.kind == "rock":
		var rock := SphereMesh.new()
		rock.radius = half.x
		rock.height = half.y * 2
		_mesh(anchor, rock, Vector3(0, half.y, 0), color)
	else:
		var box := BoxMesh.new()
		box.size = half * 2
		_mesh(anchor, box, Vector3(0, half.y, 0), color)
