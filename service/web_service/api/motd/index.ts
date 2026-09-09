import type {Express, Request, Response} from "express";
import {get_game_adapter} from "../../../../game_adapter/index.js";
import {queryMinecraftMotd, type MinecraftMotdInfo} from "../../../minecraft_service/motd.js";

const MOTD_CACHE_TTL_MS = 15 * 1000;

interface BangxiGameInstance {
    config?: {
        host?: string;
        port?: number;
    };
}

let motdCache: {expiresAt: number, value: MinecraftMotdInfo | null} | null = null;
let pendingMotd: Promise<MinecraftMotdInfo | null> | null = null;

async function getMotdInfo(gameInstance: BangxiGameInstance | undefined): Promise<MinecraftMotdInfo | null> {
    if (motdCache && Date.now() < motdCache.expiresAt) return motdCache.value;
    if (pendingMotd) return pendingMotd;

    pendingMotd = (async () => {
        const host = gameInstance?.config?.host;
        if (!host) return null;

        try {
            const port = gameInstance.config?.port;
            /*
             * 端口为 25565（默认值）时不显式传入，
             * 让底层优先进行 _minecraft._tcp SRV 解析。
             */
            const results = await queryMinecraftMotd(host, port && port !== 25565 ? port : undefined);
            return results.map(result => result.motd)
                .find((value): value is MinecraftMotdInfo => value?.status === "online") ?? null;
        } catch {
            return null;
        }
    })().then(value => {
        motdCache = {expiresAt: Date.now() + MOTD_CACHE_TTL_MS, value};
        return value;
    }).finally(() => {
        pendingMotd = null;
    });

    return pendingMotd;
}

export async function init(app: Express) {
    app.get("/api/motd", async (_request: Request, response: Response) => {
        const gameInstance = get_game_adapter("mineflayer", "bangxi") as BangxiGameInstance | undefined;
        const motd = await getMotdInfo(gameInstance);
        response.json({success: true, available: motd !== null, motd});
    });
}
