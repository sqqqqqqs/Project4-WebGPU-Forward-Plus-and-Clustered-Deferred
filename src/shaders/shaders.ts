// CHECKITOUT: this file loads all the shaders and preprocesses them with some common code

import { Camera } from '../stage/camera';

import commonRaw from './common.wgsl?raw';

import naiveVertRaw from './naive.vs.wgsl?raw';
import naiveFragRaw from './naive.fs.wgsl?raw';

import forwardPlusFragRaw from './forward_plus.fs.wgsl?raw';
import depthPrepassFragRaw from './depth_prepass.fs.wgsl?raw';
import clusterCullingFragRaw from './cluster_culling.fs.wgsl?raw';

import clusteredDeferredFragRaw from './clustered_deferred.fs.wgsl?raw';
import clusteredDeferredFullscreenVertRaw from './clustered_deferred_fullscreen.vs.wgsl?raw';
import clusteredDeferredFullscreenFragRaw from './clustered_deferred_fullscreen.fs.wgsl?raw';
import clusteredDeferredShadingRaw from './clustered_deferred_shading.wgsl?raw';
import gBufferUnpackedRaw from './gbuffer_unpacked.wgsl?raw';
import gBufferPackedRaw from './gbuffer_packed.wgsl?raw';
import clusteredDeferredPackedFragRaw from './clustered_deferred_packed.fs.wgsl?raw';
import clusteredDeferredLightingComputeRaw from './clustered_deferred_lighting.cs.wgsl?raw';

import moveLightsComputeRaw from './move_lights.cs.wgsl?raw';
import clusteringComputeRaw from './clustering.cs.wgsl?raw';

// CONSTANTS (for use in shaders)
// =================================

// CHECKITOUT: feel free to add more constants here and to refer to them in your shader code

// URL overrides for the cluster grid experiment, e.g. ?clusters=32x18x48&maxLights=1024
const urlParams = new URLSearchParams(window.location.search);
const clusterDims = urlParams.get('clusters')?.split('x').map(Number); // "32x18x48" -> [32, 18, 48]
const maxLightsOverride = urlParams.has('maxLights') ? Number(urlParams.get('maxLights')) : undefined;

// Note that these are declared in a somewhat roundabout way because otherwise minification will drop variables
// that are unused in host side code.
export const constants = {
    bindGroup_scene: 0,
    bindGroup_model: 1,
    bindGroup_material: 2,
    bindGroup_gBuffer: 1, // deferred lighting pass only, it has no model/material groups
    bindGroup_computeOutput: 2,

    moveLightsWorkgroupSize: 128,

    lightRadius: 2,

    // light clustering
    // 32x18x48 beat 16x9x24 in the cluster grid experiment (see README): smaller clusters, fewer lights per pixel
    numClustersX: clusterDims?.[0] ?? 32,
    numClustersY: clusterDims?.[1] ?? 18,
    numClustersZ: clusterDims?.[2] ?? 48,
    maxLightsPerCluster: maxLightsOverride ?? 1024, // with 5000 lights the fullest cluster had ~770, 512 overflowed
    clusterNear: 0.1,          // depth range for z slicing
    clusterFirstSliceEnd: 1,   // slice 0 covers all of clusterNear..1 since there's hardly anything that close
    clusterFar: 40,            // Sponza is ~35 units across, no need to go out to the camera's far plane
    clusteringWorkgroupSize: 4, // 4x4x4, one thread per cluster

    deferredLightingWorkgroupSize: 8 // 8x8, one thread per pixel
};

// =================================

function evalShaderRaw(raw: string) {
    // constants gets passed in instead of read through eval: otherwise the production build can't see that the
    // shaders use it and drops the properties only shaders read (e.g. lightRadius, clusterNear, clusterFar)
    return new Function('constants', 'return `' + raw.replaceAll('${', '${constants.') + '`;')(constants);
}

const commonSrc: string = evalShaderRaw(commonRaw);

function processShaderRaw(raw: string) {
    return commonSrc + evalShaderRaw(raw);
}

export const naiveVertSrc: string = processShaderRaw(naiveVertRaw);
export const naiveFragSrc: string = processShaderRaw(naiveFragRaw);

export const forwardPlusFragSrc: string = processShaderRaw(forwardPlusFragRaw);
export const depthPrepassFragSrc: string = processShaderRaw(depthPrepassFragRaw);
export const clusterCullingFragSrc: string = processShaderRaw(clusterCullingFragRaw);

export const clusteredDeferredFragSrc: string = processShaderRaw(clusteredDeferredFragRaw);
export const clusteredDeferredFullscreenVertSrc: string = processShaderRaw(clusteredDeferredFullscreenVertRaw);
export const clusteredDeferredFullscreenFragSrc: string = processShaderRaw(gBufferUnpackedRaw + clusteredDeferredShadingRaw + clusteredDeferredFullscreenFragRaw);

// extra credit: G-buffer optimizations
export const clusteredDeferredPackedFragSrc: string = processShaderRaw(clusteredDeferredPackedFragRaw);
export const clusteredDeferredLightingComputeSrc: string = processShaderRaw(gBufferUnpackedRaw + clusteredDeferredShadingRaw + clusteredDeferredLightingComputeRaw);
export const clusteredDeferredPackedLightingComputeSrc: string = processShaderRaw(gBufferPackedRaw + clusteredDeferredShadingRaw + clusteredDeferredLightingComputeRaw);

export const moveLightsComputeSrc: string = processShaderRaw(moveLightsComputeRaw);
export const clusteringComputeSrc: string = processShaderRaw(clusteringComputeRaw);
