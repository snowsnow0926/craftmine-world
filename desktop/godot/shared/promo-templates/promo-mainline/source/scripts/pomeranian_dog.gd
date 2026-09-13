extends "res://scripts/pet_dog.gd"

# Same pet, movement, controls, persistence format and collider.
# Only the supplied Pomeranian visual and its animation adapter are different.
# The pinned digest covers scene/script lifecycle, but has no spatial-shader
# entry; the shader is separately subject to the managed engine build/check.
const POM_MOTION: Shader = preload("res://shaders/pomeranian_motion.gdshader")
var pom_materials: Array[ShaderMaterial] = []
var pom_walk := 0.0

func _ready() -> void:
	world = get_parent() as Node3D
	player = world.get_node("Player") as CharacterBody3D
	add_to_group("craftmine_persistent_components")
	set_meta("entity_id", entity_id)
	gravity = float(ProjectSettings.get_setting("physics/3d/default_gravity", 9.8))
	_prepare_pomeranian()
	call_deferred("_setup_hud")

func _setup_hud() -> void:
	super._setup_hud()
	name_tag.position.y = 1.04
	name_tag.font_size = 24
	name_tag.pixel_size = 0.004

func _prepare_pomeranian() -> void:
	var visual: Node3D = $Visual
	var model: Node3D = $Visual/Pomeranian
	# The supplied GLB faces +Z after its Blender -Y export. Match the
	# controller's existing -Z forward without changing saved actor yaw.
	model.rotation.y = PI
	var meshes: Array[Node] = model.find_children("*", "MeshInstance3D", true, false)
	if meshes.is_empty():
		push_error("Pomeranian asset contains no meshes")
		return
	var bounds := AABB()
	var found := false
	for node in meshes:
		var mesh: MeshInstance3D = node as MeshInstance3D
		if mesh.mesh == null: continue
		var to_visual: Transform3D = visual.global_transform.affine_inverse() * mesh.global_transform
		var box: AABB = to_visual * mesh.get_aabb()
		bounds = bounds.merge(box) if found else box
		found = true
	if not found or bounds.size.y < 0.001:
		push_error("Pomeranian asset has invalid visual bounds")
		return
	# Normalize actual composed mesh bounds, not an assumed GLB unit scale.
	var factor := 0.9 / bounds.size.y
	var center := bounds.position + bounds.size * 0.5
	model.scale *= factor
	model.position += Vector3(-center.x, -bounds.position.y, -center.z) * factor
	for node in meshes:
		var mesh: MeshInstance3D = node as MeshInstance3D
		if mesh.mesh == null: continue
		var to_visual: Transform3D = visual.global_transform.affine_inverse() * mesh.global_transform
		# Small GPU deformation keeps the continuous coat and paws together.
		# Retain every supplied surface's colour, roughness and normal texture.
		for surface in range(mesh.mesh.get_surface_count()):
			var original: BaseMaterial3D = mesh.get_active_material(surface) as BaseMaterial3D
			if original == null:
				push_error("Pomeranian surface has no supported source material")
				continue
			var material := ShaderMaterial.new()
			material.shader = POM_MOTION
			material.set_shader_parameter("mesh_to_pet", to_visual)
			material.set_shader_parameter("pet_to_mesh", to_visual.affine_inverse())
			material.set_shader_parameter("base_color", original.albedo_color)
			material.set_shader_parameter("surface_roughness", original.roughness)
			material.set_shader_parameter("surface_specular", original.metallic_specular)
			material.set_shader_parameter("use_albedo_texture", original.albedo_texture != null)
			if original.albedo_texture != null:
				material.set_shader_parameter("albedo_texture", original.albedo_texture)
			material.set_shader_parameter("use_normal_texture", original.normal_enabled and original.normal_texture != null)
			if original.normal_texture != null:
				material.set_shader_parameter("coat_normal", original.normal_texture)
				material.set_shader_parameter("normal_strength", original.normal_scale)
			mesh.set_surface_override_material(surface, material)
			pom_materials.append(material)
		mesh.extra_cull_margin = 0.25

func _animate(speed: float, distance: float, delta: float) -> void:
	pom_walk = move_toward(pom_walk, minf(1.0, speed / 3.0), delta * 8.0)
	for material in pom_materials:
		material.set_shader_parameter("walk_amount", pom_walk)
		material.set_shader_parameter("stride_phase", phase * (10.0 if speed < 5.0 else 15.0))
		material.set_shader_parameter("wag_phase", phase * (14.0 if pat_time > 0.0 else 7.0))
		material.set_shader_parameter("wag_amount", 1.0 if distance < 4.0 or pat_time > 0.0 else 0.35)
		material.set_shader_parameter("pat_amount", sin(phase * 4.0) * 0.016 if pat_time > 0.0 else 0.0)
