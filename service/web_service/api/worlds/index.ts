import fs from "node:fs";
import path from "node:path";
import type {Express, Request, Response} from "express";
import {path_utils} from "../../../../utils/path_utils.js";
import {verify_resource_token} from "../user/auth/index.js";
import {availableBiomes, supportedMinecraftVersions} from "./renderer.js";
import {clearWorldMapCache, worldMapCacheSummary} from "./cache.js";
import {record_audit} from "../../../../utils/audit_utils.js";
import {require_admin, type AdminRequest} from "../admin/auth.js";

type World = {id: string; name: string; minecraftVersion: string; enabled?: boolean};
type WorldMapConfig = {enabled?: boolean; allowed_usernames?: unknown; renderer_source_path?: unknown; world_seeds?: unknown; worlds?: unknown};
const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DIMENSIONS = new Set(["overworld", "the_nether", "the_end"]);
const MAX_ZOOM = 8;
const MAX_COORDINATE = 1_000_000;

function configPath() { return path.join(path_utils.get_project_root_path(), "service", "world_map", "config.json"); }

function config(): WorldMapConfig | null {
    try { return JSON.parse(fs.readFileSync(configPath(), "utf8")) as WorldMapConfig; } catch { return null; }
}

function isManager(role: string) { return role === "admin" || role === "owner"; }

function authorized(request: Request, response: Response): {username: string; role: string; config: WorldMapConfig} | null {
    const user = verify_resource_token(request);
    if (!user) { response.status(401).json({success: false, message: "需要有效登录"}); return null; }
    const settings = config();
    if (!settings?.enabled) { response.status(404).json({success: false, message: "世界地图未启用"}); return null; }
    const allowed = Array.isArray(settings.allowed_usernames) ? settings.allowed_usernames.filter((item): item is string => typeof item === "string") : [];
    if (!isManager(user.role) && !allowed.some(name => name.toLocaleLowerCase() === user.username.toLocaleLowerCase())) {
        response.status(403).json({success: false, message: "你没有世界地图的访问权限"}); return null;
    }
    return {...user, config: settings};
}

function worlds(settings: WorldMapConfig): World[] {
    if (!Array.isArray(settings.worlds)) return [];
    return settings.worlds.filter((item): item is World => !!item && typeof item === "object" && WORLD_ID.test((item as World).id) && typeof (item as World).name === "string" && typeof (item as World).minecraftVersion === "string" && (item as World).enabled !== false);
}

function integer(value: unknown, min: number, max: number): number | null {
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function worldSeed(settings: WorldMapConfig, worldId: string): string | null {
    if (!settings.world_seeds || typeof settings.world_seeds !== "object") return null;
    const seed = (settings.world_seeds as Record<string, unknown>)[worldId];
    return typeof seed === "string" && /^-?\d{1,20}$/.test(seed) ? seed : null;
}

export {type WorldMapConfig};

export function getWorldMapConfig(): WorldMapConfig | null { return config(); }

export async function init(app: Express) {
    app.get("/api/admin/world-map/cache", require_admin, async (_request: AdminRequest, response) => {
        try {
            response.json({success: true, cache: await worldMapCacheSummary()});
        } catch {
            response.status(500).json({success: false, message: "读取地图缓存状态失败"});
        }
    });

    app.delete("/api/admin/world-map/cache", require_admin, async (request: AdminRequest, response) => {
        try {
            const cleared = await clearWorldMapCache();
            record_audit({actor: request.admin!.username, action: "clear_world_map_cache", target: "service/world_map/cache", detail: `已清理 ${cleared.files} 个地图缓存文件`, ip: request.ip || request.socket.remoteAddress || "unknown", result: "success"});
            response.json({success: true, cleared});
        } catch {
            record_audit({actor: request.admin!.username, action: "clear_world_map_cache", target: "service/world_map/cache", detail: "地图缓存清理失败", ip: request.ip || request.socket.remoteAddress || "unknown", result: "failed"});
            response.status(500).json({success: false, message: "清理地图缓存失败"});
        }
    });

    app.get("/api/worlds/access", (request, response) => {
        if (!authorized(request, response)) return;
        response.json({success: true, allowed: true});
    });

    app.get("/api/worlds", (request, response) => {
        const access = authorized(request, response);
        if (!access) return;
        try {
            response.json({
                success: true,
                worlds: worlds(access.config).map(({id, name, minecraftVersion}) => ({id, name, minecraftVersion})),
                versions: supportedMinecraftVersions(access.config.renderer_source_path),
                biomes: availableBiomes(access.config.renderer_source_path),
            });
        } catch {
            response.status(503).json({success: false, message: "地图计算器不可用"});
        }
    });

    app.get("/api/worlds/:worldId/pois", async (request, response) => {
        const access = authorized(request, response);
        if (!access) return;
        const worldId = request.params.worldId;
        const dimension = request.query.dimension;
        const keys = ["minX", "maxX", "minZ", "maxZ"] as const;
        const bounds = Object.fromEntries(keys.map(key => [key, integer(request.query[key], -MAX_COORDINATE, MAX_COORDINATE)]));
        if (typeof worldId !== "string" || !worlds(access.config).some(item => item.id === worldId) || typeof dimension !== "string" || !DIMENSIONS.has(dimension) || keys.some(key => bounds[key] === null) || bounds.maxX! < bounds.minX! || bounds.maxZ! < bounds.minZ! || bounds.maxX! - bounds.minX! > 20_000 || bounds.maxZ! - bounds.minZ! > 20_000) { response.status(400).json({success: false, message: "兴趣点查询参数无效"}); return; }
        response.status(501).json({success: false, message: "兴趣点图层尚未提供"});
    });

    return () => {};
}
