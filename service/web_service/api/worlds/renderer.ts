import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {Worker} from "node:worker_threads";
import crypto from "node:crypto";
import {path_utils} from "../../../../utils/path_utils.js";

type Biome = {id?: unknown; name?: unknown; rgb?: unknown};
type Libraries = {Edition?: {Java?: unknown}; JavaVersion?: Record<string, unknown>; biomeList?: Biome[]};
type WorkerResult = {type?: unknown; results?: {biomes?: ArrayBuffer; biomeScale?: unknown}};
type WorkerMessage = {requestId?: unknown; result?: WorkerResult};
export type RenderRequest = {seed: string; minecraftVersion: string; dimension: string; x: number; z: number; biomeIds?: number[]};
export type RenderedMap = {width: number; height: number; span: number; pixels: Buffer; biomeIds: Buffer};
export type BiomeOption = {id: number; name: string; rgb: [number, number, number] | null};

const require = createRequire(import.meta.url);
const MAX_CONCURRENT_RENDERS = 4;
const OUTPUT_TILE_SIZE = 128;
let activeRenders = 0;
const renderQueue = new Map<string, Array<() => void>>();
const activeByOwner = new Map<string, number>();
const connectedOwners = new Map<string, number>();
type PooledWorker = {worker: Worker; sourcePath: string; busy: boolean; disposed: boolean; current?: WorkerTask};
type WorkerTask = {requestId: string; resolve: (result: WorkerResult) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort?: () => void};
type WorkerWaiter = {sourcePath: string; resolve: (worker: PooledWorker) => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void};
const workers: PooledWorker[] = [];
const workerWaiters: WorkerWaiter[] = [];

function scheduleNext() {
    const ownerLimit = Math.max(1, Math.floor(MAX_CONCURRENT_RENDERS / Math.max(1, connectedOwners.size)));
    while (activeRenders < MAX_CONCURRENT_RENDERS) {
        const owner = [...renderQueue.keys()]
            .filter(candidate => renderQueue.get(candidate)?.length)
            .filter(candidate => (activeByOwner.get(candidate) || 0) < ownerLimit)
            .sort((left, right) => (activeByOwner.get(left) || 0) - (activeByOwner.get(right) || 0))[0];
        if (!owner) return;
        const task = renderQueue.get(owner)?.shift();
        if (!task) { renderQueue.delete(owner); continue; }
        if (!renderQueue.get(owner)?.length) renderQueue.delete(owner);
        activeRenders++;
        activeByOwner.set(owner, (activeByOwner.get(owner) || 0) + 1);
        task();
    }
}

export function connectRenderOwner(owner: string): () => void {
    connectedOwners.set(owner, (connectedOwners.get(owner) || 0) + 1);
    scheduleNext();
    return () => {
        const count = (connectedOwners.get(owner) || 1) - 1;
        if (count) connectedOwners.set(owner, count);
        else connectedOwners.delete(owner);
        scheduleNext();
    };
}

function scheduleRender<T>(owner: string, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = () => {
            void work().then(resolve, reject).finally(() => {
                activeRenders--;
                const active = (activeByOwner.get(owner) || 1) - 1;
                if (active) activeByOwner.set(owner, active);
                else activeByOwner.delete(owner);
                scheduleNext();
            });
        };
        const tasks = renderQueue.get(owner) || [];
        tasks.push(run);
        renderQueue.set(owner, tasks);
        scheduleNext();
    });
}

function removeWaiter(waiter: WorkerWaiter): void {
    const index = workerWaiters.indexOf(waiter);
    if (index >= 0) workerWaiters.splice(index, 1);
    waiter.signal?.removeEventListener("abort", waiter.abort!);
}

function finishWorkerTask(pooled: PooledWorker, result: WorkerResult | Error): void {
    const task = pooled.current;
    if (!task) return;
    pooled.current = undefined;
    pooled.busy = false;
    clearTimeout(task.timeout);
    task.signal?.removeEventListener("abort", task.abort!);
    if (result instanceof Error) task.reject(result);
    else task.resolve(result);
    dispatchWorkers();
    if (!pooled.busy) pooled.worker.unref();
}

function discardWorker(pooled: PooledWorker, error = new Error("地图计算 Worker 不可用")): void {
    if (pooled.disposed) return;
    pooled.disposed = true;
    const index = workers.indexOf(pooled);
    if (index >= 0) workers.splice(index, 1);
    void pooled.worker.terminate();
    finishWorkerTask(pooled, error);
    dispatchWorkers();
}

