shader_type spatial;
render_mode world_vertex_coords, cull_disabled;
uniform vec4 base_color : source_color = vec4(0.5,0.3,0.15,1.0);
uniform float kind = 0.0;
uniform float albedo_gain : hint_range(0.0,1.0) = 0.9;
varying vec3 wp;
float hash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p) { vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
void vertex() {
 wp=VERTEX;
 if(kind>3.5 && kind<4.5) { VERTEX.x+=0.09*sin(TIME*1.1+VERTEX.z*0.8+VERTEX.x); }
 if(kind>4.5 && kind<5.5) { VERTEX.x+=0.08*sin(TIME*5.0+VERTEX.y*3.0); VERTEX.z+=0.06*cos(TIME*4.0+VERTEX.x*5.0); }
}
void fragment() {
 float n=noise(wp*1.8); float fine=noise(wp*26.0);
 float shade=0.80+0.17*n+0.03*fine;
 ROUGHNESS=0.94;
 METALLIC=0.0;
 SPECULAR=0.12;
 if(kind<0.5) {
  float layers=sin(wp.y*3.0+noise(wp*0.22)*4.0);
  shade*=0.92+0.08*layers;
 } else if(kind<1.5) {
  float grain=noise(vec3(wp.x*15.0,wp.y*0.9,wp.z*15.0));
  shade*=0.78+0.22*grain;
  ROUGHNESS=0.9; SPECULAR=0.16;
 } else if(kind<2.5) {
  shade*=0.95+0.05*sin(wp.x*38.0)*sin(wp.y*38.0);
  SPECULAR=0.08;
 } else if(kind<3.5) {
  METALLIC=0.64; ROUGHNESS=0.64; SPECULAR=0.45;
 }
 ALBEDO=base_color.rgb*shade*albedo_gain;
 if(kind>4.5 && kind<5.5) {
  ALBEDO=base_color.rgb;
  EMISSION=base_color.rgb*(0.85+0.2*sin(TIME*7.0+wp.y*6.0));
 }
 if(kind>5.5) {
  float stream=noise(vec3(wp.x*7.0,wp.y*1.7+TIME*4.0,wp.z*8.0));
  ALBEDO=mix(base_color.rgb,vec3(0.55,0.69,0.7),stream*0.55);
  ROUGHNESS=0.35; SPECULAR=0.25; EMISSION=ALBEDO*0.07;
 }
}
