import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {path_utils} from "../../../../utils/path_utils.js";
import {renderMap, type RenderedMap, type RenderRequest} from "./renderer.js";

const MAGIC = Buffer.from("WMAPC001");
const HEADER_BYTES = 28;
const CACHE_REVISION = 5;
const pending = new Map<string, Promise<RenderedMap>>();
let cacheGeneration = 0;
let cachedSalt: Buffer | null = null;
let clearOperation: Promise<{files: number; bytes: number}> | null = null;

function cacheRoot(): string {
    return path.join(path_utils.get_project_root_path(), "service", "world_map", "cache");
}

function cacheSalt(): Buffer {
    if (cachedSalt) return cachedSalt;
    const directory = cacheRoot();
    const saltPath = path.join(directory, ".salt");
    fs.mkdirSync(directory, {recursive: true});
    try {
        const existing = fs.readFileSync(saltPath);
        if (existing.length === 32) return cachedSalt = existing;
    } catch {}
    const salt = crypto.randomBytes(32);
    try {
        fs.writeFileSync(saltPath, salt, {flag: "wx"});
        return cachedSalt = salt;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = fs.readFileSync(saltPath);
        if (existing.length !== 32) throw new Error("地图缓存密钥无效");
        return cachedSalt = existing;
    }
}

function cacheKey(request: RenderRequest): string {
    const payload = JSON.stringify({
        revision: CACHE_REVISION,
        seed: request.seed,
        minecraftVersion: request.minecraftVersion,
        dimension: request.dimension,
        x: request.x,
        z: request.z,
        biomeIds: [...(request.biomeIds || [])].sort((left, right) => left - right),
    });
    return crypto.createHmac("sha256", cacheSalt()).update(payload).digest("hex");
}

function cachePath(key: string): string {
    return path.join(cacheRoot(), key.slice(0, 2), `${key}.bin`);
}

async function readCache(filePath: string): Promise<RenderedMap | null> {
    try {
        const data = await fs.promises.readFile(filePath);
        if (data.length < HEADER_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) return null;
        const width = data.readUInt32LE(8), height = data.readUInt32LE(12), span = data.readUInt32LE(16);
        const pixelBytes = data.readUInt32LE(20), biomeBytes = data.readUInt32LE(24);
        if (!width || !height || width > 4096 || height > 4096 || !span || pixelBytes !== width * height * 4 || biomeBytes !== width * height || data.length !== HEADER_BYTES + pixelBytes + biomeBytes) return null;
        return {
            width,
            height,
            span,
            pixels: Buffer.from(data.subarray(HEADER_BYTES, HEADER_BYTES + pixelBytes)),
            biomeIds: Buffer.from(data.subarray(HEADER_BYTES + pixelBytes)),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

async function writeCache(filePath: string, map: RenderedMap): Promise<void> {
    const header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header);
    header.writeUInt32LE(map.width, 8);
    header.writeUInt32LE(map.height, 12);
    header.writeUInt32LE(map.span, 16);
    header.writeUInt32LE(map.pixels.length, 20);
    header.writeUInt32LE(map.biomeIds.length, 24);
    await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
    const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
        await fs.promises.writeFile(temporary, Buffer.concat([header, map.pixels, map.biomeIds]), {flag: "wx"});
        await fs.promises.rename(temporary, filePath);
    } finally {
        await fs.promises.rm(temporary, {force: true}).catch(() => {});
    }
}

function waitForResult(result: Promise<RenderedMap>, signal?: AbortSignal): Promise<RenderedMap> {
    if (!signal) return result;
    if (signal.aborted) return Promise.reject(new Error("地图计算已取消"));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("地图计算已取消"));
        signal.addEventListener("abort", abort, {once: true});
        void result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

export async function renderCachedMap(owner: string, request: RenderRequest, configuredSourcePath: unknown, signal?: AbortSignal): Promise<RenderedMap> {
    if (clearOperation) await clearOperation;
    const key = cacheKey(request);
    let result = pending.get(key);
    if (!result) {
        const filePath = cachePath(key);
        const generation = cacheGeneration;
        result = (async () => {
            const cached = await readCache(filePath);
            if (cached) return cached;
            const rendered = await renderMap(owner, request, configuredSourcePath);
            if (generation === cacheGeneration) await writeCache(filePath, rendered);
            return rendered;
        })().finally(() => pending.delete(key));
        pending.set(key, result);
    }
    return waitForResult(result, signal);
}

async function cacheFiles(directory: string): Promise<{files: number; bytes: number}> {
    let files = 0, bytes = 0;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(directory, {withFileTypes: true}); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {files, bytes};
        throw error;
    }
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = await cacheFiles(entryPath);
            files += nested.files; bytes += nested.bytes;
        } else if (entry.name.endsWith(".bin")) {
            files++; bytes += (await fs.promises.stat(entryPath)).size;
        }
    }
    return {files, bytes};
}

export function worldMapCacheSummary(): Promise<{files: number; bytes: number}> {
    return cacheFiles(cacheRoot());
}

export async function clearWorldMapCache(): Promise<{files: number; bytes: number}> {
    if (clearOperation) return clearOperation;
    cacheGeneration++;
    cachedSalt = null;
    clearOperation = (async () => {
        const summary = await worldMapCacheSummary();
        await fs.promises.rm(cacheRoot(), {recursive: true, force: true});
        return summary;
    })();
    try {
        return await clearOperation;
    } finally {
        cachedSalt = null;
        clearOperation = null;
    }
}
