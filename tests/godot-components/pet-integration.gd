extends SceneTree

var checks := []
var evidence := {}
var config: Dictionary
var world: Node3D
var runtime: Node

func _initialize() -> void:
 call_deferred("run")

func check(value: bool, name: String) -> void:
 if not value:
  evidence.error = name
  write_result()
  push_error(name)
  quit(1)
  assert(value, name)
 checks.append(name)

func write_result() -> void:
 evidence.checks = checks
 evidence.ok = not evidence.has("error")
 var file := FileAccess.open(config.output, FileAccess.WRITE)
 file.store_string(JSON.stringify(evidence))

func request(op: String, args := {}) -> Dictionary:
 var reply: Dictionary = await runtime.handle_request({"op":op,"args":args,"worldId":"pet-integration","buildId":config.buildId,"instanceId":config.instanceId})
 reply = JSON.parse_string(JSON.stringify(reply))
 check(not reply.has("error"), "bridge " + op + ": " + str(reply.get("error", "ok")))
 return reply.result

func aim(pet: Node3D) -> void:
 var camera: Camera3D = world.get_node("Player/CameraRig/PitchPivot/Camera3D")
 var center: Vector3 = pet.get_node("CollisionShape3D").global_position
 var delta := center - camera.global_position
 var yaw := atan2(-delta.x, -delta.z)
 var pitch := atan2(delta.y, Vector2(delta.x, delta.z).length())
 await request("look", {"yaw":yaw,"pitch":pitch})
 evidence.aim = {"camera":array(camera.global_position),"actualPetCenter":array(center),"yaw":yaw,"pitch":pitch}

func array(value: Vector3) -> Array:
 return [value.x,value.y,value.z]

func run() -> void:
 config = JSON.parse_string(FileAccess.get_file_as_string("res://probe-config.json"))
 evidence = {"phase":config.phase,"modelCalls":0,"physicalInputSent":false,"hardwareEVerified":false}
 world = load("res://pet-world.tscn").instantiate()
 root.add_child(world)
 current_scene = world
 runtime = root.get_node("CraftmineRuntime")
 for frame in 300:
  await process_frame
  if runtime.initialized:
   break
 check(runtime.initialized, "real runtime bridge ready")
 var first := world.get_node("FirstPet")
 var second := world.get_node("SecondPet")
 check(first.entity_id == "pet-first" and second.entity_id == "pet-second", "two independent declared instance identities")
 check(first.configuration_error.is_empty() and second.configuration_error.is_empty(), "both original packaged components configured")
 check(first.get_node("VisualPivot").get_child_count() == 1 and second.get_node("VisualPivot").get_child_count() == 1, "both real packaged visual scenes instantiated")
 var args := {}
 if config.has("stateFile"):
  args.state = JSON.parse_string(FileAccess.get_file_as_string(config.stateFile))
 var loaded := await request("load", args)
 evidence.loaded = loaded.snapshot.state
 if config.phase == "gameplay":
  await request("resume")
  evidence.beforeWalk = (await request("snapshot")).state
  await request("look", {"yaw":0.0,"pitch":0.0})
  await request("walk", {"forward":1.0,"right":0.0,"frames":90})
  await request("wait", {"frames":180})
  evidence.afterWalk = (await request("snapshot")).state
  var before: Dictionary = evidence.beforeWalk.body.components
  var after: Dictionary = evidence.afterWalk.body.components
  for id in ["pet-first", "pet-second"]:
   check(Vector3(after[id].position[0],after[id].position[1],after[id].position[2]).distance_to(Vector3(before[id].position[0],before[id].position[1],before[id].position[2])) > 0.5, id + " follows through actual physics")
  check(evidence.beforeWalk.body.player.position != evidence.afterWalk.body.player.position, "player moves through normal walk command")
  await aim(first)
  evidence.statusBefore = world.status_label.text
  evidence.interaction = await request("interact")
  check(evidence.interaction.get("interacted") == true and evidence.interaction.get("entityId") == "pet-first", "normal adapter interaction hits only aimed first companion")
  check(first.snapshot().interactionCount == 1 and second.snapshot().interactionCount == 0, "only first interaction counter changes")
  evidence.feedback = {"text":world.status_label.text,"visible":world.status_label.is_visible_in_tree()}
  check(evidence.feedback.visible and evidence.feedback.text.contains("初一") and evidence.feedback.text.contains("抚摸"), "actual HUD label displays component feedback")
  var event := InputEventAction.new()
  event.action = "interact"
  event.pressed = true
  runtime._input(event)
  check(first.snapshot().interactionCount == 2 and second.snapshot().interactionCount == 0, "normal runtime E handler dispatches to the same aimed pet without OS input")
  await request("wait", {"frames":140})
  evidence.statusAfter = world.status_label.text
  check(evidence.statusAfter == evidence.statusBefore, "HUD feedback expires and restores previous prompt")
  # Exercise the component's public runtime setting, not source defaults or DB.
  first.set_following(false)
  check(first.snapshot().sourceSettings.following and not first.snapshot().settings.following, "runtime following override differs from source default")
  await request("pause")
 elif config.phase in ["migrated", "cold"]:
  check(loaded.snapshot.state == args.state, "whole JSON progress restores exactly")
  var first_state: Dictionary = first.snapshot()
  check(first_state.settings.name == "雪球" and first_state.settings.appearanceKey == "pomeranian-white", "same first entity uses new source name and real white Pomeranian appearance")
  check(not first_state.settings.following and first_state.interactionCount == 2, "runtime following and interaction progress survive source change")
  var shape := first.get_node("CollisionShape3D").shape as CylinderShape3D
  evidence.firstCollision = {"radius":shape.radius,"height":shape.height}
  check(shape != null and is_equal_approx(shape.radius, first.pomeranian_collision_radius) and shape.radius < first.collision_radius, "loaded first appearance changes its real collision envelope")
  evidence.firstVisual = first.get_node("VisualPivot").get_child(0).scene_file_path
  evidence.secondVisual = second.get_node("VisualPivot").get_child(0).scene_file_path
  check(evidence.firstVisual.ends_with("pomeranian-white.glb") and evidence.secondVisual.ends_with("dog.glb"), "two instances reference distinct actual packaged appearances")
  check(second.snapshot() == args.state.body.components["pet-second"], "second companion keeps complete state")
 var saved := await request("save")
 check(saved.status == "confirmed" and saved.runnerReceipt.snapshotText.sha256_text() == saved.runnerReceipt.snapshotSha256 and JSON.parse_string(saved.runnerReceipt.snapshotText) == saved.state, "real bridge produces complete JSON save receipt")
 var file := FileAccess.open(config.saveFile, FileAccess.WRITE)
 file.store_string(saved.runnerReceipt.snapshotText)
 file.close()
 evidence.saved = saved.state
 evidence.saveReceipt = saved.runnerReceipt
 evidence.ok = true
 write_result()
 print("PET_INTEGRATION=" + JSON.stringify({"phase":config.phase,"checks":checks.size(),"ok":evidence.ok}))
 await request("exit")
