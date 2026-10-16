import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export interface ForwardPlusOptions {
    depthPrepass: boolean;   // extra credit: depth-only pass first, so each pixel gets shaded once
    clusterCulling: boolean; // extra credit: skip clusters with nothing visible in them (needs depthPrepass)
}

// the passes draw() runs, in order (for GPU timing)
function forwardPlusPassNames(options: ForwardPlusOptions) {
    if (options.clusterCulling) {
        return ['depthPrepass', 'clusterCulling', 'clustering', 'shading']; // culling needs the prepass depth, so clustering moves after it
    }
    if (options.depthPrepass) {
        return ['clustering', 'depthPrepass', 'shading'];
    }
    return ['clustering', 'shading'];
}

export class ForwardPlusRenderer extends renderer.Renderer {
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    pipeline: GPURenderPipeline;

    options: ForwardPlusOptions;
    depthPrepassPipeline?: GPURenderPipeline;

    clusterCullingBindGroup?: GPUBindGroup;
    clusterCullingPipeline?: GPURenderPipeline;

    constructor(stage: Stage, options: ForwardPlusOptions = { depthPrepass: false, clusterCulling: false }) {
        super(stage, forwardPlusPassNames(options));
        this.options = options;

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "forward+ scene uniforms bind group layout",
            entries: [
                { // cameraUniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterSet
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "forward+ scene uniforms bind group",
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

        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING // read by the cluster culling pass
        });
        this.depthTextureView = this.depthTexture.createView();

        // shared by the main pass and the depth prepass
        const pipelineLayout = renderer.device.createPipelineLayout({
            label: "forward+ pipeline layout",
            bindGroupLayouts: [
                this.sceneUniformsBindGroupLayout,
                renderer.modelBindGroupLayout,
                renderer.materialBindGroupLayout
            ]
        });
        const vertModule = renderer.device.createShaderModule({
            label: "forward+ vert shader",
            code: shaders.naiveVertSrc
        });

        this.pipeline = renderer.device.createRenderPipeline({
            layout: pipelineLayout,
            depthStencil: options.depthPrepass ? {
                depthWriteEnabled: false, // depth is already final
                depthCompare: "equal",
                format: "depth24plus"
            } : {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: vertModule,
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "forward+ frag shader",
                    code: shaders.forwardPlusFragSrc,
                }),
                constants: { alphaTest: options.depthPrepass ? 0 : 1 }, // prepass already did the alpha test
                targets: [
                    {
                        format: renderer.canvasFormat,
                    }
                ]
            }
        });

        if (options.depthPrepass) {
            this.depthPrepassPipeline = renderer.device.createRenderPipeline({
                label: "forward+ depth prepass pipeline",
                layout: pipelineLayout,
                depthStencil: {
                    depthWriteEnabled: true,
                    depthCompare: "less",
                    format: "depth24plus"
                },
                vertex: {
                    module: vertModule,
                    buffers: [ renderer.vertexBufferLayout ]
                },
                fragment: {
                    module: renderer.device.createShaderModule({
                        label: "forward+ depth prepass frag shader",
                        code: shaders.depthPrepassFragSrc
                    }),
                    targets: [] // depth only
                }
            });
        }

        if (options.clusterCulling) {
            const clusterCullingBindGroupLayout = renderer.device.createBindGroupLayout({
                label: "cluster culling bind group layout",
                entries: [
                    { // cameraUniforms
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        buffer: { type: "uniform" }
                    },
                    { // depthTex
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: { sampleType: "depth" }
                    },
                    { // activeClusters
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        buffer: { type: "storage" }
                    }
                ]
            });

            this.clusterCullingBindGroup = renderer.device.createBindGroup({
                label: "cluster culling bind group",
                layout: clusterCullingBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.camera.uniformsBuffer }
                    },
                    {
                        binding: 1,
                        resource: this.depthTextureView
                    },
                    {
                        binding: 2,
                        resource: { buffer: this.lights.activeClustersStorageBuffer }
                    }
                ]
            });

            this.clusterCullingPipeline = renderer.device.createRenderPipeline({
                label: "cluster culling pipeline",
                layout: renderer.device.createPipelineLayout({
                    label: "cluster culling pipeline layout",
                    bindGroupLayouts: [ clusterCullingBindGroupLayout ]
                }),
                // depth gets attached read-only: that's what lets this pass also sample it,
                // and a render pass needs at least one attachment anyway
                depthStencil: {
                    depthWriteEnabled: false,
                    depthCompare: "always",
                    format: "depth24plus"
                },
                vertex: {
                    module: renderer.device.createShaderModule({
                        label: "cluster culling vert shader",
                        code: shaders.clusteredDeferredFullscreenVertSrc // same fullscreen triangle
                    })
                },
                fragment: {
                    module: renderer.device.createShaderModule({
                        label: "cluster culling frag shader",
                        code: shaders.clusterCullingFragSrc
                    }),
                    targets: []
                }
            });
        }
    }

    // draws the whole scene with whatever pipeline is set
    private drawScene(renderPass: GPURenderPassEncoder) {
        renderPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);

        this.scene.iterate(node => {
            renderPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            renderPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            renderPass.setVertexBuffer(0, primitive.vertexBuffer);
            renderPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            renderPass.drawIndexed(primitive.numIndices);
        });
    }

    override draw() {
        // TODO-2: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the main rendering pass, using the computed clusters for efficient lighting
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        if (!this.options.clusterCulling) {
            this.lights.doLightClustering(encoder, this.gpuTimer.timestampWrites('clustering'));
        }

        if (this.options.depthPrepass) {
            const depthPrepass = encoder.beginRenderPass({
                label: "forward+ depth prepass",
                timestampWrites: this.gpuTimer.timestampWrites('depthPrepass'),
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store"
                }
            });
            depthPrepass.setPipeline(this.depthPrepassPipeline!);
            this.drawScene(depthPrepass);
            depthPrepass.end();
        }

        if (this.options.clusterCulling) {
            encoder.clearBuffer(this.lights.activeClustersStorageBuffer);

            const clusterCullingPass = encoder.beginRenderPass({
                label: "cluster culling pass",
                timestampWrites: this.gpuTimer.timestampWrites('clusterCulling'),
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.depthTextureView,
                    depthReadOnly: true
                }
            });
            clusterCullingPass.setPipeline(this.clusterCullingPipeline!);
            clusterCullingPass.setBindGroup(shaders.constants.bindGroup_scene, this.clusterCullingBindGroup!);
            clusterCullingPass.draw(3);
            clusterCullingPass.end();

            this.lights.doLightClustering(encoder, this.gpuTimer.timestampWrites('clustering'), true);
        }

        const renderPass = encoder.beginRenderPass({
            label: "forward+ render pass",
            timestampWrites: this.gpuTimer.timestampWrites('shading'),
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: this.options.depthPrepass ? "load" : "clear", // reuse the prepass depth
                // with a prepass "discard" would do, but on Chrome/D3D12 it made this pass's timestamps read 0
                depthStoreOp: "store"
            }
        });
        renderPass.setPipeline(this.pipeline);
        this.drawScene(renderPass);

        renderPass.end();

        this.submit(encoder);
    }
}
