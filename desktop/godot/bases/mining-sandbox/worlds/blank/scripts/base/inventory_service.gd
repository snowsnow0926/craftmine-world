## Inventory mutations (SPEC section 4).
##
## `grant` and `consume` are the only public inventory mutations. Both honour the
## shared request ledger so a replayed request applies nothing, and both are
## wrapped by a private `_apply_*` used by drops and crafting where the ledger
## entry belongs to the outer operation.
class_name MiningInventoryService
extends RefCounted

const AIR := "air"

var state: MiningWorldState
var items: Dictionary = {}
var item_order: Array = []
var max_stack: int = 999
var ledger_limit: int = 1024


func setup(state_value: MiningWorldState, item_catalog: Array, max_stack_value: int, ledger_limit_value: int) -> void:
	state = state_value
	max_stack = maxi(1, max_stack_value)
	ledger_limit = maxi(1, ledger_limit_value)
	items.clear()
	item_order.clear()
	for entry in item_catalog:
		if entry is Dictionary and entry.get("id") is String:
			var item_id := String(entry.id)
			items[item_id] = entry
			if not item_order.has(item_id):
				item_order.append(item_id)


func item_data(item_id: String) -> Dictionary:
	var entry: Variant = items.get(item_id, {})
	return entry if entry is Dictionary else {}


## Declared per-item stack size, never above the world's `economy.maxStack`.
func stack_size(item_id: String) -> int:
	var declared := int(item_data(item_id).get("stack", max_stack))
	return clampi(declared, 1, max_stack)


func tool_tier_of(item_id: String) -> int:
	return int(item_data(item_id).get("toolTier", 0))


func count(item_id: String) -> int:
	if state == null:
		return 0
	return state.count_of(item_id)


## Highest owned tool tier. Owned tools come from the persisted `tools` list, so
## a crafted pickaxe keeps working after a restart.
func tool_tier() -> int:
	var best := 0
	if state == null:
		return best
	for tool in state.tools:
		best = maxi(best, tool_tier_of(String(tool)))
	return best


## Flat read-only report: every declared item (zero included) plus any extra item
## that holds a positive count. The probe returns this unchanged.
func report() -> Dictionary:
	var out: Dictionary = {"ok": true}
	if state == null:
		return out
	for item_id in item_order:
		out[item_id] = count(item_id)
	for item_id in state.inventory.keys():
		if not out.has(item_id):
			out[item_id] = count(String(item_id))
	return out


func grant(item_id: String, amount: int, request_id: String) -> Dictionary:
	var rid := _resolve(request_id)
	var prior := _gate(rid)
	if not prior.is_empty():
		return prior
	if amount <= 0:
		return _reject(rid, "grant", "invalid_count", {"itemId": item_id})
	if item_data(item_id).is_empty():
		return _reject(rid, "grant", "unknown_item", {"itemId": item_id})
	var overflow := _apply_grant(item_id, amount)
	var result := {
		"ok": true,
		"op": "grant",
		"itemId": item_id,
		"count": amount,
		"granted": amount - overflow,
		"overflow": overflow,
		"stackLimit": stack_size(item_id),
		"total": count(item_id),
	}
	if overflow > 0:
		result["reason"] = "stack_full"
	_record(rid, "grant", result, true)
	return result


func consume(item_id: String, amount: int, request_id: String) -> Dictionary:
	var rid := _resolve(request_id)
	var prior := _gate(rid)
	if not prior.is_empty():
		return prior
	if amount <= 0:
		return _reject(rid, "consume", "invalid_count", {"itemId": item_id})
	if count(item_id) < amount:
		return _reject(rid, "consume", "insufficient_materials", {"itemId": item_id, "required": amount, "held": count(item_id)})
	_apply_consume(item_id, amount)
	var result := {"ok": true, "op": "consume", "itemId": item_id, "count": amount, "total": count(item_id)}
	_record(rid, "consume", result, true)
	return result


## Marks a request id as cancelled. Every later use of the id is rejected with
## `cancelled_request`, even if it had been applied before.
func cancel(request_id: String) -> Dictionary:
	var rid := String(request_id)
	if rid.is_empty():
		return {"ok": false, "op": "cancel", "reason": "invalid_request_id"}
	if state == null:
		return {"ok": false, "op": "cancel", "reason": "bad_state"}
	state.ledger_record(rid, "cancel", {"ok": true, "cancelled": true}, false, ledger_limit)
	return {"ok": true, "op": "cancel", "requestId": rid, "cancelled": true}


# ------------------------------------------------------------ internal apply

## Grants what fits the stack and returns the amount that did not fit, so a caller
## reports it instead of silently discarding items. `items[].stack` and the world's
## `economy.maxStack` are both enforced here.
func _apply_grant(item_id: String, amount: int) -> int:
	if state == null or item_id.is_empty() or amount <= 0:
		return 0
	var held := count(item_id)
	var next := mini(held + amount, stack_size(item_id))
	state.inventory[item_id] = next
	if tool_tier_of(item_id) > 0 and not state.tools.has(item_id):
		state.tools.append(item_id)
		_refresh_equipped()
	return held + amount - next


func _apply_consume(item_id: String, amount: int) -> bool:
	if state == null or amount <= 0:
		return false
	var held := count(item_id)
	if held < amount:
		return false
	var left := held - amount
	if left > 0:
		state.inventory[item_id] = left
	else:
		state.inventory.erase(item_id)
	return true


func _refresh_equipped() -> void:
	if state == null:
		return
	var best := ""
	var best_tier := -1
	for tool in state.tools:
		var tier := tool_tier_of(String(tool))
		if tier > best_tier:
			best_tier = tier
			best = String(tool)
	state.equipped = best


# ------------------------------------------------------------------- ledger

func _resolve(request_id: String) -> String:
	return String(request_id)


func _gate(rid: String) -> Dictionary:
	if rid.is_empty() or state == null:
		return {}
	var entry := state.ledger_lookup(rid)
	if entry.is_empty():
		return {}
	if String(entry.get("op", "")) == "cancel":
		return {"ok": false, "reason": "cancelled_request", "duplicate": true, "requestId": rid}
	var recorded: Variant = entry.get("result", {})
	var out: Dictionary = recorded.duplicate(true) if recorded is Dictionary else {}
	out["duplicate"] = true
	out["requestId"] = rid
	return out


func _record(rid: String, op: String, result: Dictionary, applied: bool) -> void:
	if rid.is_empty() or state == null:
		return
	state.ledger_record(rid, op, result, applied, ledger_limit)


func _reject(rid: String, op: String, reason: String, extra: Dictionary = {}) -> Dictionary:
	var out: Dictionary = {"ok": false, "op": op, "reason": reason}
	for key in extra.keys():
		out[key] = extra[key]
	if not rid.is_empty():
		out["requestId"] = rid
		_record(rid, op, out.duplicate(true), false)
	return out