function createWorker(sourcePath: string): PooledWorker {
    const pooled: PooledWorker = {
        sourcePath,
        busy: false,
        disposed: false,
        worker: new Worker(new URL("./seed_worker.ts", import.meta.url), {workerData: {sourcePath}, execArgv: process.execArgv}),
    };
    pooled.worker.unref();
    pooled.worker.on("message", (message: WorkerMessage) => {
        const task = pooled.current;
        if (!task || message.requestId !== task.requestId || message.result?.type !== "check") return;
        finishWorkerTask(pooled, message.result);
    });
    pooled.worker.on("error", error => discardWorker(pooled, error instanceof Error ? error : new Error(String(error))));
    pooled.worker.on("exit", code => { if (!pooled.disposed && code !== 0) discardWorker(pooled, new Error("地图计算 Worker 意外退出")); });
    workers.push(pooled);
    return pooled;
}

function dispatchWorkers(): void {
    for (const waiter of [...workerWaiters]) {
        let pooled = workers.find(worker => !worker.busy && worker.sourcePath === waiter.sourcePath);
        if (!pooled) {
            const incompatible = workers.find(worker => !worker.busy && worker.sourcePath !== waiter.sourcePath);
            if (incompatible) discardWorker(incompatible);
            if (workers.length < MAX_CONCURRENT_RENDERS) pooled = createWorker(waiter.sourcePath);
        }
        if (!pooled) continue;
        removeWaiter(waiter);
        pooled.busy = true;
        pooled.worker.ref();
        waiter.resolve(pooled);
    }
}

function acquireWorker(sourcePath: string, signal?: AbortSignal): Promise<PooledWorker> {
    if (signal?.aborted) return Promise.reject(new Error("地图计算已取消"));
    return new Promise((resolve, reject) => {
        const waiter: WorkerWaiter = {sourcePath, resolve, reject, signal};
        waiter.abort = () => { removeWaiter(waiter); reject(new Error("地图计算已取消")); };
        signal?.addEventListener("abort", waiter.abort, {once: true});
        workerWaiters.push(waiter);
        dispatchWorkers();
    });
}

function sourceDirectory(configuredPath: unknown): string {
    const configured = typeof configuredPath === "string" ? configuredPath.trim() : "";
    const fallback = path.join(path_utils.get_project_root_path(), "service", "world_map", "vendor", "seed-map");
    const directory = configured || fallback;
    if (!fs.existsSync(path.join(directory, "js", "inline-worker-min.503f4741.js"))) throw new Error("地图计算源目录未配置");
    return directory;
}

function sourceDimension(dimension: string): string {
    return dimension === "the_nether" ? "nether" : dimension === "the_end" ? "end" : dimension;
}

function tileParams(): {tileSize: number; tileScale: number} {
    return {tileSize: 512, tileScale: 4};
}

function libraries(source: string): Libraries {
    return require(path.join(source, "js", "cb3-libs.503f4741.js")) as Libraries;
}

const VERSION_ALIASES: Readonly<Record<string, string>> = {
    java_26_1: "V1_21_9",
};

export function supportedMinecraftVersions(configuredSourcePath: unknown): string[] {
    const versions = libraries(sourceDirectory(configuredSourcePath)).JavaVersion || {};
    const available = Object.keys(versions)
        .filter(version => /^V\d+(?:_\d+)*$/.test(version))
        .map(version => `java_${version.slice(1).replaceAll("_", "_")}`);
    return [...new Set([...available, ...Object.keys(VERSION_ALIASES)])].sort((left, right) => {
        const leftParts = left.slice(5).split("_").map(Number);
        const rightParts = right.slice(5).split("_").map(Number);
        for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
            const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
            if (difference) return difference;
        }
        return 0;
    });
}

export function availableBiomes(configuredSourcePath: unknown): BiomeOption[] {
    return (libraries(sourceDirectory(configuredSourcePath)).biomeList || []).flatMap(biome =>
        typeof biome?.id === "number" && Number.isSafeInteger(biome.id) && typeof biome.name === "string"
            ? [{
                id: biome.id,
                name: biome.name,
                rgb: Array.isArray(biome.rgb) && biome.rgb.length === 3 && biome.rgb.every(value => Number.isInteger(value))
                    ? biome.rgb as [number, number, number]
                    : null,
            }]
            : [],
    );
}

