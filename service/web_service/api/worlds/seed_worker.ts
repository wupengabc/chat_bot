import fs from "node:fs";
import vm from "node:vm";
import {parentPort, workerData} from "node:worker_threads";

type WorkerRequest = {
    requestId: string;
    seed: string;
    minecraftVersion: unknown;
    dimension: string;
    tileSize: number;
    tileScale: number;
    x: number;
    z: number;
};

let bundle = "";

class CapturedBlob {
    constructor(parts: unknown[]) {
        bundle = parts.map(part => String(part)).join("");
    }
}

const source = fs.readFileSync(workerData.sourcePath as string, "utf8");
vm.runInNewContext(source, {Blob: CapturedBlob});
if (!bundle) throw new Error("无法读取地图计算 Worker");

const runtime = globalThis as unknown as Record<string, unknown>;
runtime.self = globalThis;
runtime.postMessage = (message: unknown) => parentPort?.postMessage({requestId: activeRequestId, result: message});
runtime.addEventListener = (type: string, listener: (event: {data: unknown}) => void) => {
    if (type === "message") runtime.onmessage = listener;
};
vm.runInThisContext(bundle);

let activeRequestId = "";

parentPort?.on("message", (request: WorkerRequest) => {
    activeRequestId = request.requestId;
    const onmessage = runtime.onmessage as ((event: {data: unknown}) => void) | undefined;
    onmessage?.({
        data: {
            type: "check",
            params: {
                seed: request.seed,
                platform: request.minecraftVersion,
                tileSize: request.tileSize,
                tileScale: request.tileScale,
                biomeFilter: null,
                dimension: request.dimension,
                pois: [],
                showBiomes: true,
                biomeHeight: "depth0",
                showHeights: false,
                hidePoi: true,
            },
            tile: {x: request.x, z: request.z, xL: request.tileSize, zL: request.tileSize, scale: request.tileScale},
        },
    });
});
