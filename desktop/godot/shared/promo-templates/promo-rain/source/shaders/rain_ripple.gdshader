shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;
uniform float rain_clock=0.0;
uniform float strength=1.0;
varying float phase;
void vertex() { phase=fract(INSTANCE_CUSTOM.x+rain_clock*0.85); }
void fragment() {
 float d=length(UV-vec2(0.5));
 float ring=1.0-smoothstep(0.009,0.026,abs(d-phase*0.47));
 ALBEDO=vec3(0.47,0.65,0.78);
 ALPHA=ring*(1.0-phase)*strength*0.3;
}
