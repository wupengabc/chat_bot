import WebSocket, {WebSocketServer} from "ws";
import type {IncomingMessage, Server} from "node:http";
import type {Request} from "express";
import {verify_resource_token} from "../user/auth/index.js";
import {connectRenderOwner, supportedMinecraftVersions} from "./renderer.js";
import {renderCachedMap} from "./cache.js";

type World = {id: string; name: string; minecraftVersion: string; enabled?: boolean};
type WorldMapConfig = {enabled?: boolean; allowed_usernames?: unknown; renderer_source_path?: unknown; world_seeds?: unknown; worlds?: unknown};
type Access = {username: string; role: string; config: WorldMapConfig};
type MapRequest = {type?: unknown; requestId?: unknown; requestIds?: unknown; worldId?: unknown; dimension?: unknown; x?: unknown; z?: unknown; biomeIds?: unknown};

const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DIMENSIONS = new Set(["overworld", "the_nether", "the_end"]);
const MAX_COORDINATE = 1_000_000;
const TILE_SPAN = 512;
const MAP_FRAME_MAGIC = 0x574d4150;
const MAP_FRAME_HEADER_BYTES = 28;

function integer(value: unknown, min: number, max: number): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function permitted(token: unknown, readConfig: () => WorldMapConfig | null): Access | null {
    const user = verify_resource_token({header: name => name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : undefined} as Request);
    const config = readConfig();
    if (!user || !config?.enabled) return null;
    const allowed = Array.isArray(config.allowed_usernames) ? config.allowed_usernames.filter((item): item is string => typeof item === "string") : [];
    if (user.role !== "admin" && user.role !== "owner" && !allowed.some(name => name.toLocaleLowerCase() === user.username.toLocaleLowerCase())) return null;
    return {...user, config};
}

function worlds(config: WorldMapConfig): World[] {
    return Array.isArray(config.worlds) ? config.worlds.filter((item): item is World => !!item && typeof item === "object" && WORLD_ID.test((item as World).id) && typeof (item as World).name === "string" && typeof (item as World).minecraftVersion === "string" && (item as World).enabled !== false) : [];
}

function seed(config: WorldMapConfig, worldId: string): string | null {
    const value = config.world_seeds && typeof config.world_seeds === "object" ? (config.world_seeds as Record<string, unknown>)[worldId] : null;
    return typeof value === "string" && /^-?\d{1,20}$/.test(value) ? value : null;
}

function send(socket: WebSocket, payload: object) { socket.send(JSON.stringify(payload)); }

function sendMap(socket: WebSocket, requestId: string, x: number, z: number, map: Awaited<ReturnType<typeof renderCachedMap>>) {
    const encodedRequestId = Buffer.from(requestId, "utf8");
    const header = Buffer.alloc(MAP_FRAME_HEADER_BYTES);
    header.writeUInt32BE(MAP_FRAME_MAGIC, 0);
    header.writeUInt8(1, 4);
    header.writeUInt8(encodedRequestId.length, 5);
    header.writeUInt16LE(map.width, 6);
    header.writeUInt16LE(map.height, 8);
    header.writeUInt32LE(map.span, 12);
    header.writeInt32LE(x, 16);
    header.writeInt32LE(z, 20);
    header.writeUInt32LE(map.pixels.length, 24);
    socket.send(Buffer.concat([header, encodedRequestId, map.pixels, map.biomeIds]), {binary: true});
}

