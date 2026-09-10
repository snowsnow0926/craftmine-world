'use strict';
const {createHash}=require('node:crypto');
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
function generateSequenceDoorRule({id,doorId,sequence}) {
  if(typeof id!=='string'||!ID.test(id)||typeof doorId!=='string'||!ID.test(doorId)||!Array.isArray(sequence)||sequence.length<2||sequence.length>16||new Set(sequence).size!==sequence.length||sequence.some(value=>typeof value!=='string'||!ID.test(value)))throw Error('CREATION_RULE_INVALID');
  // These are constrained data literals, never caller-provided source snippets.
  const script=`extends Node

# Generated source-owned sequence rule. Wrong interactions reset the sequence.
const DOOR_ID: String = ${JSON.stringify(doorId)}
const SEQUENCE: Array[String] = ${JSON.stringify(sequence)}
var _host: Node
var _cursor: int = 0
var _completed: bool = false

func configure(host: Node, _definition: Dictionary) -> void:
\t_host = host

func on_entity_interacted(entity_id: String) -> void:
\tif _completed:
\t\treturn
\tif entity_id == SEQUENCE[_cursor]:
\t\t_cursor += 1
\telse:
\t\t_cursor = 1 if entity_id == SEQUENCE[0] else 0
\tif _cursor == SEQUENCE.size():
\t\t_completed = true
\t\t_host.set_door_open(DOOR_ID, true)

func snapshot() -> Dictionary:
\treturn {"cursor": _cursor, "completed": _completed}

func validate_state(data: Dictionary) -> String:
\tif data.size() != 2 or not data.has("cursor") or not data.has("completed"):
\t\treturn "Invalid sequence rule state keys"
\tvar cursor = data.get("cursor")
\tif not (cursor is int or cursor is float) or not is_finite(float(cursor)) or float(cursor) != floor(float(cursor)):
\t\treturn "Invalid sequence cursor"
\tif int(cursor) < 0 or int(cursor) > SEQUENCE.size() or not data.get("completed") is bool:
\t\treturn "Invalid sequence state"
\tif bool(data.completed) != (int(cursor) == SEQUENCE.size()):
\t\treturn "Inconsistent sequence completion"
\treturn ""

func restore(data: Dictionary) -> void:
\tif not validate_state(data).is_empty():
\t\treturn
\t_cursor = int(data.cursor)
\t_completed = bool(data.completed)
\tif _completed:
\t\t_host.set_door_open(DOOR_ID, true)
`;
  return {declaration:{id,kind:'sequence-door',doorId,sequence:[...sequence],script:`scripts/creation/rules/${id}.gd`,sha256:createHash('sha256').update(script).digest('hex')},text:script};
}
module.exports={generateSequenceDoorRule};
