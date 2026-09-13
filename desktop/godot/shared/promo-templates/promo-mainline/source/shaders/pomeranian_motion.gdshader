shader_type spatial;
render_mode cull_disabled;

uniform mat4 mesh_to_pet;
uniform mat4 pet_to_mesh;
uniform vec4 base_color : source_color = vec4(1.0);
uniform float surface_roughness = 0.85;
uniform float surface_specular = 0.5;
uniform bool use_albedo_texture = false;
uniform sampler2D albedo_texture : source_color;
uniform bool use_normal_texture = false;
uniform sampler2D coat_normal : hint_normal;
uniform float normal_strength = 0.38;
uniform float walk_amount = 0.0;
uniform float stride_phase = 0.0;
uniform float wag_phase = 0.0;
uniform float wag_amount = 1.0;
uniform float pat_amount = 0.0;

void vertex() {
	vec3 p = (mesh_to_pet * vec4(VERTEX, 1.0)).xyz;
	float low = 1.0 - smoothstep(0.20, 0.40, p.y);
	float side = p.x < 0.0 ? -1.0 : 1.0;
	float front = p.z < 0.0 ? -1.0 : 1.0;
	float step_wave = sin(stride_phase) * side * front;
	p.z += step_wave * 0.058 * low * walk_amount;
	p.y += max(0.0, cos(stride_phase) * side * front) * 0.025 * low * walk_amount;
	float tail = smoothstep(0.08, 0.27, p.z) * smoothstep(0.58, 0.73, p.y);
	p.x += sin(wag_phase) * 0.028 * tail * wag_amount;
	float head = (1.0 - smoothstep(-0.24, -0.05, p.z)) * smoothstep(0.43, 0.66, p.y);
	p.x += head * pat_amount;
	p.y += abs(sin(stride_phase)) * 0.009 * walk_amount;
	VERTEX = (pet_to_mesh * vec4(p, 1.0)).xyz;
}

void fragment() {
	vec3 colour = base_color.rgb;
	if (use_albedo_texture) {
		colour *= texture(albedo_texture, UV).rgb;
	}
	ALBEDO = colour;
	ROUGHNESS = surface_roughness;
	SPECULAR = surface_specular;
	if (use_normal_texture) {
		NORMAL_MAP = texture(coat_normal, UV).rgb;
		NORMAL_MAP_DEPTH = normal_strength;
	}
}
