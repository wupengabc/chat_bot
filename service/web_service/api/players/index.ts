import type {Express, Request, Response} from "express";
import {get_game_adapter} from "../../../../game_adapter/index.js";
import {get_storage} from "../../../../storage/index.js";
import {verify_resource_token} from "../user/auth/index.js";

interface MineflayerPlayer {
    username?: string;
    displayName?: {toString(): string} | string;
    ping?: number;
    uuid?: string;
}

interface BangxiGameInstance {
    status?: string;
    bot?: {
        players?: Record<string, MineflayerPlayer>;
    } | null;
}

interface BangxiStorage {
    search_player_names(page: number, limit: number, like: string): {names: string[], total: number};
}

function parsePositiveInteger(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function init(app: Express) {
    app.get("/api/players/names", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"});
            return;
        }

        const page = parsePositiveInteger(request.query.page, 1);
        const requestedLimit = parsePositiveInteger(request.query.limit, 20);
        const rawLike = request.query.like;
        if (page === null || requestedLimit === null) {
            response.status(400).json({success: false, message: "page 和 limit 必须是正整数"});
            return;
        }
        if (rawLike !== undefined && typeof rawLike !== "string") {
            response.status(400).json({success: false, message: "like 必须是字符串"});
            return;
        }

        const limit = Math.min(requestedLimit, 20);
        const like = (rawLike || "").trim();
        const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
        if (!storage?.search_player_names) {
            response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
            return;
        }

        const result = storage.search_player_names(page, limit, like);
        const totalPages = Math.max(1, Math.ceil(result.total / limit));
        response.json({
            success: true,
            names: result.names,
            pagination: {
                page,
                limit,
                total: result.total,
                total_pages: totalPages,
                has_previous: page > 1,
                has_next: page < totalPages,
            },
        });
    });

    app.get("/api/players", (_request: Request, response: Response) => {
        const gameInstance = get_game_adapter("mineflayer", "bangxi") as BangxiGameInstance | undefined;
        if (gameInstance?.status !== "running" || !gameInstance.bot?.players) {
            response.json({success: true, available: false, players: []});
            return;
        }

        const players = Object.entries(gameInstance.bot.players)
            .map(([key, player]) => ({
                username: String(player.username || key),
                display_name: String(player.displayName || player.username || key),
                ping: typeof player.ping === "number" ? player.ping : null,
                uuid: typeof player.uuid === "string" ? player.uuid : null,
            }))
            .sort((a, b) => a.username.localeCompare(b.username));

        response.json({success: true, available: true, players});
    });
}
