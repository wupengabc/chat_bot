import type {Express, Request, Response} from "express";
import {get_game_adapter} from "../../../../../game_adapter/index.js";

interface BangxiGameInstance {
    status?: string;
    config?: {username?: unknown};
}

export async function init(app: Express) {
    app.get("/api/game/info", (_request: Request, response: Response) => {
        const instance = get_game_adapter("mineflayer", "bangxi") as BangxiGameInstance | undefined;
        const username = typeof instance?.config?.username === "string"
            ? instance.config.username.trim()
            : "";

        response.json({
            success: true,
            available: instance?.status === "running" && Boolean(username),
            bot_username: username || null,
        });
    });
}
