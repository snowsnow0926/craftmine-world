# A gatherable patch. `gather()` requires a real overlap with the patch and
# records how many charges were used in persistent state, so a restart cannot be
# used to farm the same patch.
class_name GatherZone
extends TopDownZone

@export var item_id: String = ""
@export var amount_per_gather: int = 1
@export var max_charges: int = 5


func charges_used() -> int:
	return int(Game.state.flags.get(_flag_key(), 0))


func charges_left() -> int:
	return maxi(0, max_charges - charges_used())


func gather(actor: Node) -> Dictionary:
	if not contains(actor):
		return {"ok": false, "reason": "out_of_range", "zoneId": zone_id}
	if item_id.is_empty():
		return {"ok": false, "reason": "zone_has_nothing", "zoneId": zone_id}
	if charges_left() <= 0:
		return {"ok": false, "reason": "depleted", "zoneId": zone_id, "chargesLeft": 0}
	Game.state.add_item(item_id, amount_per_gather)
	Game.state.flags[_flag_key()] = charges_used() + 1
	Game.mark_dirty()
	return {
		"ok": true,
		"zoneId": zone_id,
		"itemId": item_id,
		"amount": amount_per_gather,
		"inventory": Game.state.count_of(item_id),
		"chargesLeft": charges_left(),
	}


func _flag_key() -> String:
	return "zone.%s.gathered" % zone_id
