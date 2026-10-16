// Extra credit: packed G-buffer, albedo + normal squeezed into one rg32uint (see gbuffer_packed.wgsl)

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec2u
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }

    return vec2u(pack4x8unorm(vec4(diffuseColor.rgb, 1)), pack2x16snorm(octEncode(normalize(in.nor))));
}
