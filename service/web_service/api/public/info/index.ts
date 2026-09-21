import {createHash} from "node:crypto";
import type {Express, Request, Response} from "express";
import {game_adapter_event, get_game_adapter} from "../../../../../game_adapter/index.js";
import {get_storage} from "../../../../../storage/index.js";

const INACTIVE_AFTER_MS = 60_000;

interface ApiKeyUser {
    username: string;
}

interface PointChangeResult {
    success: boolean;
    message?: string;
    point?: number;
}

interface PublicMessage {
    username: string;
    content: string;
    create_time: string;
}

interface MineflayerPlayer {
    username?: string;
    displayName?: {toString(): string} | string;
}

interface BangxiGameInstance {
    status?: string;
    bot?: {players?: Record<string, MineflayerPlayer>} | null;
}

interface KeyQueue {
    lastAccessAt: number;
    messages: PublicMessage[];
}

function isBangxiMineflayer(data: any): boolean {
    return data?.adapter === "mineflayer" && data?.instance_name === "bangxi";
}

function getPlayers() {
    const instance = get_game_adapter("mineflayer", "bangxi") as BangxiGameInstance | undefined;
    if (instance?.status !== "running" || !instance.bot?.players) return [];
    return Object.entries(instance.bot.players).map(([key, player]) => ({
        username: String(player.username || key),
        display_name: String(player.displayName || player.username || key),
    })).sort((a, b) => a.username.localeCompare(b.username));
}

export async function init(app: Express) {
    const queues = new Map<string, KeyQueue>();
    let latestMessage: PublicMessage | null = null;

    const onMessage = (data: any) => {
        if (!isBangxiMineflayer(data) || data.position !== "chat" || typeof data.message?.plainText !== "string") return;
        const message: PublicMessage = {
            username: String(data.player_name || data.message.username || "unknown"),
            content: data.message.plainText,
            create_time: new Date().toISOString(),
        };
        latestMessage = message;
        for (const queue of queues.values()) queue.messages.push(message);
    };

    const cleanupTimer = setInterval(() => {
        const cutoff = Date.now() - INACTIVE_AFTER_MS;
        for (const [keyHash, queue] of queues) if (queue.lastAccessAt < cutoff) queues.delete(keyHash);
    }, INACTIVE_AFTER_MS);
    cleanupTimer.unref();
    game_adapter_event.on("message", onMessage);

    app.get("/api/public/info", (request: Request, response: Response) => {
        const apiKey = typeof request.query.apikey === "string" ? request.query.apikey.trim() : "";
        const storage = get_storage("bangxi_server_storage") as {
            verify_api_key?: (key: string) => ApiKeyUser | null;
            change_point?: (username: string, action: "remove", point: number, reason: string, ext: string) => PointChangeResult;
        } | undefined;
        const user = apiKey ? storage?.verify_api_key?.(apiKey) : null;
        if (!user) {
            response.status(401).json({success: false, message: "API key 无效"});
            return;
        }

        if (!storage?.change_point) {
            response.status(503).json({success: false, message: "积分服务不可用"});
            return;
        }
        const charge = storage.change_point(user.username, "remove", 0.01, "调用公开信息接口", "public_info");
        if (!charge.success) {
            response.status(402).json({
                success: false,
                message: charge.message || "扣除积分失败",
                required_point: 0.01,
                point: charge.point,
            });
            return;
        }

        const now = Date.now();
        const keyHash = createHash("sha256").update(apiKey).digest("hex");
        const existing = queues.get(keyHash);
        const isFirstRequest = !existing || now - existing.lastAccessAt > INACTIVE_AFTER_MS;
        const queue = isFirstRequest ? {lastAccessAt: now, messages: []} : existing;
        if (!queue) return;
        queue.lastAccessAt = now;
        queues.set(keyHash, queue);

        const messages = isFirstRequest
            ? latestMessage ? [latestMessage] : []
            : queue.messages.splice(0);
        response.json({success: true, cost: 0.01, point: charge.point, messages, players: getPlayers()});
    });

    return () => {
        clearInterval(cleanupTimer);
        game_adapter_event.off("message", onMessage);
        queues.clear();
    };
}