export function initWorldMapSocket(server: Server, readConfig: () => WorldMapConfig | null): () => void {
    const socketServer = new WebSocketServer({noServer: true, maxPayload: 2048});
    const upgrade = (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
        if (!request.url?.startsWith("/api/worlds/socket")) return;
        socketServer.handleUpgrade(request, socket, head, webSocket => {
            socketServer.emit("connection", webSocket, request);
        });
    };
    server.on("upgrade", upgrade);
    socketServer.on("connection", (socket: WebSocket) => {
        const activeRequestIds = new Set<string>();
        const requestControllers = new Map<string, AbortController>();
        let access: Access | null = null;
        let disconnectOwner: (() => void) | undefined;
        const authenticationTimeout = setTimeout(() => socket.close(1008, "authentication required"), 5_000);
        socket.on("message", async raw => {
            let request: MapRequest;
            try { request = JSON.parse(raw.toString()) as MapRequest; } catch { send(socket, {type: "error", message: "Socket 请求格式无效"}); return; }
            if (!access) {
                if (request.type !== "authenticate" || typeof (request as MapRequest & {token?: unknown}).token !== "string") { socket.close(1008, "authentication required"); return; }
                access = permitted((request as MapRequest & {token: string}).token, readConfig);
                clearTimeout(authenticationTimeout);
                if (!access) { socket.close(1008, "access denied"); return; }
                disconnectOwner = connectRenderOwner(access.username.toLocaleLowerCase());
                send(socket, {type: "authenticated"});
                return;
            }
            if (request.type === "cancel") {
                const requestIds = Array.isArray((request as MapRequest & {requestIds?: unknown}).requestIds)
                    ? (request as MapRequest & {requestIds: unknown[]}).requestIds
                    : [request.requestId];
                for (const requestId of requestIds) {
                    if (typeof requestId !== "string") continue;
                    const controller = requestControllers.get(requestId);
                    if (controller) controller.abort();
                    else send(socket, {type: "cancelled", requestId});
                }
                return;
            }
            if (activeRequestIds.size >= 4) { send(socket, {type: "error", requestId: request.requestId, message: "同时最多生成四个地图区块"}); return; }
            const x = integer(request.x, -MAX_COORDINATE, MAX_COORDINATE - TILE_SPAN), z = integer(request.z, -MAX_COORDINATE, MAX_COORDINATE - TILE_SPAN);
            const world = typeof request.worldId === "string" ? worlds(access.config).find(item => item.id === request.worldId) : undefined;
            const biomeIds = Array.isArray(request.biomeIds) && request.biomeIds.length <= 48 && request.biomeIds.every(id => integer(id, 0, 255) !== null)
                ? request.biomeIds as number[]
                : null;
            const minecraftVersion = world?.minecraftVersion;
            let versions: string[] = [];
            try { versions = supportedMinecraftVersions(access.config.renderer_source_path); } catch {}
            if (request.type !== "map" || typeof request.requestId !== "string" || request.requestId.length > 64 || !world || typeof request.dimension !== "string" || !DIMENSIONS.has(request.dimension) || x === null || z === null || biomeIds === null || !minecraftVersion || !versions.includes(minecraftVersion)) {
                send(socket, {type: "error", requestId: request.requestId, message: "地图请求参数无效"}); return;
            }
            const worldSeed = seed(access.config, world.id);
            if (!worldSeed) { send(socket, {type: "error", requestId: request.requestId, message: "该世界尚未配置种子"}); return; }
            if (activeRequestIds.has(request.requestId)) { send(socket, {type: "error", requestId: request.requestId, message: "地图请求重复"}); return; }
            activeRequestIds.add(request.requestId);
            const controller = new AbortController();
            requestControllers.set(request.requestId, controller);
            try {
                const map = await renderCachedMap(access.username.toLocaleLowerCase(), {seed: worldSeed, minecraftVersion, dimension: request.dimension, x, z, biomeIds}, access.config.renderer_source_path, controller.signal);
                if (controller.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
                sendMap(socket, request.requestId, x, z, map);
            } catch {
                if (!controller.signal.aborted && socket.readyState === WebSocket.OPEN) send(socket, {type: "error", requestId: request.requestId, message: "地图计算器不可用"});
            } finally {
                activeRequestIds.delete(request.requestId);
                requestControllers.delete(request.requestId);
                if (controller.signal.aborted && socket.readyState === WebSocket.OPEN) send(socket, {type: "cancelled", requestId: request.requestId});
            }
        });
        socket.on("close", () => { clearTimeout(authenticationTimeout); for (const controller of requestControllers.values()) controller.abort(); disconnectOwner?.(); });
    });
    return () => { server.off("upgrade", upgrade); socketServer.close(); };
}
