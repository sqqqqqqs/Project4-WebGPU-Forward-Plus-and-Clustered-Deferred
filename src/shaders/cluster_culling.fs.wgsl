// Extra credit: after the depth prepass, mark every cluster that has something visible in it.
// Clustering then skips the rest.

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var depthTex: texture_depth_2d;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> activeClusters: array<u32>;

@fragment
fn main(@builtin(position) fragPos: vec4f)
{
    let depth = textureLoad(depthTex, vec2u(fragPos.xy), 0);
    if (depth == 1.f) {
        return; // background
    }

    // view depth from the depth buffer (flip y: screen y goes down, NDC y goes up)
    let uv = fragPos.xy / cameraUniforms.screenSize;
    let posViewH = cameraUniforms.invProjMat * vec4f(uv.x * 2 - 1, 1 - uv.y * 2, depth, 1);
    let viewDepth = -posViewH.z / posViewH.w;

    // everyone writes the same 1, so the race is harmless and no atomics are needed.
    // check first so neighboring pixels in the same cluster don't all write
    let clusterIdx = getClusterIndexFromFrag(fragPos.xy, viewDepth, cameraUniforms.screenSize);
    if (activeClusters[clusterIdx] == 0u) {
        activeClusters[clusterIdx] = 1u;
    }
}
