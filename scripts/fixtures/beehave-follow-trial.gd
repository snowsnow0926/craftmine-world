extends Node3D
# Developer fixture. The target schedule is setup, never evidence of player input.
# Beehave supplies scheduling/interruption; these leaf actions supply movement.
class HasTarget:
	extends ConditionLeaf
	func tick(_actor: Node, board: Blackboard) -> int:
		return SUCCESS if board.get_value("target_valid", false) and is_instance_valid(board.get_value("target")) else FAILURE

class Follow:
	extends ActionLeaf
	var moves := 0
	var interrupts := 0
	func tick(actor: Node, board: Blackboard) -> int:
		var body := actor as CharacterBody3D
		var target := board.get_value("target") as Node3D
		var offset := target.global_position - body.global_position
		offset.y = 0.0
		if offset.length() <= 0.51:
			body.velocity = Vector3.ZERO
			return SUCCESS
		body.velocity = offset.normalized() * minf(2.0, (offset.length() - 0.5) / body.get_physics_process_delta_time())
		body.move_and_slide()
		moves += 1
		return RUNNING
	func interrupt(actor: Node, board: Blackboard) -> void:
		(actor as CharacterBody3D).velocity = Vector3.ZERO
		interrupts += 1
		super.interrupt(actor, board)

class Stop:
	extends ActionLeaf
	func tick(actor: Node, _board: Blackboard) -> int:
		(actor as CharacterBody3D).velocity = Vector3.ZERO
		return SUCCESS

var tick_index := 0
var followers: Array[Dictionary] = []
var samples: Array[Dictionary] = []
var events: Array[Dictionary] = []

func box(parent: Node3D, size: Vector3, color: Color) -> void:
	var mesh := MeshInstance3D.new()
	var shape := BoxMesh.new()
	shape.size = size
	mesh.mesh = shape
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	mesh.material_override = material
	parent.add_child(mesh)

func follower(id: String, z: float, valid: bool) -> Dictionary:
	var actor := CharacterBody3D.new()
	actor.name = id
	actor.position = Vector3(0, 0.5, z)
	add_child(actor)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(0.5, 1, 0.5)
	collision.shape = shape
	actor.add_child(collision)
	box(actor, shape.size, Color(0.1, 0.65, 0.95))
	var target := Node3D.new()
	target.name = id + "Target"
	target.position = Vector3(4, 0.5, z)
	add_child(target)
	box(target, Vector3(0.3, 0.6, 0.3), Color(0.95, 0.7, 0.1))
	var tree := BeehaveTree.new()
	tree.name = "Behavior"
	tree.actor = actor
	var selector := SelectorReactiveComposite.new()
	var sequence := SequenceReactiveComposite.new()
	var action := Follow.new()
	sequence.add_child(HasTarget.new())
	sequence.add_child(action)
	selector.add_child(sequence)
	selector.add_child(Stop.new())
	tree.add_child(selector)
	actor.add_child(tree)
	tree.blackboard.set_value("target", target)
	tree.blackboard.set_value("target_valid", valid)
	return {"id": id, "actor": actor, "target": target, "tree": tree, "action": action}

func _ready() -> void:
	var camera := Camera3D.new()
	camera.position = Vector3(5, 10, 13)
	add_child(camera)
	camera.look_at(Vector3(3, 0, 2.5))
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-60, -20, 0)
	add_child(light)
	var floor_mesh := Node3D.new()
	floor_mesh.position = Vector3(3, -0.1, 2.5)
	add_child(floor_mesh)
	box(floor_mesh, Vector3(11, 0.1, 9), Color(0.2, 0.25, 0.3))
	var wall := StaticBody3D.new()
	wall.position = Vector3(1.5, 0.6, 3)
	add_child(wall)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(0.5, 1.2, 2)
	collision.shape = shape
	wall.add_child(collision)
	box(wall, shape.size, Color(0.8, 0.25, 0.2))
	followers.append(follower("follow", 0, true))
	followers.append(follower("blocked", 3, true))
	followers.append(follower("missing", 6, false))
	sample("initial-setup")

func vec(value: Vector3) -> Array:
	return [value.x, value.y, value.z]

func sample(phase: String) -> void:
	var actors: Array[Dictionary] = []
	for entry in followers:
		var actor := entry.actor as CharacterBody3D
		var target := entry.target as Node3D
		var tree := entry.tree as BeehaveTree
		var action := entry.action as Follow
		actors.append({"id": entry.id, "position": vec(actor.global_position), "velocity": vec(actor.velocity), "target": vec(target.global_position), "targetValid": tree.blackboard.get_value("target_valid"), "enabled": tree.enabled, "status": tree.status, "moves": action.moves, "interrupts": action.interrupts, "collisions": actor.get_slide_collision_count()})
	samples.append({"tick": tick_index, "phase": phase, "actors": actors})

func _physics_process(_delta: float) -> void:
	tick_index += 1
	var entry := followers[0]
	if tick_index == 181:
		entry.target.position.x = 7.0
		events.append({"tick": tick_index, "setup": "target moves from x4 to x7"})
	if tick_index == 211:
		entry.tree.blackboard.set_value("target_valid", false)
		events.append({"tick": tick_index, "setup": "target revoked"})
	if tick_index == 231:
		entry.tree.blackboard.set_value("target_valid", true)
		events.append({"tick": tick_index, "setup": "target restored; resume before disable"})
	if tick_index == 241:
		entry.tree.disable()
		events.append({"tick": tick_index, "setup": "disable actively moving tree"})
	if tick_index == 271:
		entry.tree.enable()
		events.append({"tick": tick_index, "setup": "tree re-enabled"})
	# Parent samples before child ticks; stop comparisons start after transition tick.
	sample("physics")
	if tick_index == 390:
		for follower_entry in followers:
			follower_entry.tree.disable()
		set_physics_process(false)
		print("BEEHAVE_TRIAL=" + JSON.stringify({"format": "craftmine.beehave-follow-trace/1", "physicsHz": Engine.physics_ticks_per_second, "events": events, "samples": samples}))
