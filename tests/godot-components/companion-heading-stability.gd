extends SceneTree

const OldPom = preload("res://pom-v3.gd")
const OldPet = preload("res://pet-v3.gd")
const NewPom = preload("res://pom-v4.gd")
const NewPet = preload("res://pet-v4.gd")
const TICKS := 3000
const STEP := 1.0 / 60.0
var checks: Array[String] = []
var failed := false
var stage: Node3D

func verify(ok: bool, label: String) -> void:
    if ok:
        checks.append(label)
    else:
        failed = true
        push_error(label)

func _initialize() -> void:
    _run.call_deferred()

func companion(script: Script, identity: String, x: float) -> CharacterBody3D:
    var node := CharacterBody3D.new()
    node.set_script(script)
    node.entity_id = identity
    node.companion_name = "Snow"
    node.saved_position_min = Vector3(-240, -20, -300)
    node.saved_position_max = Vector3(240, 160, 80)
    node.position = Vector3(x, 0, -200)
    stage.add_child(node)
    node.set_physics_process(false)
    return node

func _run() -> void:
    var args := OS.get_cmdline_user_args()
    var mode := args[0] if not args.is_empty() else "invalid"
    verify(mode in ["baseline", "write", "read"], "known fixture mode")
    verify(DisplayServer.get_name() == "headless", "headless CPU engine")
    stage = Node3D.new()
    root.add_child(stage)
    current_scene = stage
    var floor_body := StaticBody3D.new()
    var floor_shape := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(100, 1, 100)
    floor_shape.shape = box
    floor_body.position = Vector3(0, -0.5, -200)
    floor_body.add_child(floor_shape)
    stage.add_child(floor_body)
    var player := Node3D.new()
    player.name = "Player"
    stage.add_child(player)
    await physics_frame
    var nodes := [companion(OldPom if mode == "baseline" else NewPom, "snow-pom", -10), companion(OldPet if mode == "baseline" else NewPet, "snow-pet", 10)]
    await physics_frame
    var saved: Dictionary = {}
    var evidence: Array[Dictionary] = []
    var started := Time.get_ticks_msec()
    if mode == "read":
        saved = JSON.parse_string(FileAccess.get_file_as_string("user://heading-state.json"))
        for node: CharacterBody3D in nodes:
            verify(node.restore(saved[node.entity_id]) == "", node.entity_id + ": cold process restores the existing state format")
            verify(node.snapshot() == saved[node.entity_id], node.entity_id + ": settings sourceSettings position yaw identity and counter survive exactly")
            verify(node.validate_restored_state() == "", node.entity_id + ": cold restored physics transform remains supported")
            evidence.append({"id": node.entity_id, "scale": [node.global_basis.get_scale().x, node.global_basis.get_scale().y, node.global_basis.get_scale().z], "snapshot": node.snapshot()})
    else:
        for node: CharacterBody3D in nodes:
            node.set_following(false)
            node._interaction_count = 7
            verify(node.validate_restored_state() == "", node.entity_id + ": initially supported own collider")
        # Run the actual heading method at physics cadence with the same
        # angle interpolation as following. Position stays fixed to isolate
        # basis drift from navigation/pathfinding or collision placement.
        for tick in TICKS:
            var target := sin(float(tick) * 0.017) * (PI * 0.95)
            for node: CharacterBody3D in nodes:
                var heading := wrapf(lerp_angle(node._current_heading(), target, STEP * 8.0), -PI, PI)
                node._set_heading(heading)
            await physics_frame
        for node: CharacterBody3D in nodes:
            var scale_value := node.global_basis.get_scale()
            var problem: String = node.validate_restored_state()
            var error := maxf(absf(scale_value.x - 1), maxf(absf(scale_value.y - 1), absf(scale_value.z - 1)))
            evidence.append({"id": node.entity_id, "scale": [scale_value.x, scale_value.y, scale_value.z], "maxScaleError": error, "restoreCheck": problem})
            if mode == "baseline":
                verify(problem == "PET_RESTORE_TRANSFORM_UNSUPPORTED", node.entity_id + ": released v3 reproduces transform drift rejection")
            else:
                verify(error < 0.000001, node.entity_id + ": v4 retains unit scale after 3000 turns")
                verify(problem == "", node.entity_id + ": v4 long-turn transform passes unchanged restore guard")
                saved[node.entity_id] = node.snapshot()
                verify(node.validate_state(saved[node.entity_id]) == "", node.entity_id + ": save remains valid at city coordinates")
        if mode == "write":
            var file := FileAccess.open("user://heading-state.json", FileAccess.WRITE)
            verify(file != null, "isolated save opened")
            if file != null:
                file.store_string(JSON.stringify(saved))
                file.close()
    if mode != "baseline":
        for node: CharacterBody3D in nodes:
            node._shape.scale = Vector3(1.1, 1, 1)
            verify(node.validate_restored_state() == "PET_RESTORE_TRANSFORM_UNSUPPORTED", node.entity_id + ": invalid child collider scale is still rejected")
            node._shape.scale = Vector3.ONE
            var invalid: Dictionary = node.snapshot()
            invalid.position[2] = -301
            verify(node.validate_state(invalid) == "PET_STATE_POSITION_INVALID", node.entity_id + ": explicit world bounds remain enforced")
    print("COMPANION_HEADING_TEST=" + JSON.stringify({"ok": not failed, "headless": DisplayServer.get_name() == "headless", "mode": mode, "ticks": 0 if mode == "read" else TICKS, "simulatedSeconds": 0 if mode == "read" else TICKS * STEP, "elapsedMs": Time.get_ticks_msec() - started, "checks": checks, "evidence": evidence}))
    quit(1 if failed else 0)
