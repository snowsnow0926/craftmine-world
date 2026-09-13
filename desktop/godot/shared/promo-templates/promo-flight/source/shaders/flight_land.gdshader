shader_type spatial;
render_mode unshaded;
uniform vec3 field_origin = vec3(6000.0,0.0,0.0);
uniform vec3 sun_direction = vec3(0.35,0.82,0.32);
uniform bool mountain = false;
varying vec3 world_pos;
varying vec3 world_normal;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x),mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x),f.y);}
void vertex(){world_pos=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;world_normal=normalize(mat3(MODEL_MATRIX)*NORMAL);}
void fragment(){
 vec3 p=world_pos-field_origin;
 float broad=noise2(p.xz*0.0014);
 float fine=noise2(p.xz*0.032);
 float patch=noise2(p.xz*0.005+vec2(broad*3.0));
 vec3 forest=vec3(0.027,0.077,0.047);
 vec3 meadow=vec3(0.09,0.145,0.072);
 vec3 color=mix(forest,meadow,smoothstep(0.22,0.81,broad*0.7+patch*0.3));
 float coast_r=length(vec2(p.x,(p.z+400.0)/0.8));
 float angle=atan((p.z+400.0)/0.8,p.x);
 float shore_radius=4100.0+260.0*sin(angle*5.0)+120.0*cos(angle*9.0);
 float coast=smoothstep(shore_radius-120.0,shore_radius-12.0,coast_r);
 color=mix(color,vec3(0.29,0.25,0.16),coast*0.72);
 if(mountain){
  float exposed=clamp((1.0-abs(normalize(world_normal).y))*1.0+smoothstep(230.0,570.0,p.y)*0.65+patch*0.18,0.0,1.0);
  vec3 rock=mix(vec3(0.11,0.13,0.125),vec3(0.24,0.245,0.20),fine*0.32+broad*0.50);
  rock*=0.91+0.09*sin(p.y*0.10+noise2(p.xz*0.008)*7.0);
  color=mix(color,rock,exposed);
 }
 float light=0.53+0.47*max(dot(normalize(world_normal),normalize(sun_direction)),0.0);
 float cloud_shadow=smoothstep(0.38,0.72,noise2(p.xz*0.00055+vec2(3.0,7.0)));
 color*=light*(0.87+0.13*cloud_shadow)*(0.95+fine*0.1);
 ALBEDO=color;
}
