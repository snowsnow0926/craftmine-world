extends SceneTree

var checks: Array[String] = []
var errors: Array[String] = []
var evidence: Array[Dictionary] = []

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, name: String) -> void:
	checks.append(name)
	if not value: errors.append(name)

func rect_inside(control: Control, viewport_size: Vector2, name: String) -> void:
	var rect := control.get_global_rect()
	check(rect.size.x > 0 and rect.size.y > 0, name + " has a nonzero layout rectangle")
	check(rect.position.x >= -0.1 and rect.position.y >= -0.1 and rect.end.x <= viewport_size.x + 0.1 and rect.end.y <= viewport_size.y + 0.1, name + " rectangle is inside actual viewport")
	evidence.append({"control":name,"viewport":[viewport_size.x,viewport_size.y],"position":[rect.position.x,rect.position.y],"size":[rect.size.x,rect.size.y],"visible":control.is_visible_in_tree()})

func run() -> void:
	root.size = Vector2i(1280, 720)
	var world := load("res://scenes/creation.tscn").instantiate() as Node3D
	var player := world.get_node("Player") as CharacterBody3D
	player.set("capture_mouse_on_click", false)
	player.set("input_enabled", false)
	for row in [["monsters","encounter.tscn"],["heavyblade","blade.tscn"],["hunt","hunt.tscn"],["ak47","rifle.tscn"]]:
		var component := load("res://addons/cw.module.promo-" + row[0] + "/" + row[1]).instantiate() as Node3D
		component.entity_id = "layout-" + row[0]
		world.add_child(component)
	root.add_child(world)
	current_scene = world
	await process_frame
	await physics_frame
	var core: Node3D = world.get_meta("craftmine_promo_context")
	var blade: Node3D = core.module("blade")
	var rifle: Node3D = core.module("rifle")
	for phase in ["ready", "active"]:
		if phase == "active":
			blade._start()
			check(blade.status == "active", "layout fixture enters actual trial")
		paused = true
		var before := [core.snapshot(),blade.snapshot(),rifle.snapshot(),core.health,core.invulnerable,core.flash_time]
		for dimensions in [Vector2i(1280,720),Vector2i(640,360),Vector2i(960,540),Vector2i(1600,900)]:
			root.size = dimensions
			await process_frame
			await process_frame
			core._update_hud()
			blade._update_hud()
			rifle._update_hud()
			await process_frame
			var actual := root.get_visible_rect().size
			check(actual == Vector2(dimensions) and actual.x > 0 and actual.y > 0, "probe uses requested nonzero actual viewport " + str(dimensions))
			check(core.hud.visible == (phase == "ready"), "encounter HUD visibility matches trial " + str(dimensions))
			for item in [[core.hud_root,"core viewport root"],[core.hud,"core health"],[core.downed_label,"core downed message"],[core.hit_cross,"core hit marker"],[core.damage_flash,"core damage overlay"],[blade.top_panel,"blade top panel"],[blade.header,"blade header"],[blade.bottom_panel,"blade bottom panel"],[blade.controls,"blade controls"],[blade.center,"blade central message"],[blade.float_number,"blade damage number"],[blade.red_screen,"blade damage overlay"],[rifle.ammo_label,"AK ammo"],[rifle.hit_marker,"AK hit marker"]]:
				rect_inside(item[0],actual,item[1] + " " + str(dimensions))
		check([core.snapshot(),blade.snapshot(),rifle.snapshot(),core.health,core.invulnerable,core.flash_time] == before, "viewport layout and resizing do not change combat state or paused timers")
		paused = false
	check(player.get("captured") == false, "HUD resize never captures input")
	print("PROMO_HUD_LAYOUT=" + JSON.stringify({"checks":checks,"errors":errors,"rects":evidence}))
	world.queue_free()
	await process_frame
	quit(0 if errors.is_empty() else 1)
