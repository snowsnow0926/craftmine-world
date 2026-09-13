shader_type sky;
uniform vec3 sun_direction = vec3(0.35, 0.82, 0.32);
uniform vec2 cloud_offset = vec2(0.7, -0.4);
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cloud_noise(vec2 p) {
 vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x),mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x),f.y);
}
float fbm(vec2 p) {
 float v=0.0; float a=0.53;
 for(int i=0;i<5;i++){ v+=cloud_noise(p)*a; p=mat2(vec2(1.62,1.17),vec2(-1.17,1.62))*p+7.3; a*=0.48; }
 return v;
}
void sky() {
 vec3 d=normalize(EYEDIR); float elevation=max(d.y,0.0);
 vec3 horizon=vec3(0.31,0.49,0.60);
 vec3 zenith=vec3(0.027,0.092,0.205);
 vec3 color=mix(horizon,zenith,pow(elevation,0.46));
 if(d.y<0.0){color=mix(horizon,vec3(0.072,0.19,0.27),smoothstep(0.0,0.23,-d.y));}
 float sun_dot=max(dot(d,normalize(sun_direction)),0.0);
 color+=vec3(0.27,0.21,0.12)*pow(sun_dot,24.0);
 color+=vec3(1.0,0.84,0.55)*smoothstep(0.99955,0.99994,sun_dot);
 // Two cloud scales: sculpted low cumulus banks and high, stretched cirrus.
 vec2 uv=d.xz/(max(d.y,0.0)+0.17)*1.85+cloud_offset;
 float broad=fbm(uv*0.82);
 float detail=fbm(uv*3.4+13.7);
 float mass=broad*0.79+detail*0.21;
 float cover=smoothstep(0.49,0.68,mass)*smoothstep(0.025,0.20,d.y);
 float highlight=smoothstep(0.46,0.70,mass+0.075*detail);
 vec3 cloud=mix(vec3(0.31,0.39,0.48),vec3(0.91,0.90,0.84),highlight);
 cloud+=vec3(0.12,0.10,0.055)*pow(sun_dot,8.0)*(1.0-cover);
 color=mix(color,cloud,cover*0.94);
 vec2 high_uv=vec2(uv.x*0.48+31.0,uv.y*2.8-18.0);
 float wisps=smoothstep(0.62,0.79,fbm(high_uv))*smoothstep(0.10,0.50,d.y)*(1.0-cover);
 color=mix(color,vec3(0.67,0.75,0.80),wisps*0.33);
 COLOR=color;
}
