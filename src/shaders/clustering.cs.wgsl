// TODO-2: implement the light clustering compute shader

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> clusterSet: ClusterSet;
@group(${bindGroup_scene}) @binding(3) var<storage, read> activeClusters: array<u32>;

// extra credit: skip clusters the culling pass didn't mark
override useClusterCulling: bool = false;

// NDC xy point, pushed along its view ray to the given depth
fn ndcToViewAtDepth(ndc: vec2f, depth: f32) -> vec3f {
    let p = cameraUniforms.invProjMat * vec4f(ndc, 0, 1);
    let viewDir = p.xyz / p.w;
    return viewDir * (depth / -viewDir.z); // slide along the ray until z = -depth
}

@compute
@workgroup_size(${clusteringWorkgroupSize}, ${clusteringWorkgroupSize}, ${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) clusterXYZ: vec3u) {
    if (any(clusterXYZ >= vec3u(${numClustersX}, ${numClustersY}, ${numClustersZ}))) {
        return;
    }

    let clusterIdx = getClusterIndex(clusterXYZ);
    if (useClusterCulling && activeClusters[clusterIdx] == 0u) {
        clusterSet.clusters[clusterIdx].numLights = 0u;
        return;
    }

    // cluster bounds in NDC (flip y: screen y goes down, NDC y goes up)
    let numClustersXY = vec2f(${numClustersX}, ${numClustersY});
    let tileMin = vec2f(clusterXYZ.xy) / numClustersXY;
    let tileMax = vec2f(clusterXYZ.xy + 1) / numClustersXY;
    let ndcMin = vec2f(tileMin.x * 2 - 1, 1 - tileMax.y * 2);
    let ndcMax = vec2f(tileMax.x * 2 - 1, 1 - tileMin.y * 2);

    let depthNear = getSliceDepth(f32(clusterXYZ.z));
    let depthFar = getSliceDepth(f32(clusterXYZ.z + 1));

    // view space AABB around the cluster's 8 frustum corners (4 tile corners x near/far depth)
    let tileCorners = array<vec2f, 4>(
        vec2f(ndcMin.x, ndcMin.y),
        vec2f(ndcMax.x, ndcMin.y),
        vec2f(ndcMin.x, ndcMax.y),
        vec2f(ndcMax.x, ndcMax.y)
    );
    var aabbMin = vec3f(1e30);
    var aabbMax = vec3f(-1e30);
    for (var i = 0; i < 4; i++) {
        let ndc = tileCorners[i];
        let pNear = ndcToViewAtDepth(ndc, depthNear);
        let pFar = ndcToViewAtDepth(ndc, depthFar);
        aabbMin = min(aabbMin, min(pNear, pFar));
        aabbMax = max(aabbMax, max(pNear, pFar));
    }

    // add every light whose sphere touches the AABB
    let cluster = &clusterSet.clusters[clusterIdx];
    var numLights = 0u;
    for (var lightIdx = 0u; lightIdx < lightSet.numLights; lightIdx++) {
        let lightPosView = (cameraUniforms.viewMat * vec4f(lightSet.lights[lightIdx].pos, 1)).xyz;
        let closestPoint = clamp(lightPosView, aabbMin, aabbMax); // point in the AABB nearest to the light
        let d = closestPoint - lightPosView;
        if (dot(d, d) <= ${lightRadius} * ${lightRadius}) {
            (*cluster).lightIndices[numLights] = lightIdx;
            numLights++;
            if (numLights == ${maxLightsPerCluster}) {
                break;
            }
        }
    }
    (*cluster).numLights = numLights;
}
