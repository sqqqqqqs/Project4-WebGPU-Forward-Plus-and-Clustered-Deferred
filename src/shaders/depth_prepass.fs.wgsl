// Extra credit: Forward+ depth prepass. No color, just the alpha test so the plants' cutouts don't write depth.

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput)
{
    if (textureSample(diffuseTex, diffuseTexSampler, in.uv).a < 0.5f) {
        discard;
    }
}
