extends Node2D

# Fixed authored integration fixture. No keyboard or mouse injection is used.
var player := CharacterBody2D.new()
var shop := Area2D.new()
var coins := 20
var apples := 0
var price := 5
var approach_shop := false

func add_shape(body: CollisionObject2D, color: Color) -> void:
	var collision := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(32, 32)
	collision.shape = shape
	body.add_child(collision)
	var sprite := Polygon2D.new()
	sprite.polygon = PackedVector2Array([Vector2(-16, -16), Vector2(16, -16), Vector2(16, 16), Vector2(-16, 16)])
	sprite.color = color
	body.add_child(sprite)

func _ready() -> void:
	add_child(player)
	player.position = Vector2(80, 150)
	add_shape(player, Color(0.8, 0.85, 0.4))
	add_child(shop)
	shop.position = Vector2(160, 150)
	add_shape(shop, Color(0.7, 0.35, 0.25))
	if OS.has_feature("web"):
		add_child(load("res://web_bridge.gd").new())
	if OS.get_cmdline_user_args().has("--restore"):
		var file := FileAccess.open("user://progress.json", FileAccess.READ)
		if file == null:
			push_error("Probe progress is missing")
			get_tree().quit(2)
			return
		var saved: Dictionary = JSON.parse_string(file.get_as_text())
		coins = int(saved.coins)
		apples = int(saved.apples)
		player.position = Vector2(saved.position[0], saved.position[1])
	if OS.get_cmdline_user_args().has("--gd0-probe"):
		run_probe()

func _physics_process(_delta: float) -> void:
	player.velocity = Vector2.ZERO
	if approach_shop and player.position.x < 150:
		player.velocity = Vector2(120, 0)
	player.move_and_slide()

func buy() -> bool:
	if not shop.overlaps_body(player) or coins < price:
		return false
	coins -= price
	apples += 1
	return true

func web_snapshot() -> Dictionary:
	var viewport_size := get_viewport().get_visible_rect().size
	return {"base": "top-down", "state": {"coins": coins, "apples": apples, "position": [player.position.x, player.position.y]},
		"physicalShopOverlap": shop.overlaps_body(player), "price": price, "viewportSize": [viewport_size.x, viewport_size.y], "persistentStorage": OS.is_userfs_persistent()}


func finite_number(value: Variant, minimum: float, maximum: float, integer := false) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and float(value) >= minimum and float(value) <= maximum and (not integer or float(value) == floorf(float(value)))

func restore_web_state(saved: Variant) -> Dictionary:
	if not saved is Dictionary or not finite_number(saved.get("coins"), 0, 20, true) or not finite_number(saved.get("apples"), 0, 4, true) or not saved.get("position") is Array or saved.position.size() != 2:
		return {"error": "Progress is invalid"}
	if not finite_number(saved.position[0], 0, 800) or not finite_number(saved.position[1], 0, 600):
		return {"error": "Progress is invalid"}
	coins = int(saved.coins)
	apples = int(saved.apples)
	player.position = Vector2(saved.position[0], saved.position[1])
	for step in range(3):
		await get_tree().physics_frame
	return {"result": web_snapshot()}

func web_command(op: String, args: Dictionary) -> Dictionary:
	match op:
		"snapshot":
			return {"result": web_snapshot()}
		"approach":
			approach_shop = true
			for step in range(48):
				await get_tree().physics_frame
			approach_shop = false
		"buy":
			return {"result": {"purchased": buy(), "snapshot": web_snapshot()}}
		"save":
			var failure: String = get_node("WebBridge").write_progress(web_snapshot().state)
			if not failure.is_empty():
				return {"error": failure}
			return {"result": {"written": true, "snapshot": web_snapshot()}}
		"restore":
			var loaded: Dictionary = get_node("WebBridge").read_progress()
			if loaded.has("error"):
				return loaded
			return await restore_web_state(loaded.state)
		"restore-state":
			return await restore_web_state(args.get("state"))
		_:
			return {"error": "Unsupported probe operation: " + op}
	return {"result": web_snapshot()}

func run_probe() -> void:
	await get_tree().physics_frame
	await get_tree().physics_frame
	await get_tree().physics_frame
	var interaction := shop.overlaps_body(player)
	var rejected_outside := true
	if not OS.get_cmdline_user_args().has("--restore"):
		rejected_outside = not buy()
		approach_shop = true
		for step in range(48):
			await get_tree().physics_frame
		approach_shop = false
		interaction = buy()
	var progress := {"coins": coins, "apples": apples, "position": [player.position.x, player.position.y]}
	var file := FileAccess.open("user://progress.json", FileAccess.WRITE)
	if file == null:
		get_tree().quit(3)
		return
	file.store_string(JSON.stringify(progress))
	file.close()
	print("CRAFTMINE_GD0=" + JSON.stringify({"base": "top-down", "headless": DisplayServer.get_name() == "headless", "outsidePurchaseRejected": rejected_outside, "physicalShopOverlap": shop.overlaps_body(player), "purchase": interaction, "state": progress}))
	get_tree().quit()