function palette(source: string): Array<readonly [number, number, number] | undefined> {
    return (libraries(source).biomeList || []).map(biome => {
        const rgb = biome?.rgb;
        return Array.isArray(rgb) && rgb.length === 3 && rgb.every(value => Number.isInteger(value))
            ? [rgb[0], rgb[1], rgb[2]] as const
            : undefined;
    });
}

function platform(source: string, minecraftVersion: string): object {
    const version = minecraftVersion.match(/^java_(\d+(?:_\d+)*)$/);
    if (!version) throw new Error("Minecraft 版本无效");
    const versionKey = VERSION_ALIASES[minecraftVersion] || `V${version[1]}`;
    const javaVersion = libraries(source).JavaVersion?.[versionKey];
    const edition = libraries(source).Edition?.Java;
    if (javaVersion === undefined || edition === undefined) throw new Error("Minecraft 版本不受支持");
    return {cb3World: {edition, javaVersion, config: {}}};
}

async function calculate(source: string, request: RenderRequest, tileSize: number, tileScale: number, signal?: AbortSignal): Promise<RenderedMap> {
    const minecraftVersion = platform(source, request.minecraftVersion);
    const pooled = await acquireWorker(path.join(source, "js", "inline-worker-min.503f4741.js"), signal);
    const result = await new Promise<WorkerResult>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const fail = (error: Error) => discardWorker(pooled, error);
        const task: WorkerTask = {
            requestId,
            resolve,
            reject,
            timeout: setTimeout(() => fail(new Error("地图计算超时")), 30_000),
            signal,
        };
        task.abort = () => fail(new Error("地图计算已取消"));
        if (signal?.aborted) { task.abort(); return; }
        signal?.addEventListener("abort", task.abort, {once: true});
        pooled.current = task;
        pooled.worker.postMessage({requestId, ...request, minecraftVersion, dimension: sourceDimension(request.dimension), tileSize, tileScale});
    });
    {
        const data = result.results;
        if (!data?.biomes || typeof data.biomeScale !== "number" || data.biomeScale <= 0) throw new Error("地图计算结果无效");
        const sourceBiomeIds = new Uint8Array(data.biomes);
        const sourceWidth = Math.sqrt(sourceBiomeIds.length);
        const sourceHeight = sourceWidth;
        if (!Number.isInteger(sourceWidth) || sourceWidth <= 0) throw new Error("地图像素尺寸无效");
        const width = Math.min(OUTPUT_TILE_SIZE, sourceWidth);
        const height = Math.min(OUTPUT_TILE_SIZE, sourceHeight);
        const biomeIds = Buffer.allocUnsafe(width * height);
        for (let z = 0; z < height; z++) {
            const sourceZ = Math.min(sourceHeight - 1, Math.floor(z * sourceHeight / height));
            for (let x = 0; x < width; x++) {
                const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width));
                biomeIds[z * width + x] = sourceBiomeIds[sourceZ * sourceWidth + sourceX];
            }
        }
        const pixels = Buffer.allocUnsafe(width * height * 4);
        const colors = palette(source);
        const selectedBiomes = request.biomeIds?.length ? new Set(request.biomeIds) : undefined;
        for (let index = 0; index < biomeIds.length; index++) {
            const biome = biomeIds[index];
            const sourceColor = !selectedBiomes || selectedBiomes.has(biome) ? colors[biome] || [30, 36, 31] as const : [22, 29, 23] as const;
            const offset = index * 4;
            pixels[offset] = Math.round(sourceColor[0] * .82);
            pixels[offset + 1] = Math.round(sourceColor[1] * .82);
            pixels[offset + 2] = Math.round(sourceColor[2] * .82);
            pixels[offset + 3] = 255;
        }
        return {width, height, span: tileSize, pixels, biomeIds};
    }
}

async function render(request: RenderRequest, configuredSourcePath: unknown, signal?: AbortSignal): Promise<RenderedMap> {
    const source = sourceDirectory(configuredSourcePath);
    const {tileSize, tileScale} = tileParams();
    return calculate(source, request, tileSize, tileScale, signal);
}

export function renderMap(owner: string, request: RenderRequest, configuredSourcePath: unknown, signal?: AbortSignal): Promise<RenderedMap> {
    return scheduleRender(owner, () => render(request, configuredSourcePath, signal));
}
