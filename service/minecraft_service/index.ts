import fs from "node:fs";
import {path_utils} from "../../utils/path_utils.js";
import path from "node:path";

/* =========================================================
 * 类型定义
 * ======================================================= */

/**
 * Mojang API 返回的玩家档案数据。
 */
interface MojangProfileResponse {
    id?: string;
    name?: string;
}

/**
 * validateOnlineMode 的返回类型。
 */
type ValidateOnlineModeResult =
    | { status: true; id: string }
    | { status: false; error: string };

/**
 * 头像渲染类型。
 */
type AvatarType = "head" | "full" | "vintage" | "side";

/* =========================================================
 * 正版验证
 * ======================================================= */

/**
 * 验证玩家是否为正版（在线模式）。
 *
 * @param username - Minecraft 玩家名
 * @returns 验证结果，正版时返回 `{ status: true, id }`，否则返回 `{ status: false, error }`
 */
export async function validateOnlineMode(username: string): Promise<ValidateOnlineModeResult> {
    return await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`)
        .then(res => res.ok ? res.json() : null)
        .then((data: MojangProfileResponse | null) => {
            const id = data?.id;
            if (id) {
                return {
                    status: true as const,
                    id
                };
            } else {
                return {
                    status: false as const,
                    error: "未找到该玩家"
                };
            }
        })
        .catch((error: Error) => {
            return {
                status: false as const,
                error: `未知错误: ${error.message}`
            };
        });
}

/* =========================================================
 * 头像加载
 * ======================================================= */

/**
 * 加载玩家头像图片，返回图片 Buffer。
 *
 * 根据玩家是否为正版，依次尝试多个头像源，
 * 全部失败时回退到本地 Steve 兜底图片。
 *
 * @param username - Minecraft 玩家名
 * @param type     - 头像类型，默认 "head"
 * @returns 图片 Buffer
 */
export async function loadAvatarImage(username: string, type: AvatarType = "head"): Promise<Buffer> {
    const candidates: Record<AvatarType, { model: string; type: string; scale: string }> = {
        head:    { model: "minimal", type: "head", scale: "150" },
        full:    { model: "minimal", type: "full", scale: "100" },
        vintage: { model: "vintage", type: "full", scale: "150" },
        side:    { model: "side",    type: "full", scale: "100" }
    };
    const selected = candidates[type] || candidates.head;

    /**
     * 尝试从 URL 加载图片，返回 Buffer。
     *
     * @param url - 图片地址
     * @returns 成功时返回 Buffer，失败时返回 null
     */
    async function tryLoad(url: string): Promise<Buffer | null> {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            return Buffer.from(await res.arrayBuffer());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`加载图片失败 (${url}):`, message);
            return null;
        }
    }

    const isOnlineMode = await validateOnlineMode(username);
    if (!isOnlineMode.status) {
        // 离线模式：尝试 LittleSkin
        try {
            const img = await tryLoad(
                `https://littleskin.cn/avatar/player/${username}`
            );
            if (img) return img;
        } catch (e) {}
    } else {
        // 正版模式：依次尝试 xzt 和 mineskin
        try {
            const url =
                `https://land.wupeng1.top/api/generate/${selected.model}` +
                `/mojang/${username}` +
                `?type=${selected.type}&scale=${selected.scale}`;

            const img = await tryLoad(url);
            if (img) return img;
        } catch (e) {
            // xzt 服务不可用，继续 fallback
        }
        try {
            const img = await tryLoad(
                `https://mineskin.eu/helm/${username}`
            );
            if (img) return img;
        } catch (e) {}
    }
    // 本地 Steve 最终兜底
    return fs.readFileSync(path.join(path_utils.get_project_root_path(), "/service/minecraft_service/data/steve.png") );
}

