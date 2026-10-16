import { device, canTimestamp } from './renderer';

// Per-pass GPU timing with timestamp queries, shown on screen as a ~0.5 s average.
export class GpuTimer {
    readonly passNames: string[];

    private querySet?: GPUQuerySet;
    private resolveBuffer?: GPUBuffer;
    private resultBuffer?: GPUBuffer;

    // since the last on-screen update
    private sums: number[];
    private numSamples = 0;

    private numDropped = 0;

    private displayElement: HTMLElement;
    private lastDisplayTime = 0;

    constructor(passNames: string[]) {
        this.passNames = passNames;
        this.sums = new Array(passNames.length + 1).fill(0); // last entry is the whole frame

        // one shared on-screen label, created by the first timer
        let displayElement = document.getElementById('gpuTime');
        if (!displayElement) {
            displayElement = document.createElement('div');
            displayElement.id = 'gpuTime';
            document.body.appendChild(displayElement);
        }
        this.displayElement = displayElement;
        this.displayElement.textContent = canTimestamp ? 'GPU: waiting...' : 'GPU timing unavailable (timestamp-query not supported)';

        if (!canTimestamp) {
            return;
        }

        const numQueries = passNames.length * 2;
        this.querySet = device.createQuerySet({ label: "gpu timer query set", type: "timestamp", count: numQueries });
        this.resolveBuffer = device.createBuffer({
            label: "gpu timer resolve buffer",
            size: numQueries * 8, // timestamps are u64
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
        });
        this.resultBuffer = device.createBuffer({
            label: "gpu timer result buffer",
            size: numQueries * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
    }

    // goes into a pass descriptor's timestampWrites; passName must be one of the names given to the constructor
    timestampWrites(passName: string): GPUComputePassTimestampWrites | undefined {
        if (!this.querySet) {
            return undefined;
        }
        const passIdx = this.passNames.indexOf(passName);
        if (passIdx < 0) {
            throw new Error(`GpuTimer: unknown pass "${passName}"`);
        }
        return { querySet: this.querySet, beginningOfPassWriteIndex: passIdx * 2, endOfPassWriteIndex: passIdx * 2 + 1 };
    }

    // call before encoder.finish()
    resolve(encoder: GPUCommandEncoder) {
        if (!this.querySet || this.resultBuffer!.mapState !== 'unmapped') {
            return; // still reading the last results, skip this frame
        }
        encoder.resolveQuerySet(this.querySet, 0, this.querySet.count, this.resolveBuffer!, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer!, 0, this.resultBuffer!, 0, this.resultBuffer!.size);
    }

    // call after device.queue.submit()
    read() {
        if (!this.resultBuffer || this.resultBuffer.mapState !== 'unmapped') {
            return;
        }
        const resultBuffer = this.resultBuffer;
        resultBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const times = new BigInt64Array(resultBuffer.getMappedRange());
            const passTimesMs = this.passNames.map((_, i) => Number(times[i * 2 + 1] - times[i * 2]) / 1e6);

            // earliest to latest timestamp, in case passes don't run in order
            const minTime = times.reduce((a, b) => b < a ? b : a);
            const maxTime = times.reduce((a, b) => b > a ? b : a);
            const frameTimeMs = Number(maxTime - minTime) / 1e6;
            resultBuffer.unmap();

            // toss garbage (e.g. queries that never got written)
            if (frameTimeMs <= 0 || frameTimeMs > 1000) {
                this.numDropped++;
                const missing = this.passNames.filter((_, i) => times[i * 2] === 0n || times[i * 2 + 1] === 0n);
                if (missing.length > 0 && this.numDropped === 10) { // warn once, the first few frames can be empty
                    console.warn(`GpuTimer: timestamps of pass(es) [${missing.join(', ')}] are never written, frames are being dropped`);
                }
                return;
            }
            [...passTimesMs, frameTimeMs].forEach((t, i) => this.sums[i] += t);
            this.numSamples++;

            this.updateDisplay();
        }).catch(() => {}); // buffer got destroyed on renderer switch, that's fine
    }

    destroy() {
        this.querySet?.destroy();
        this.resolveBuffer?.destroy();
        this.resultBuffer?.destroy();
    }

    private updateDisplay() {
        const now = performance.now();
        if (now - this.lastDisplayTime < 500) {
            return;
        }
        this.lastDisplayTime = now;

        const avg = this.sums.map(sum => (sum / this.numSamples).toFixed(2));
        const passText = this.passNames.map((name, i) => `${name} ${avg[i]}`).join(' | ');
        this.displayElement.textContent = `GPU ${avg[this.passNames.length]} ms  (${passText})`;

        // on-screen number = average over the last ~0.5 s
        this.sums.fill(0);
        this.numSamples = 0;
    }
}
