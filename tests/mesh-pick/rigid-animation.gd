extends SceneTree
const Picker = preload("res://scene_mesh_picker.gd")
var checks := 0
var failures := []
var world: Node3D
var camera: Camera3D
func _initialize(): call_deferred("run")
func check(ok: bool, detail: String):
 checks += 1
 if not ok: failures.append(detail)
func triangle_mesh() -> ArrayMesh:
 var arrays := []
 arrays.resize(Mesh.ARRAY_MAX)
 arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1,-1,0),Vector3(0,1,0),Vector3(1,-1,0)])
 var mesh := ArrayMesh.new()
 mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
 mesh.surface_set_material(0, StandardMaterial3D.new())
 return mesh
func pick(physics := {}) -> Dictionary:
 var excluded: Array[Node] = []
 return Picker.new().pick(world,camera,excluded,physics)
func run():
 world = Node3D.new()
 root.add_child(world)
 current_scene = world
 camera = Camera3D.new()
 world.add_child(camera)
 camera.current = true
 var tree := MeshInstance3D.new()
 tree.name = "StaticTreeSurface"
 tree.mesh = triangle_mesh()
 tree.position.z = -6
 world.add_child(tree)
 var pet := Node3D.new()
 pet.name = "Pet"
 world.add_child(pet)
 var joint := Node3D.new()
 joint.name = "Joint"
 pet.add_child(joint)
 var body := MeshInstance3D.new()
 body.name = "Body"
 body.mesh = triangle_mesh()
 joint.add_child(body)
 var animator := AnimationPlayer.new()
 animator.name = "AnimationPlayer"
 animator.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
 pet.add_child(animator)
 var animation := Animation.new()
 animation.length = 1.0
 var track := animation.add_track(Animation.TYPE_POSITION_3D)
 animation.track_set_path(track,NodePath("Joint"))
 animation.track_insert_key(track,0.0,Vector3(0,0,-3))
 animation.track_insert_key(track,1.0,Vector3(4,0,-3))
 var library := AnimationLibrary.new()
 library.add_animation("walk",animation)
 animator.add_animation_library("",library)
 animator.play("walk")
 animator.advance(0.0)
 await process_frame
 var result := pick()
 check(result.status == "hit" and result.get("node") == body,"actual AnimationPlayer start pose selects the pet part")
 check(result.get("position",Vector3.ZERO).distance_to(Vector3(0,0,-3)) < 0.0001,"pet hit is its actual triangle surface")
 check(result.scope == "bounded-rigid-mesh-triangles" and result.pixelAccurate == false,"coverage identifies rigid geometry without pixel-accuracy claim")
 check(result.counts.triangles == 2 and result.counts.candidates == 2,"both pet and forest geometry stay under normal shared budgets")
 var pose_time := animator.current_animation_position
 var transform_before := joint.transform
 for i in 4: pick()
 check(animator.current_animation_position == pose_time and joint.transform == transform_before,"observation never advances animation or alters pose")
 animator.advance(1.0)
 result = pick()
 check(joint.position.x > 3.9,"native animation actually moved the rigid joint")
 check(result.status == "hit" and result.get("node") == tree,"animated pet moving off ray does not disable the static tree")
 var skeleton := Skeleton3D.new()
 skeleton.add_bone("unused")
 pet.add_child(skeleton)
 check(pick().get("node") == tree,"non-rendering skeleton alone does not block the forest")
 skeleton.free()
 animator.play("walk")
 animator.seek(0,true)
 result = pick({"position":Vector3(0,0,-2)})
 check(result.status == "blocked","actual nearer physics surface still blocks pet mesh")
 tree.position.z = -2
 check(pick().get("node") == tree,"nearer forest mesh occludes pet")
 tree.position.z = -6
 var material := body.mesh.surface_get_material(0) as StandardMaterial3D
 material.cull_mode = BaseMaterial3D.CULL_FRONT
 check(pick().get("node") == tree,"animated part still obeys actual face culling")
 material.cull_mode = BaseMaterial3D.CULL_BACK
 material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
 check(pick().status == "fallback" and pick().reason == "transparent-material","transparent animated foreground is not ignored")
 material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
 body.skin = Skin.new()
 check(pick().status == "fallback" and pick().reason == "skinned-or-blend-shape-mesh","actual skin remains explicitly unsupported, never rest-pose substituted")
 body.skin = null
 var blend := triangle_mesh()
 # Blendshape count can be established only before surfaces, so use an empty
 # native shape as the explicit unsupported coverage case.
 blend = ArrayMesh.new()
 blend.add_blend_shape("mouth")
 body.mesh = blend
 check(pick().status == "fallback" and pick().reason == "skinned-or-blend-shape-mesh","blendshape is not silently rendered as a rigid part")
 body.mesh = triangle_mesh()
 var shader := Shader.new()
 shader.code = "shader_type spatial; void vertex(){VERTEX.x += 2.0;}"
 var shader_material := ShaderMaterial.new()
 shader_material.shader = shader
 body.material_override = shader_material
 check(pick().status == "fallback" and pick().reason == "custom-material","shader displacement remains unsupported")
 body.material_override = null
 joint.scale.x = -1
 check(pick().reason == "negative-scale","animated negative winding is still refused")
 joint.scale.x = 1
 body.visible = false
 check(pick().get("node") == tree,"currently invisible pet surfaces do not occlude")
 body.visible = true
 print("RIGID_ANIMATION_RESULT="+JSON.stringify({"checks":checks,"failures":failures,"headless":true,"nativeAnimationPlayer":true,"skinnedCoverage":false}))
 quit(0 if failures.is_empty() else 1)
