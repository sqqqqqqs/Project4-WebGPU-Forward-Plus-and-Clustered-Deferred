import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

// extra credit G-buffer options, one render mode each so they can be compared
export interface ClusteredDeferredOptions {
    computeLighting: boolean; // compute pass instead of fullscreen VS + FS
    packedGBuffer: boolean;   // one rg32uint texture instead of albedo + normal (only set up together with computeLighting)
}

export class ClusteredDeferredRenderer extends renderer.Renderer {
    // TODO-3: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    options: ClusteredDeferredOptions;

    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    gBufferBindGroupLayout: GPUBindGroupLayout;
    gBufferBindGroup: GPUBindGroup;

    // [albedo, normal], or just [packed]
    gBufferTextures: GPUTexture[];
    gBufferTextureViews: GPUTextureView[];
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    gBufferPipeline: GPURenderPipeline;

    // only one of these gets used
    fullscreenPipeline?: GPURenderPipeline;
    lightingComputePipeline?: GPUComputePipeline;
    computeOutputBindGroupLayout?: GPUBindGroupLayout;

    constructor(stage: Stage, options: ClusteredDeferredOptions = { computeLighting: false, packedGBuffer: false }) {
        super(stage, ['clustering', 'gBuffer', 'lighting']);
        this.options = options;

        // TODO-3: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        // you'll need two pipelines: one for the G-buffer pass and one for the fullscreen pass
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "clustered deferred scene uniforms bind group layout",
            entries: [
                { // cameraUniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterSet
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "clustered deferred scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.lights.clusterSetStorageBuffer }
                }
            ]
        });

        // written in the G-buffer pass, read in the lighting pass
        const gBufferSize = [renderer.canvas.width, renderer.canvas.height];
        const gBufferUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

        const gBufferFormats: GPUTextureFormat[] = options.packedGBuffer ? ["rg32uint"] : ["rgba8unorm", "rgba16float"];
        this.gBufferTextures = gBufferFormats.map(format => renderer.device.createTexture({
            label: `G-buffer ${format}`,
            size: gBufferSize,
            format: format,
            usage: gBufferUsage
        }));
        this.gBufferTextureViews = this.gBufferTextures.map(texture => texture.createView());

        this.depthTexture = renderer.device.createTexture({
            label: "G-buffer depth",
            size: gBufferSize,
            format: "depth24plus",
            usage: gBufferUsage
        });
        this.depthTextureView = this.depthTexture.createView();

        const lightingStage = options.computeLighting ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT;
        // binding 0 is always depth; then albedo (1) + normal (2), or just the packed texture (1)
        const gBufferLayoutEntries: GPUBindGroupLayoutEntry[] = [
            { binding: 0, visibility: lightingStage, texture: { sampleType: "depth" } }
        ];
        if (options.packedGBuffer) {
            gBufferLayoutEntries.push({ binding: 1, visibility: lightingStage, texture: { sampleType: "uint" } });
        } else {
            gBufferLayoutEntries.push({ binding: 1, visibility: lightingStage, texture: { sampleType: "float" } });
            gBufferLayoutEntries.push({ binding: 2, visibility: lightingStage, texture: { sampleType: "float" } });
        }

        this.gBufferBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "G-buffer bind group layout",
            entries: gBufferLayoutEntries
        });

        this.gBufferBindGroup = renderer.device.createBindGroup({
            label: "G-buffer bind group",
            layout: this.gBufferBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.depthTextureView
                },
                // same order as the layout above
                ...this.gBufferTextureViews.map((view, i) => ({
                    binding: i + 1,
                    resource: view
                }))
            ]
        });

        this.gBufferPipeline = renderer.device.createRenderPipeline({
            label: "G-buffer pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "G-buffer pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "G-buffer vert shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "G-buffer frag shader",
                    code: options.packedGBuffer ? shaders.clusteredDeferredPackedFragSrc : shaders.clusteredDeferredFragSrc,
                }),
                targets: gBufferFormats.map(format => ({ format }))
            }
        });

        if (options.computeLighting) {
            this.computeOutputBindGroupLayout = renderer.device.createBindGroupLayout({
                label: "clustered deferred compute output bind group layout",
                entries: [
                    { // outputTex
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: { access: "write-only", format: renderer.canvasFormat }
                    }
                ]
            });

            this.lightingComputePipeline = renderer.device.createComputePipeline({
                label: "clustered deferred lighting compute pipeline",
                layout: renderer.device.createPipelineLayout({
                    label: "clustered deferred lighting compute pipeline layout",
                    bindGroupLayouts: [
                        this.sceneUniformsBindGroupLayout,
                        this.gBufferBindGroupLayout,
                        this.computeOutputBindGroupLayout
                    ]
                }),
                compute: {
                    module: renderer.device.createShaderModule({
                        label: "clustered deferred lighting compute shader",
                        code: options.packedGBuffer ? shaders.clusteredDeferredPackedLightingComputeSrc : shaders.clusteredDeferredLightingComputeSrc
                    }),
                    entryPoint: "main"
                }
            });
        } else {
            this.fullscreenPipeline = renderer.device.createRenderPipeline({
                label: "clustered deferred fullscreen pipeline",
                layout: renderer.device.createPipelineLayout({
                    label: "clustered deferred fullscreen pipeline layout",
                    bindGroupLayouts: [
                        this.sceneUniformsBindGroupLayout,
                        this.gBufferBindGroupLayout
                    ]
                }),
                vertex: {
                    module: renderer.device.createShaderModule({
                        label: "clustered deferred fullscreen vert shader",
                        code: shaders.clusteredDeferredFullscreenVertSrc
                    })
                },
                fragment: {
                    module: renderer.device.createShaderModule({
                        label: "clustered deferred fullscreen frag shader",
                        code: shaders.clusteredDeferredFullscreenFragSrc,
                    }),
                    targets: [
                        {
                            format: renderer.canvasFormat,
                        }
                    ]
                }
            });
        }
    }

    override draw() {
        // TODO-3: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the G-buffer pass, outputting position, albedo, and normals
        // - run the fullscreen pass, which reads from the G-buffer and performs lighting calculations
        const encoder = renderer.device.createCommandEncoder();
        const canvasTexture = renderer.context.getCurrentTexture();
        const canvasTextureView = canvasTexture.createView();

        this.lights.doLightClustering(encoder, this.gpuTimer.timestampWrites('clustering'));

        const gBufferPass = encoder.beginRenderPass({
            label: "G-buffer render pass",
            timestampWrites: this.gpuTimer.timestampWrites('gBuffer'),
            colorAttachments: this.gBufferTextureViews.map((view): GPURenderPassColorAttachment => ({
                view: view,
                clearValue: [0, 0, 0, 0],
                loadOp: "clear",
                storeOp: "store"
            })),
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        gBufferPass.setPipeline(this.gBufferPipeline);

        gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);

        this.scene.iterate(node => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gBufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            gBufferPass.drawIndexed(primitive.numIndices);
        });

        gBufferPass.end();

        if (this.options.computeLighting) {
            // canvas texture changes every frame, so this bind group does too
            const computeOutputBindGroup = renderer.device.createBindGroup({
                label: "clustered deferred compute output bind group",
                layout: this.computeOutputBindGroupLayout!,
                entries: [
                    {
                        binding: 0,
                        resource: canvasTextureView
                    }
                ]
            });

            const lightingPass = encoder.beginComputePass({
                label: "clustered deferred lighting compute pass",
                timestampWrites: this.gpuTimer.timestampWrites('lighting')
            });
            lightingPass.setPipeline(this.lightingComputePipeline!);

            lightingPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            lightingPass.setBindGroup(shaders.constants.bindGroup_gBuffer, this.gBufferBindGroup);
            lightingPass.setBindGroup(shaders.constants.bindGroup_computeOutput, computeOutputBindGroup);

            const workgroupSize = shaders.constants.deferredLightingWorkgroupSize;
            lightingPass.dispatchWorkgroups(Math.ceil(canvasTexture.width / workgroupSize), Math.ceil(canvasTexture.height / workgroupSize));

            lightingPass.end();
        } else {
            const fullscreenPass = encoder.beginRenderPass({
                label: "clustered deferred fullscreen render pass",
                timestampWrites: this.gpuTimer.timestampWrites('lighting'),
                colorAttachments: [
                    {
                        view: canvasTextureView,
                        clearValue: [0, 0, 0, 0],
                        loadOp: "clear",
                        storeOp: "store"
                    }
                ]
            });
            fullscreenPass.setPipeline(this.fullscreenPipeline!);

            fullscreenPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            fullscreenPass.setBindGroup(shaders.constants.bindGroup_gBuffer, this.gBufferBindGroup);

            fullscreenPass.draw(3);

            fullscreenPass.end();
        }

        this.submit(encoder);
    }
}
