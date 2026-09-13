shader_type spatial;
render_mode unshaded, cull_back;
uniform sampler2D scene_color : hint_screen_texture, filter_linear_mipmap;
uniform float magic_strength = 0.0;
void fragment() {
 vec3 n = normalize(NORMAL);
 float facing = clamp(dot(n,normalize(VIEW)),0.0,1.0);
 float rim = pow(1.0-facing,3.0);
 vec2 bend = n.xy * 0.012 * (1.0-facing*0.5);
 vec3 behind = textureLod(scene_color,clamp(SCREEN_UV+bend,vec2(0.001),vec2(0.999)),0.0).rgb;
 vec3 glass = mix(behind*0.87,vec3(0.07,0.19,0.28),rim*0.52);
 float white_glint = pow(max(dot(n,normalize(vec3(-0.42,0.66,0.65))),0.0),68.0);
 float blue_glint = pow(max(dot(n,normalize(vec3(0.35,-0.65,0.62))),0.0),40.0);
 float silver = pow(rim,2.0)*0.40;
 ALBEDO = glass + silver*vec3(0.37,0.58,0.72) + white_glint*vec3(1.25,1.34,1.38) + blue_glint*vec3(0.05,0.42,0.75)*(0.5+magic_strength);
}
