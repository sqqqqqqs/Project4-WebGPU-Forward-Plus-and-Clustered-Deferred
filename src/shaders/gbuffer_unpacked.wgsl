// Base G-buffer: separate albedo and normal textures (+ depth)

@group(${bindGroup_gBuffer}) @binding(1) var albedoTex: texture_2d<f32>;
@group(${bindGroup_gBuffer}) @binding(2) var normalTex: texture_2d<f32>;

fn readGBuffer(pixel: vec2u) -> GBufferSample {
    var out: GBufferSample;
    out.albedo = textureLoad(albedoTex, pixel, 0).rgb;
    out.nor = textureLoad(normalTex, pixel, 0).xyz;
    return out;
}
