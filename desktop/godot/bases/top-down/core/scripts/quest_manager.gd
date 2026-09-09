# Collect-and-deliver quests.
#
# The reward is granted at most once per world instance. Two independent ledgers
# are persisted: `quests[id].rewarded` and `grantedRewards["<id>#reward"]`. Both
# are checked before anything is consumed, and both are written before the call
# returns, so a second delivery after a full restart fails with
# `already_rewarded` and the inventory is untouched.
class_name QuestManager
extends RefCounted


static func reward_id(quest_id: String) -> String:
	return "%s#reward" % quest_id


static func deliver(quest_id: String, giver: Node, actor: Node) -> Dictionary:
	var quest: Dictionary = Game.quest_data(quest_id)
	if quest.is_empty():
		return {"ok": false, "reason": "unknown_quest", "questId": quest_id}
	if actor == null or giver == null or not (giver as Area2D).overlaps_body(actor):
		return {"ok": false, "reason": "out_of_range", "questId": quest_id}

	var state: WorldState = Game.state
	var ledger_key := reward_id(quest_id)
	if state.quest_rewarded(quest_id) or state.has_granted(ledger_key):
		return {
			"ok": false,
			"reason": "already_rewarded",
			"questId": quest_id,
			"rewardId": ledger_key,
			"coins": state.coins,
			"questStatus": state.quest_status(quest_id),
		}

	var requires: Dictionary = quest.get("requires", {})
	var item_id := String(requires.get("itemId", ""))
	var needed := int(requires.get("count", 0))
	if item_id.is_empty() or needed <= 0:
		return {"ok": false, "reason": "quest_is_misconfigured", "questId": quest_id}
	if not state.has_items(item_id, needed):
		return {
			"ok": false,
			"reason": "missing_items",
			"questId": quest_id,
			"itemId": item_id,
			"required": needed,
			"have": state.count_of(item_id),
		}

	var reward: Dictionary = quest.get("reward", {})
	var reward_coins := int(reward.get("coins", 0))
	var granted_items: Array = []

	# Single commit: consume, pay, then mark both ledgers.
	state.remove_item(item_id, needed)
	state.coins += reward_coins
	for entry in reward.get("items", []):
		if not entry is Dictionary or not entry.get("id") is String:
			continue
		var granted := int(entry.get("count", 1))
		state.add_item(String(entry.id), granted)
		granted_items.append({"id": String(entry.id), "count": granted})
	state.quests[quest_id]["rewarded"] = true
	state.quests[quest_id]["delivered"] = int(state.quests[quest_id].get("delivered", 0)) + 1
	state.set_quest_status(quest_id, "completed")
	state.mark_granted(ledger_key)
	Game.mark_dirty()

	return {
		"ok": true,
		"questId": quest_id,
		"rewardId": ledger_key,
		"consumed": {"id": item_id, "count": needed},
		"rewardCoins": reward_coins,
		"coins": state.coins,
		"grantedItems": granted_items,
		"questStatus": state.quest_status(quest_id),
	}
