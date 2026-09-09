import type {Express, Request, Response} from "express";
import {get_storage} from "../../../../../storage/index.js";
import {log_utils} from "../../../../../utils/log_utils.js";
import {require_admin} from "../auth.js";

interface BangxiStorage {
    database: any;
}

function getBangxiStorage(): BangxiStorage | undefined {
    return get_storage("bangxi_server_storage") as BangxiStorage | undefined;
}

function getTodayRange(): {start: string; end: string} {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}

export async function init(app: Express) {
    app.get("/api/admin/overview", require_admin, (request: Request, response: Response) => {
        try {
            const storage = getBangxiStorage();
            if (!storage) {
                response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
                return;
            }

            const db = storage.database;
            const today = getTodayRange();

            const totalUsers = (db.prepare("SELECT COUNT(*) AS total FROM user").get() as {total: number}).total;
            const todayActive = (db.prepare("SELECT COUNT(DISTINCT username) AS total FROM message WHERE create_time >= ? AND create_time < ?").get(today.start, today.end) as {total: number}).total;
            const todayMessages = (db.prepare("SELECT COUNT(*) AS total FROM message WHERE create_time >= ? AND create_time < ?").get(today.start, today.end) as {total: number}).total;
            const todayPoints = (db.prepare("SELECT COALESCE(SUM(num), 0) AS total FROM point_log WHERE create_at >= ? AND create_at < ? AND action = 'add'").get(today.start, today.end) as {total: number}).total;
            const landmarks = (db.prepare("SELECT COUNT(*) AS total FROM landmark").get() as {total: number}).total;
            const shops = (db.prepare("SELECT COUNT(*) AS total FROM shop_list").get() as {total: number}).total;

            const recentUsers = db.prepare(
                "SELECT username, create_time FROM user ORDER BY create_time DESC LIMIT 5"
            ).all() as Array<{username: string; create_time: string}>;

            const recentPoints = db.prepare(
                "SELECT game_id, action, num, reason, create_at FROM point_log ORDER BY create_at DESC LIMIT 5"
            ).all() as Array<{game_id: string; action: string; num: number; reason: string; create_at: string}>;

            const recentMessages = db.prepare(
                "SELECT username, content, create_time FROM message WHERE message_type = 'public' ORDER BY create_time DESC LIMIT 5"
            ).all() as Array<{username: string; content: string; create_time: string}>;

            const recentActivity: Array<{type: string; text: string; time: string}> = [
                ...recentUsers.map(item => ({
                    type: "user",
                    text: `新用户 ${item.username} 注册`,
                    time: item.create_time,
                })),
                ...recentPoints.map(item => ({
                    type: "point",
                    text: `${item.game_id} ${item.action === "add" ? "获得" : "消费"} ${item.num / 100} 积分${item.reason ? `（${item.reason}）` : ""}`,
                    time: item.create_at,
                })),
                ...recentMessages.map(item => ({
                    type: "message",
                    text: `${item.username}：${item.content.slice(0, 30)}${item.content.length > 30 ? "..." : ""}`,
                    time: item.create_time,
                })),
            ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

            response.json({
                success: true,
                stats: {
                    total_users: totalUsers,
                    today_active: todayActive,
                    today_messages: todayMessages,
                    today_points: todayPoints / 100,
                    landmarks,
                    shops,
                },
                recent_activity: recentActivity,
            });
        } catch (error) {
            log_utils.logger("web_api", "admin", `获取管理概览失败: ${error instanceof Error ? error.message : String(error)}`, "error");
            response.status(500).json({success: false, message: "获取管理概览失败"});
        }
    });
}
