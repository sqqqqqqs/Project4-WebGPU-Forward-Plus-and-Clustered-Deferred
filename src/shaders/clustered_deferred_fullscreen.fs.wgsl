// TODO-3: implement the Clustered Deferred fullscreen fragment shader

// Similar to the Forward+ fragment shader, but with vertex information coming from the G-buffer instead.

// the lighting is in clustered_deferred_shading.wgsl, shared with the compute version

@fragment
fn main(@builtin(position) fragPos: vec4f) -> @location(0) vec4f
{
    return shadePixel(vec2u(fragPos.xy), fragPos.xy);
}
