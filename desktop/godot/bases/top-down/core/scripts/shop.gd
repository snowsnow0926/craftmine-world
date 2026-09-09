# A shop counter. Prices and starting stock live in res://data/shops/<id>.json so
# a world author or a model can add a product without touching this script.
#
# `buy()` is the only mutation path. It re-checks the real geometric overlap with
# the buyer, so calling it from anywhere else (a probe, a stray script) fails with
# `out_of_range` instead of quietly selling.
class_name Shop
extends Interactable

@export var shop_id: String = ""

var catalog: Array = []


func _ready() -> void:
	super()
	catalog = Game.shop_catalog(shop_id)
	Game.state.ensure_shop(shop_id, catalog)


func can_interact(_actor: Node) -> bool:
	return enabled


func entry_of(item_id: String) -> Dictionary:
	for entry in catalog:
		if entry is Dictionary and String(entry.get("id", "")) == item_id:
			return entry
	return {}


func list_products() -> Array:
	var products: Array = []
	for entry in catalog:
		var item_id := String(entry.get("id", ""))
		products.append({
			"id": item_id,
			"price": int(entry.get("price", 0)),
			"stock": Game.state.stock_of(shop_id, item_id),
		})
	return products


func interact(actor: Node) -> Dictionary:
	if not in_range(actor):
		return {"ok": false, "reason": "out_of_range"}
	return {"ok": true, "entityId": entity_id, "shopId": shop_id, "products": list_products()}


func buy(item_id: String, actor: Node) -> Dictionary:
	if not enabled:
		return _reject("shop_disabled")
	if not in_range(actor):
		return _reject("out_of_range")
	var entry := entry_of(item_id)
	if entry.is_empty():
		return _reject("unknown_item")
	var stock := Game.state.stock_of(shop_id, item_id)
	if stock <= 0:
		return _reject("out_of_stock")
	var price := int(entry.get("price", 0))
	if price < 0:
		return _reject("invalid_price")
	if Game.state.coins < price:
		return _reject("not_enough_coins")

	# All checks passed: commit as one indivisible step.
	Game.state.coins -= price
	Game.state.add_item(item_id, 1)
	Game.state.set_stock(shop_id, item_id, stock - 1)
	Game.mark_dirty()

	return {
		"ok": true,
		"shopId": shop_id,
		"itemId": item_id,
		"price": price,
		"coins": Game.state.coins,
		"inventory": Game.state.count_of(item_id),
		"stock": Game.state.stock_of(shop_id, item_id),
	}


func _reject(reason: String) -> Dictionary:
	return {
		"ok": false,
		"reason": reason,
		"shopId": shop_id,
		"coins": Game.state.coins if Game.state != null else -1,
	}
