extends SceneTree
var checks: Array = []
var facts: Dictionary = {}
func check(label: String, ok: bool) -> void:
 checks.append({"label":label,"passed":ok})
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
 var adapter: RefCounted = load("res://craftmine_shared/base_adapter.gd").new()
 check("exact original world identity binds",adapter.bind_world("world-2e4f85375427")=="")
 var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://acceptance-input-snapshot.json"))
 var restore_error: String = await adapter.restore(saved)
 check("original packaged snapshot restores through actual adapter",restore_error=="")
 facts.restoreError = restore_error
 var weapon: Node = player.get_node("CameraRig/PitchPivot/Camera3D/WeaponMount/AK47")
 var pickup: Node = world.get_node("AK47Pickup")
 paused = false
 player.set("input_enabled",true)
 await frames(10)
 facts.initial = weapon.state()
 check("loaded inventory equips actual mounted weapon",weapon.equipped and weapon.model.visible)
 check("restored pickup stays hidden",not pickup.visible)
 var initial_mag: int = weapon.in_magazine()
 var initial_reserve: int = weapon.reserve()
 Input.action_press("fire")
 await frames(2)
 facts.first = weapon.state()
 check("normal engine fire action consumes a round",weapon.in_magazine()==initial_mag-1)
 check("firing creates actual flash and tracer",weapon.get("_flash").visible and weapon.get("_tracer")!=null)
 await frames(1)
 check("held trigger respects cooldown",weapon.in_magazine()==initial_mag-1)
 await frames(20)
 Input.action_release("fire")
 var spent: int = initial_mag-weapon.in_magazine()
 check("held trigger repeats shots",spent>=3)
 facts.burst = weapon.state()
 Input.action_press("reload")
 await frames(1)
 Input.action_release("reload")
 check("normal reload input starts timed reload",weapon.reloading)
 await frames(145)
 facts.reloaded = weapon.state()
 check("reload transfers reserve without creating ammo",weapon.in_magazine()==30 and weapon.reserve()==initial_reserve-spent)
 player.set("input_enabled",false)
 var before_blocked: Dictionary = weapon.state()
 Input.action_press("fire")
 await frames(20)
 Input.action_release("fire")
 check("disabled gameplay input blocks weapon trigger",weapon.in_magazine()==before_blocked.inMagazine)
 player.set("input_enabled",true)
 paused = true
 Input.action_press("fire")
 await frames(20)
 Input.action_release("fire")
 check("paused scene blocks weapon trigger",weapon.in_magazine()==before_blocked.inMagazine)
 paused = false
 Input.action_press("fire")
 await frames(2)
 Input.action_release("fire")
 await frames(2)
 paused = true
 var persisted: Dictionary = adapter.capture()
 facts.persistedSnapshot = persisted
 facts.persistedWeapon = weapon.state()
 check("actual save captures noninitial inventory",adapter.capture_error()=="" and weapon.in_magazine()<30 and weapon.reserve()<initial_reserve)
 var file := FileAccess.open("user://pickup-weapon-progress.json",FileAccess.WRITE)
 file.store_string(JSON.stringify(persisted))
 file.close()
 check("never requested pointer capture",Input.mouse_mode==Input.MOUSE_MODE_VISIBLE)
 print("PICKUP_WEAPON_PROOF="+JSON.stringify({"checks":checks,"facts":facts}))
 quit(0)
