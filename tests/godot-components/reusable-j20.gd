extends SceneTree
var config: Dictionary
var evidence := {"checks":[],"modelCalls":0,"physicalInputSent":false}
var world: Node3D
var runtime: Node
var jet: Node3D

func _initialize() -> void:
	run.call_deferred()

func check(value: bool,label: String) -> void:
	if not value:
		evidence.error = label
		finish()
		push_error(label)
		quit(1)
		assert(value,label)
	evidence.checks.append(label)

func finish() -> void:
	evidence.ok = not evidence.has("error")
	var file := FileAccess.open(config.output,FileAccess.WRITE)
	file.store_string(JSON.stringify(evidence))

func request(op: String,args := {}) -> Dictionary:
	var result: Dictionary = await runtime.handle_request({"op":op,"args":args,"worldId":config.worldId,"buildId":config.buildId,"instanceId":config.instanceId})
	result = JSON.parse_string(JSON.stringify(result))
	check(not result.has("error"),"runtime " + op + ": " + str(result.get("error","ok")))
	return result.result

func controls(values: Dictionary,frames: int) -> void:
	for key in values:
		if float(values[key]) > 0.0: Input.action_press("cw_j20_"+key,float(values[key]))
	await request("wait",{"frames":frames})
	for key in values: Input.action_release("cw_j20_"+key)

func save() -> void:
	var state: Dictionary = (await request("snapshot")).state
	var reply := await request("save")
	check(reply.status == "confirmed" and reply.runnerReceipt.snapshotText.sha256_text() == reply.runnerReceipt.snapshotSha256 and JSON.parse_string(reply.runnerReceipt.snapshotText) == reply.state,"real bridge produces exact saved flight receipt")
	var file := FileAccess.open(config.saveFile,FileAccess.WRITE)
	file.store_string(reply.runnerReceipt.snapshotText)
	evidence.saved = state
	evidence.saveReply = reply

