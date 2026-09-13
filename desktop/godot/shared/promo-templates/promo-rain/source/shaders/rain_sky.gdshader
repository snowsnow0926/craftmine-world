shader_type sky;
// Static cloud illumination avoids rebuilding the web reflection cubemap every frame.
// Rain motion is independent and remains fully simulated by RainWorld.
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
 vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float clouds(vec2 p) {
 float a=0.5; float n=0.0;
 for(int i=0;i<5;i++) { n+=noise(p)*a; p=p*2.04+vec2(8.3,3.1); a*=0.5; }
 return n;
}
void sky() {
 float y=max(EYEDIR.y,0.0);
 vec3 col=mix(vec3(0.22,0.30,0.39),vec3(0.033,0.059,0.11),pow(y,0.42));
 vec2 uv=EYEDIR.xz/(y+0.27)*2.5;
 float cloud=clouds(uv);
 col=mix(col,vec3(0.055,0.08,0.12),smoothstep(0.40,0.72,cloud)*0.9);
 float glow=pow(max(dot(EYEDIR,normalize(vec3(0.4,0.5,-0.75))),0.0),18.0);
 col+=vec3(0.1,0.15,0.21)*glow*(1.0-cloud);
 if(EYEDIR.y<0.0) col=mix(vec3(0.11,0.16,0.21),col,exp(EYEDIR.y*10.0));
 COLOR=col;
}
