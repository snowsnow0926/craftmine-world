shader_type spatial;
render_mode unshaded, cull_disabled;
uniform vec3 field_origin = vec3(6000.0,0.0,0.0);
uniform vec3 sun_direction = vec3(0.35,0.82,0.32);
varying vec3 world_pos;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x),mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x),f.y);}
void vertex(){world_pos=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;}
void fragment(){
 vec2 p=(world_pos-field_origin).xz;
 vec2 coast_p=vec2(p.x,(p.y+400.0)/0.8);
 float angle=atan(coast_p.y,coast_p.x);
 float shore_radius=4100.0+260.0*sin(angle*5.0)+120.0*cos(angle*9.0);
 float shore=length(coast_p)-shore_radius;
 float shallows=1.0-smoothstep(20.0,420.0,shore+noise2(p*0.007)*100.0);
 vec3 deep=vec3(0.010,0.055,0.082);
 vec3 shallow=vec3(0.025,0.22,0.20);
 vec3 color=mix(deep,shallow,shallows*0.88);
 float large_noise=noise2(p*0.0008)*0.65+noise2(p*0.0024)*0.35;
 color*=0.82+large_noise*0.30;
 float t=TIME;
 float w1=dot(p,vec2(0.11,0.037))+t*0.85;
 float w2=dot(p,vec2(-0.051,0.16))-t*1.1;
 float w3=dot(p,vec2(0.31,0.24))+t*1.65;
 vec2 slope=vec2(0.11,0.037)*cos(w1)*0.48+vec2(-0.051,0.16)*cos(w2)*0.25+vec2(0.31,0.24)*cos(w3)*0.065;
 vec3 n=normalize(vec3(-slope.x,1.0,-slope.y));
 vec3 view=normalize(CAMERA_POSITION_WORLD-world_pos);
 float fresnel=pow(1.0-clamp(dot(view,n),0.0,1.0),4.0);
 vec3 reflection=mix(vec3(0.045,0.14,0.25),vec3(0.31,0.49,0.60),fresnel);
 color=mix(color,reflection,0.14+fresnel*0.64);
 float glint=pow(max(dot(reflect(-normalize(sun_direction),n),view),0.0),110.0);
 color+=vec3(0.75,0.65,0.44)*glint*0.72;
 float ripple=(sin(w1)+sin(w2)*0.5+sin(w3)*0.2)*0.008;
 color+=vec3(0.035,0.09,0.10)*ripple;
 float foam_band=1.0-smoothstep(12.0,65.0,abs(shore-18.0-12.0*sin(t*0.5+p.x*0.004)));
 float foam=foam_band*smoothstep(0.35,0.75,noise2(p*0.045+vec2(t*0.10,0.0)));
 color=mix(color,vec3(0.65,0.77,0.74),foam*0.65);
 float whitecaps=smoothstep(0.985,0.999,noise2(p*0.09+vec2(t*0.14,t*0.06)))*(1.0-fresnel);
 color+=vec3(0.11,0.16,0.17)*whitecaps;
 float horizon_blend=pow(1.0-clamp(view.y,0.0,1.0),14.0);
 color=mix(color,vec3(0.31,0.49,0.60),horizon_blend*0.85);
 ALBEDO=color;
}
