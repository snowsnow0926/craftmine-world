extends Node3D

var animals := {}
var players := {}
var camera: Camera3D
var bridge_callback: JavaScriptObject
var evidence := []

func vector(v: Vector3) -> Array:
 return [v.x, v.y, v.z]

func collect(node: Node, info: Dictionary) -> void:
 info.nodes += 1
 if node is Skeleton3D:
  info.skeletons += 1
 if node is MeshInstance3D:
  assert(node.mesh is ArrayMesh)
  info.meshes += 1
  var box: AABB = node.global_transform * node.mesh.get_aabb()
  info.aabb = box if not info.has("aabb") else info.aabb.merge(box)
  for surface in node.mesh.get_surface_count():
   info.triangles += node.mesh.surface_get_array_len(surface) / 3
   assert(node.get_active_material(surface) is StandardMaterial3D)
   if not RenderingServer.mesh_get_surface(node.mesh.get_rid(), surface).get("lods", []).is_empty():
    info.lod_surfaces += 1
 for child in node.get_children():
  collect(child, info)

func transforms(node: Node) -> Dictionary:
 var values := {}
 for child in node.find_children("*", "Node3D", true, false):
  values[str(node.get_path_to(child))] = str(child.transform)
 return values

func motion_envelope(animal: Node3D, player: AnimationPlayer) -> Dictionary:
 var meshes := []
 for mesh in animal.find_children("*", "MeshInstance3D", true, false):
  var vertices := PackedVector3Array()
  for surface in mesh.mesh.get_surface_count():
   vertices.append_array(mesh.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX])
  meshes.append({"node":mesh, "vertices":vertices})
 var report := {"method":"all imported key times, adjacent-key midpoints and uniform 1/240 second samples", "visualPivot":"identity", "rootRotation":"local model axes; no world-axis claim", "axisMin":[INF,INF,INF], "axisMax":[-INF,-INF,-INF], "radiusMax":0.0, "yMin":INF, "yMax":-INF, "clips":[], "vertexSamples":0}
 for clip in ["idle", "walk"]:
  var animation: Animation = player.get_animation(clip)
  var key_times := {0.0:true, animation.length:true}
  for track in animation.get_track_count():
   for key in animation.track_get_key_count(track):
    key_times[animation.track_get_key_time(track, key)] = true
  var sorted_keys := key_times.keys()
  sorted_keys.sort()
  var times := key_times.duplicate()
  for i in range(sorted_keys.size() - 1):
   times[(sorted_keys[i] + sorted_keys[i+1]) / 2.0] = true
  for i in range(int(ceil(animation.length * 240)) + 1):
   times[minf(float(i) / 240.0, animation.length)] = true
  var ordered := times.keys()
  ordered.sort()
  var sampled := {"clip":clip,"samples":ordered.size(),"originalKeyTimes":sorted_keys.size(),"radiusMax":0.0,"yMin":INF,"yMax":-INF}
  player.play(clip)
  for time in ordered:
   player.seek(time, true)
   for entry in meshes:
    var transform: Transform3D = entry.node.global_transform
    for vertex in entry.vertices:
     var point: Vector3 = transform * vertex
     var radius := Vector2(point.x, point.z).length()
     for axis in 3:
      report.axisMin[axis] = minf(report.axisMin[axis], point[axis])
      report.axisMax[axis] = maxf(report.axisMax[axis], point[axis])
     sampled.radiusMax = maxf(sampled.radiusMax, radius)
     sampled.yMin = minf(sampled.yMin, point.y)
     sampled.yMax = maxf(sampled.yMax, point.y)
     report.vertexSamples += 1
  report.radiusMax = maxf(report.radiusMax, sampled.radiusMax)
  report.yMin = minf(report.yMin, sampled.yMin)
  report.yMax = maxf(report.yMax, sampled.yMax)
  report.clips.append(sampled)
 for axis in 3:
  report.axisMin[axis] = snapped(report.axisMin[axis], 0.000000001)
  report.axisMax[axis] = snapped(report.axisMax[axis], 0.000000001)
 return report

