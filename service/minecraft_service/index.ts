import fs from "node:fs";
import {path_utils} from "../../utils/path_utils.js";
import path from "node:path";
import sharp from "sharp";

/* =========================================================
 * 类型定义
 * ======================================================= */

/**
 * Mojang API 返回的玩家档案数据。
 */
interface UapisUserinfoResponse {
    username?: string;
    uuid?: string;
    skin_url?: string;
    cape_url?: string;
}

/**
 * validateOnlineMode 的返回类型。
 */
type ValidateOnlineModeResult =
    | { status: true; id: string }
    | { status: false; error: string };

/* =========================================================
 * 正版验证
 * ========================================================= */

/**
 * 验证玩家是否为正版（在线模式）。
 *
 * 使用 uapis.cn API，通过 username 获取 UUID。
 *
 * @param username - Minecraft 玩家名
 * @returns 验证结果，正版时返回 `{ status: true, id }`，否则返回 `{ status: false, error }`
 */
export async function validateOnlineMode(username: string): Promise<ValidateOnlineModeResult> {
    try {
        const res = await fetch(
            `https://uapis.cn/api/v1/game/minecraft/userinfo?username=${encodeURIComponent(username)}`
        );
        if (!res.ok) {
            return {
                status: false as const,
                error: `请求失败: ${res.status}`
            };
        }
        const data = await res.json() as UapisUserinfoResponse;
        const id = data?.uuid;
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
    } catch (error) {
        return {
            status: false as const,
            error: `未知错误: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/* =========================================================
 * 头像加载
 * ======================================================= */


type AvatarType = "head" | "full" | "vintage" | "side";
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

    async function tryLoad(url: string): Promise<Buffer | null> {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            const isHtml = buf.length > 5 && buf.slice(0, 5).toString('utf8') === '<!doc';
            if (isHtml) return null;
            // 统一转 PNG，避免 Resvg 在 Linux 下无法渲染 WebP
            return await convertToPng(buf);
        } catch (error) {
            return null;
        }
    }

    async function convertToPng(buf: Buffer): Promise<Buffer> {
        const head = buf.slice(0, 8);
        // PNG 无需转换
        if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
            return buf;
        }
        try {
            return await sharp(buf).png().toBuffer();
        } catch (e) {
            return buf;
        }
    }

    const isOnlineMode = await validateOnlineMode(username);

    if (!isOnlineMode.status) {
        try {
            const img = await tryLoad(`https://littleskin.cn/avatar/player/${username}`);
            if (img) return img;
        } catch (e) {}
    } else {
        try {
            const url =
                `https://land.wupeng1.top/api/generate/${selected.model}` +
                `/mojang/${username}` +
                `?type=${selected.type}&scale=${selected.scale}`;
            const img = await tryLoad(url);
            if (img) return img;
        } catch (e) {}
        try {
            const img = await tryLoad(`https://mineskin.eu/helm/${username}`);
            if (img) return img;
        } catch (e) {}
    }

    const stevePath = path.join(path_utils.get_project_root_path(), "/service/minecraft_service/data/steve.png");
    const steveBuf = fs.readFileSync(stevePath);
    return await convertToPng(steveBuf);
}

