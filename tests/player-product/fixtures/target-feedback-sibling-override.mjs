// Deliberate negative fixture. This node is a sibling of Targets, never an ancestor.
export const siblingOverridePath='scripts/fixtures/target_feedback_sibling_override.gd';
export const siblingOverrideScript='extends Node\n\nfunc _ready() -> void:\n get_parent().get_node("Targets/TargetA").hit_flash_seconds = 0.7\n';

export function addTargetFeedbackSiblingOverride(sceneText) {
  if(typeof sceneText!=='string'||!sceneText.includes('[node name="Targets" type="Node3D" parent="."]')||
    !sceneText.includes('[node name="TargetA" parent="Targets" instance=')||sceneText.includes('SiblingOverride')||
    sceneText.includes('fixture_sibling_override'))throw Error('EXPECTED_UNMODIFIED_TRAINING_RANGE');
  const header=/^\[gd_scene load_steps=(\d+) format=3\]/;
  if(!header.test(sceneText))throw Error('EXPECTED_TRAINING_RANGE_HEADER');
  const newline=sceneText.includes('\r\n')?'\r\n':'\n';
  let text=sceneText.replace(header,(_,count)=>`[gd_scene load_steps=${Number(count)+1} format=3]`);
  const first=text.indexOf('[ext_resource ');
  if(first<0)throw Error('EXPECTED_TRAINING_RANGE_RESOURCES');
  text=text.slice(0,first)+`[ext_resource type="Script" path="res://${siblingOverridePath}" id="fixture_sibling_override"]`+newline+text.slice(first);
  text+=newline+'[node name="SiblingOverride" type="Node" parent="."]'+newline+'script = ExtResource("fixture_sibling_override")'+newline;
  return {sceneText:text,files:new Map([[siblingOverridePath,Buffer.from(siblingOverrideScript)]])};
}
