// Deferred lighting, shared by the fullscreen FS and the compute version.
// readGBuffer() comes from gbuffer_unpacked.wgsl or gbuffer_packed.wgsl.

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;

@group(${bindGroup_gBuffer}) @binding(0) var depthTex: texture_depth_2d;

// pixel = texel coords, fragCoord = pixel center (like @builtin(position).xy)
fn shadePixel(pixel: vec2u, fragCoord: vec2f) -> vec4f
{
    let depth = textureLoad(depthTex, pixel, 0);
    if (depth == 1.f) {
        return vec4(0); // nothing here, same clear color as the other renderers
    }

    let gBuffer = readGBuffer(pixel);

    // rebuild world position from depth (flip y: screen y goes down, NDC y goes up)
    let uv = fragCoord / cameraUniforms.screenSize;
    let ndc = vec4f(uv.x * 2 - 1, 1 - uv.y * 2, depth, 1);
    let posWorldH = cameraUniforms.invViewProjMat * ndc;
    let posWorld = posWorldH.xyz / posWorldH.w;

    let viewDepth = -(cameraUniforms.viewMat * vec4f(posWorld, 1)).z;
    if (cameraUniforms.debugMode >= 4u) {
        return vec4(getGBufferDebugColor(cameraUniforms.debugMode, gBuffer.albedo, gBuffer.nor, viewDepth, posWorld), 1);
    }
    let clusterIdx = getClusterIndexFromFrag(fragCoord, viewDepth, cameraUniforms.screenSize);
    let cluster = &clusterSet.clusters[clusterIdx];

    if (cameraUniforms.debugMode != 0u) {
        return vec4(getDebugColor(cameraUniforms.debugMode, clusterIdx, (*cluster).numLights), 1);
    }

    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < (*cluster).numLights; i++) {
        let light = lightSet.lights[(*cluster).lightIndices[i]];
        totalLightContrib += calculateLightContrib(light, posWorld, gBuffer.nor);
    }

    var finalColor = gBuffer.albedo * totalLightContrib;
    return vec4(finalColor, 1);
}
