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