func run() -> void:
	config = JSON.parse_string(FileAccess.get_file_as_string("res://probe-config.json"))
	world = load("res://aircraft-world.tscn").instantiate()
	root.add_child(world)
	current_scene = world
	runtime = root.get_node("CraftmineRuntime")
	for frame in 300:
		await process_frame
		if runtime.initialized: break
	check(runtime.initialized,"actual managed runtime initialized")
	jet = world.get_node("FirstJet")
	var second := world.get_node("SecondJet")
	check(jet.configuration_error.is_empty() and second.configuration_error.is_empty(),"two packaged aircraft configured")
	var valid_before: Dictionary = jet.snapshot()
	var invalid := valid_before.duplicate(true)
	invalid.position = [999999.0,0.0,0.0]
	check(not jet.validate_state(invalid).is_empty() and jet.snapshot() == valid_before,"invalid saved flight state is rejected without changing live state")
	var args := {}
	if config.has("stateFile"): args.state = JSON.parse_string(FileAccess.get_file_as_string(config.stateFile))
	var loaded := await request("load",args)
	if config.phase == "stock-refused":
		check(not jet.inspect_runway().available,"stock bounded world refuses runway-dependent aircraft operation")
		finish();quit(0);return
	check(jet.inspect_runway().available,"actual authored open runway passes physical geometry checks")
	var marker_pose: Transform3D = world.get_node("ExistingStatue").transform
	var second_before: Dictionary = second.snapshot()
	if config.phase == "flight":
		await request("resume")
		await request("walk",{"forward":0.0,"right":-1.0,"frames":40})
		var player := world.get_node("Player")
		var camera: Camera3D = player.camera_rig.camera
		var offset: Vector3 = jet.global_position-camera.global_position
		await request("look",{"yaw":atan2(-offset.x,-offset.z),"pitch":atan2(offset.y,Vector2(offset.x,offset.z).length())})
		var boarded := await request("interact")
		evidence.boarded = boarded
		check(jet.piloted and player.movement_locked(),"normal component ray interaction boards actual aircraft")
		var parked_position: Vector3 = player.global_position
		check(world.get_viewport().get_camera_3d() == jet.get_node("AircraftCamera"),"active camera belongs to piloted aircraft")
		await controls({"throttle_up":1.0},400)
		evidence.acceleration = jet.telemetry()
		check(jet.airspeed > 65.0 and jet.grounded,"aircraft actually accelerates down real runway")
		await controls({"pitch_up":1.0},35)
		await controls({},25)
		evidence.takeoff = jet.telemetry()
		check(not jet.grounded and jet.global_position.y > 5.0 and not jet.crashed,"actual runway takeoff gains altitude")
		await controls({"gear":1.0},3)
		await controls({"roll_left":0.35},25)
		evidence.bank = jet.snapshot()
		check(absf(jet.bank) > 0.1 and not jet.gear_down,"actual banking and gear retraction")
		await controls({"camera":1.0},3)
		check(jet.cockpit_view,"cockpit camera toggles through ordinary scoped action")
		check(player.global_position.distance_to(parked_position) < 0.02,"on-foot body stays at actual collision-valid boarding point")
		check(not jet.exit_aircraft().interacted,"cannot exit or teleport from flying aircraft")
		check(second.snapshot() == second_before,"second aircraft remains independent while first flies")
		await request("pause")
		await save()
	elif config.phase == "reopen-flight":
		check(jet.piloted and not jet.grounded and jet.cockpit_view,"cold reopen restores airborne flight and cockpit ownership")
		check(loaded.snapshot.state == JSON.parse_string(FileAccess.get_file_as_string(config.stateFile)),"cold reopen preserves exact saved native and component state")
		# Flight controls use current telemetry to return safely; no pose, speed,
		# progress, inventory or landing counters are assigned by the harness.
		await request("resume")
		await controls({},2)
		check(world.get_viewport().get_camera_3d() == jet.get_node("AircraftCamera"),"ordinary resume activates restored aircraft camera without peer interference")
		await controls({"gear":1.0},3)
		await controls({"throttle_down":1.0,"pitch_down":1.0,"roll_right":0.35,"brake":1.0},35)
		for step in 100:
			if jet.grounded or jet.crashed: break
			var pitch_axis := clampf((-0.065-jet.pitch)*3.0,-1.0,1.0)
			var roll_axis := clampf(-jet.bank*1.2,-1.0,1.0)
			var target_heading := clampf((jet.global_position.x-jet._runway_origin.x)/200.0,-0.12,0.12)
			var rudder_axis := clampf((target_heading-jet.heading)*3.0,-1.0,1.0)
			await controls({"pitch_up" if pitch_axis>0 else "pitch_down":absf(pitch_axis),"roll_left" if roll_axis>0 else "roll_right":absf(roll_axis),"rudder_left" if rudder_axis>0 else "rudder_right":absf(rudder_axis),"throttle_up":0.13 if jet.airspeed<80 else 0.0,"throttle_down":0.5 if jet.airspeed>90 and jet.throttle>0.35 else 0.0,"brake":1.0 if jet.airspeed>100 else 0.0},30)
		evidence.landing = jet.telemetry()
		check(jet.grounded and not jet.crashed and jet.landings>=1,"actual controlled descent lands on runway")
		await controls({"throttle_down":1.0,"brake":1.0},220)
		# Taxi back to the parking origin through ordinary rudder/throttle/brakes.
		for step in 1500:
			if jet.crashed: break
			var offset: Vector3 = jet._runway_origin-jet.global_position
			var distance := Vector2(offset.x,offset.z).length()
			if distance<17.0 and jet.airspeed<0.4: break
			var target_heading := atan2(-offset.x,-offset.z)
			var error := wrapf(target_heading-jet.heading,-PI,PI)
			var desired_speed := 4.0 if absf(error)>0.35 else minf(20.0,maxf(0.0,(distance-8.0)*0.3))
			await controls({"rudder_left" if error>0 else "rudder_right":minf(1.0,absf(error)*2.0),"throttle_up":0.1 if jet.airspeed<desired_speed and jet.throttle<0.28 else 0.0,"throttle_down":1.0 if jet.airspeed>desired_speed or distance<15 else 0.0,"brake":1.0 if jet.airspeed>desired_speed+0.5 or distance<12 else 0.0},30)
		evidence.taxi = jet.telemetry()
		check(jet.exit_aircraft().interacted,"real landed taxi returns to boarding area and exits without teleport")
		check(not world.get_node("Player").movement_locked(),"aircraft releases its player movement lock on exit")
		await request("pause")
		await save()
	elif config.phase == "crash":
		await request("resume")
		await request("walk",{"forward":0.0,"right":-1.0,"frames":40})
		var player := world.get_node("Player")
		var offset: Vector3 = jet.global_position-player.camera_rig.camera.global_position
		await request("look",{"yaw":atan2(-offset.x,-offset.z),"pitch":atan2(offset.y,Vector2(offset.x,offset.z).length())})
		await request("interact")
		check(jet.piloted,"crash fixture boards through ordinary ray interaction")
		# A newly present physical obstacle exercises collision after the checked
		# runway becomes obstructed; the aircraft state is never assigned.
		var obstacle := StaticBody3D.new()
		obstacle.collision_layer = 2
		var collider := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(20,10,2)
		collider.shape = box
		obstacle.add_child(collider)
		world.add_child(obstacle)
		obstacle.position = Vector3(-6,5,-30)
		await controls({"throttle_up":1.0},300)
		check(jet.crashed and jet.global_position.z>-30,"real world-object-layer obstacle stops and crashes the moving aircraft")
		var actual_crash_pose: Vector3 = jet.global_position
		await controls({"exit":1.0},3)
		check(not jet.piloted and not player.movement_locked(),"ending crashed driving releases only the aircraft control lock")
		check(jet.global_position == actual_crash_pose,"crashed aircraft remains at its actual collision position")
		check(world.get_viewport().get_camera_3d() == player.camera_rig.camera,"crash exit restores original walking camera")
		await request("pause")
		await save()
	else:
		check(not jet.piloted and jet.grounded and jet.landings>=1,"second cold reopen retains parked state and landing history")
		check(not world.get_node("Player").movement_locked(),"cold parked reopen leaves on-foot movement available")
		check(world.get_viewport().get_camera_3d() == world.get_node("Player/CameraRig/PitchPivot/Camera3D"),"parked cold reopen uses the original player camera")
		await save()
	check(world.get_node("ExistingStatue").transform == marker_pose,"existing target-world marker is unchanged")
	finish()
	quit(0)