func _ready() -> void:
 for key in ["dog", "pomeranian-white"]:
  var packed: PackedScene = load("res://models/" + key + ".glb")
  assert(packed != null)
  var animal: Node3D = packed.instantiate()
  add_child(animal)
  animals[key] = animal
  var found := animal.find_children("*", "AnimationPlayer", true, false)
  assert(found.size() == 1)
  var player: AnimationPlayer = found[0]
  players[key] = player
  var info := {"key":key, "nodes":0, "meshes":0, "triangles":0, "skeletons":0, "lod_surfaces":0, "animations":[]}
  collect(animal, info)
  var bounds: AABB = info.aabb
  info.aabb = {"min":vector(bounds.position), "size":vector(bounds.size)}
  assert(absf(bounds.position.y) < 0.0001)
  assert(info.skeletons == 0 and info.lod_surfaces == 0)
  for clip in ["idle", "walk"]:
   assert(player.has_animation(clip))
   var animation: Animation = player.get_animation(clip)
   assert(animation.length > 0.0 and animation.get_track_count() > 0)
   player.play(clip)
   player.seek(0.0, true)
   var start := transforms(animal)
   player.seek(animation.length * 0.25, true)
   var quarter := transforms(animal)
   assert(start != quarter, "Imported animation must actually change node transforms")
   info.animations.append({"name":clip, "length":animation.length, "tracks":animation.get_track_count(), "nodeTransformsChanged":true, "importedLoopMode":animation.loop_mode})
   player.stop()
  if not OS.has_feature("web"):
   info.motionEnvelope = motion_envelope(animal, player)
  player.play("idle")
  player.seek(0.0, true)
  player.pause()
  animal.visible = false
  evidence.append(info)
 print("CANINE_VISUAL_IMPORT=" + JSON.stringify(evidence))
 if not OS.has_feature("web"):
  get_tree().quit()
  return
 var environment := WorldEnvironment.new()
 environment.environment = Environment.new()
 environment.environment.background_mode = Environment.BG_COLOR
 environment.environment.background_color = Color("e7ede8")
 environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
 environment.environment.ambient_light_color = Color("f1ede5")
 environment.environment.ambient_light_energy = 0.25
 environment.environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
 add_child(environment)
 var key_light := DirectionalLight3D.new()
 key_light.rotation_degrees = Vector3(-45, -30, 0)
 key_light.light_energy = 0.60
 key_light.shadow_enabled = true
 add_child(key_light)
 var fill := DirectionalLight3D.new()
 fill.rotation_degrees = Vector3(-30, 135, 0)
 fill.light_energy = 0.12
 add_child(fill)
 var ground := MeshInstance3D.new()
 ground.mesh = PlaneMesh.new()
 ground.mesh.size = Vector2(200, 200)
 var ground_material := StandardMaterial3D.new()
 ground_material.albedo_color = Color("829480")
 ground_material.roughness = 1.0
 ground.material_override = ground_material
 add_child(ground)
 camera = Camera3D.new()
 camera.fov = 30.0
 add_child(camera)
 camera.make_current()
 bridge_callback = JavaScriptBridge.create_callback(_request)
 var window := JavaScriptBridge.get_interface("window")
 window.petVisualProbe = bridge_callback
 JavaScriptBridge.eval("window.petVisualReady=true", true)

func _request(args: Array) -> void:
 var key := str(args[0])
 var angle := str(args[1])
 var clip := str(args[2])
 var phase := float(args[3])
 assert(animals.has(key) and angle in ["front", "three-quarter", "side", "rear"] and clip in ["idle", "walk"] and phase >= 0 and phase <= 1)
 for value in animals.values():
  value.visible = false
 var animal: Node3D = animals[key]
 animal.visible = true
 var player: AnimationPlayer = players[key]
 player.play(clip)
 player.seek(player.get_animation(clip).length * phase, true)
 player.pause()
 var distance := 2.7 if key == "dog" else 1.9
 var center := Vector3(0, 0.39 if key == "dog" else 0.24, 0)
 var direction: Vector3 = {"front":Vector3(0, .2, -1), "three-quarter":Vector3(.72, .38, -1), "side":Vector3(1, .22, 0), "rear":Vector3(.6, .35, 1)}[angle]
 camera.position = center + direction.normalized() * distance
 camera.look_at(center)
 JavaScriptBridge.eval("window.petVisualFrame=" + JSON.stringify({"key":key,"angle":angle,"clip":clip,"phase":phase}), true)
