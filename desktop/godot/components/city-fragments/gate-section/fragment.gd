extends Node3D

@export var entity_id: String = ""
const Surface = preload("res://addons/cw.city.gate-section/city_surface.gdshader")
var collision_triangles := 0
var mesh_count := 0

func _ready() -> void:
	_prepare_geometry($Geometry)

func _prepare_geometry(node: Node) -> void:
	if node is MeshInstance3D:
		var mesh_node := node as MeshInstance3D
		mesh_count += 1
		if str(node.name).begins_with("Solid_") or str(node.name).begins_with("HiddenSolid_"):
			var shape := ConcavePolygonShape3D.new()
			var faces := mesh_node.mesh.get_faces()
			shape.set_faces(faces)
			shape.backface_collision = true
			collision_triangles += faces.size() / 3
			var body := StaticBody3D.new()
			body.name = "FragmentCollision"
			body.collision_layer = 1
			body.collision_mask = 0
			var collision := CollisionShape3D.new()
			collision.shape = shape
			body.add_child(collision)
			mesh_node.add_child(body)
		if str(node.name).begins_with("HiddenSolid_"):
			mesh_node.visible = false
		elif DisplayServer.get_name() != "headless":
			for index in range(mesh_node.mesh.get_surface_count()):
				var original_material := mesh_node.mesh.surface_get_material(index) as StandardMaterial3D
				if original_material == null:
					continue
				var material := ShaderMaterial.new()
				material.shader = Surface
				material.set_shader_parameter("base_color", original_material.albedo_color)
				var key := original_material.resource_name
				var kind := 0.0
				if key.begins_with("wood") or key == "trunk": kind = 1.0
				elif key.begins_with("red"): kind = 2.0
				elif key in ["iron", "edge", "gold"]: kind = 3.0
				elif key.begins_with("palm"): kind = 4.0
				elif key in ["fire", "heart"]: kind = 5.0
				elif key in ["water", "foam"]: kind = 6.0
				material.set_shader_parameter("kind", kind)
				mesh_node.set_surface_override_material(index, material)
	for child in node.get_children():
		_prepare_geometry(child)
