// CHECKITOUT: code that you add here will be prepended to all shaders

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

// TODO-2: you may want to create a ClusterSet struct similar to LightSet
struct Cluster {
    numLights: u32,
    lightIndices: array<u32, ${maxLightsPerCluster}>
}

struct ClusterSet {
    clusters: array<Cluster>
}

struct CameraUniforms {
    // TODO-1.3: add an entry for the view proj mat (of type mat4x4f)
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    invProjMat: mat4x4f,
    invViewProjMat: mat4x4f,
    screenSize: vec2f,
    debugMode: u32
}

// x first, then y, then z
fn getClusterIndex(clusterXYZ: vec3u) -> u32 {
    return clusterXYZ.x + clusterXYZ.y * ${numClustersX} + clusterXYZ.z * ${numClustersX} * ${numClustersY};
}

// view depth where the given z slice starts.
// slice 0 is one "near slice" from clusterNear to clusterFirstSliceEnd (there's hardly anything that close to the camera,
// so plain log slicing would waste a lot of slices there), the rest are log spaced from clusterFirstSliceEnd to clusterFar
fn getSliceDepth(slice: f32) -> f32 {
    if (slice < 1) {
        return ${clusterNear};
    }
    let t = (slice - 1) / f32(${numClustersZ} - 1);
    return ${clusterFirstSliceEnd} * pow(${clusterFar} / ${clusterFirstSliceEnd}, t);
}

// fragCoord = @builtin(position).xy (pixels, top left origin), viewDepth = distance along -z
fn getClusterIndexFromFrag(fragCoord: vec2f, viewDepth: f32, screenSize: vec2f) -> u32 {
    // x, y: which screen tile the pixel is in
    let numClustersXY = vec2f(${numClustersX}, ${numClustersY});
    let tile = vec2u(fragCoord / screenSize * numClustersXY);
    let xy = min(tile, vec2u(numClustersXY) - 1); // the very last pixel row/column would land one tile too far

    // z: inverse of getSliceDepth(), clamped so anything past clusterFar goes in the last slice
    var z = 0u; // the near slice
    if (viewDepth >= ${clusterFirstSliceEnd}) {
        let t = log(viewDepth / ${clusterFirstSliceEnd}) / log(${clusterFar} / ${clusterFirstSliceEnd});
        z = u32(clamp(1 + t * f32(${numClustersZ} - 1), 1, f32(${numClustersZ} - 1)));
    }

    return getClusterIndex(vec3u(xy, z));
}

// G-BUFFER
// =================================

struct GBufferSample {
    albedo: vec3f,
    nor: vec3f
}

// octahedron normal encoding: unit vector <-> [-1, 1]^2
fn signNotZero(v: vec2f) -> vec2f {
    return select(vec2f(-1), vec2f(1), v >= vec2f(0));
}

fn octEncode(n: vec3f) -> vec2f {
    // project onto the octahedron |x| + |y| + |z| = 1, then look at it from above
    var p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
    if (n.z < 0) {
        // the bottom half gets folded out over the corners of the square
        p = (1 - abs(p.yx)) * signNotZero(p);
    }
    return p;
}

fn octDecode(e: vec2f) -> vec3f {
    var n = vec3f(e, 1 - abs(e.x) - abs(e.y));
    if (n.z < 0) {
        // undo the fold
        n = vec3f((1 - abs(n.yx)) * signNotZero(n.xy), n.z);
    }
    return normalize(n);
}

// DEBUG VIEWS
// =================================

// PCG hash, just to get random looking debug colors
fn hashToColor(i: u32) -> vec3f {
    var h = i * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    h = (h >> 22u) ^ h;
    return vec3f(f32(h & 0xffu), f32((h >> 8u) & 0xffu), f32((h >> 16u) & 0xffu)) / 255.f;
}

// blue = few lights, red = 128+, white = cluster is full
fn heatmapColor(numLights: u32) -> vec3f {
    if (numLights >= ${maxLightsPerCluster}) {
        return vec3f(1);
    }
    let t = clamp(f32(numLights) / 128.f, 0.f, 1.f);
    let red = smoothstep(0.5f, 1.f, t);          // fades in over the top half
    let green = 1.f - abs(2.f * t - 1.f);        // peaks in the middle
    let blue = 1.f - smoothstep(0.f, 0.5f, t);   // fades out over the bottom half
    return vec3f(red, green, blue);
}

// 4 = albedo, 5 = normal, 6 = depth, 7 = position (the G-buffer debug images from the recitation)
fn getGBufferDebugColor(debugMode: u32, albedo: vec3f, nor: vec3f, viewDepth: f32, posWorld: vec3f) -> vec3f {
    switch debugMode {
        case 4u: { return albedo; }
        case 5u: { return nor * 0.5 + 0.5; }                // [-1, 1] -> [0, 1]
        case 6u: { return vec3f(viewDepth / ${clusterFar}); } // brighter = farther
        default: { return posWorld / 30 + 0.5; }             // Sponza is ~30 units across
    }
}

// 1 = cluster index, 2 = z slice, 3 = lights per cluster
fn getDebugColor(debugMode: u32, clusterIdx: u32, numLights: u32) -> vec3f {
    switch debugMode {
        case 1u: { return hashToColor(clusterIdx); }
        case 2u: { return hashToColor(clusterIdx / (${numClustersX} * ${numClustersY})); }
        default: { return heatmapColor(numLights); }
    }
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}
