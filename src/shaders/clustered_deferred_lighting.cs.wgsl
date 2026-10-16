// Extra credit: deferred lighting as one compute pass instead of a fullscreen VS + FS.
// One thread per pixel, writes straight to the canvas.

@group(${bindGroup_computeOutput}) @binding(0) var outputTex: texture_storage_2d<rgba8unorm, write>;

@compute
@workgroup_size(${deferredLightingWorkgroupSize}, ${deferredLightingWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    let pixel = globalIdx.xy;
    if (any(pixel >= textureDimensions(outputTex))) {
        return;
    }

    textureStore(outputTex, pixel, shadePixel(pixel, vec2f(pixel) + 0.5));
}
