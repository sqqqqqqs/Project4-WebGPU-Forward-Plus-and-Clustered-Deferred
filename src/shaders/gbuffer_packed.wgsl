// Packed G-buffer: one rg32uint (+ depth)
//   x = albedo (pack4x8unorm)
//   y = octahedron normal (pack2x16snorm)

@group(${bindGroup_gBuffer}) @binding(1) var packedTex: texture_2d<u32>;

fn readGBuffer(pixel: vec2u) -> GBufferSample {
    let packed = textureLoad(packedTex, pixel, 0).xy;

    var out: GBufferSample;
    out.albedo = unpack4x8unorm(packed.x).rgb;
    out.nor = octDecode(unpack2x16snorm(packed.y));
    return out;
}
