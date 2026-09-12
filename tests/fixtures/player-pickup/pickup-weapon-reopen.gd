extends SceneTree
func frames(count: int) -> void:
 for _i in count: await process_frame
func _initialize() -> void: call_deferred("run")
func run() -> void:
 change_scene_to_file("res://scenes/creation.tscn")
 await scene_changed
 var world: Node = current_scene
 var player: Node = world.get_node("Player")
 player.set("capture_mouse_on_click",false)
 await frames(10)
 paused = true
 var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://pickup-weapon-progress.json"))
 var adapter: RefCounted = load("res://craftmine_shared/base_adapter.gd").new()
 var binding: String = adapter.bind_world("world-2e4f85375427")
 var error: String = await adapter.restore(saved)
 var actual: Dictionary = JSON.parse_string(JSON.stringify(adapter.capture()))
 paused = false
 await frames(10)
 var weapon: Node = player.get_node("CameraRig/PitchPivot/Camera3D/WeaponMount/AK47")
 var before: Dictionary = world.inventory.duplicate(true)
 var event := InputEventAction.new()
 event.action = "interact"
 event.pressed = true
 root.push_input(event)
 await frames(2)
 event = InputEventAction.new()
 event.action = "interact"
 event.pressed = false
 root.push_input(event)
 await frames(2)
 var passed: bool = binding=="" and error=="" and actual==saved and before==world.inventory and weapon.equipped and not world.get_node("AK47Pickup").visible and Input.mouse_mode==Input.MOUSE_MODE_VISIBLE
 print("PICKUP_WEAPON_REOPEN="+JSON.stringify({"passed":passed,"restoreError":error,"savedSnapshot":saved,"restoredSnapshot":actual,"beforeRepeatedE":before,"afterRepeatedE":world.inventory,"weapon":weapon.state(),"mouseMode":Input.mouse_mode}))
 quit(0)
