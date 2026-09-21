import type {Express, Response} from "express";
import {get_storage} from "../../../../../storage/index.js";
import {type AdminRequest, require_admin, require_owner} from "../auth.js";

type Role = "member" | "admin" | "owner";
const roles = new Set<Role>(["member", "admin", "owner"]);

interface UserInfo { username: string; role: string; point: number; message_count: number; online_time: number; first_record_time: string; create_time: string; registered: boolean; }
interface BangxiStorage {
    search_admin_users(page: number, limit: number, filters: {keyword?: string; role?: string; registered?: boolean}): {users: UserInfo[]; total: number};
    get_user_info(username: string): unknown | null;
    create_admin_user(username: string, password: string): {success: boolean; message?: string};
    delete_admin_user(username: string): {success: boolean; deleted?: number; message?: string};
    change_point(username: string, action: "add" | "remove", point: number, reason: string, ext?: string | null): {success: boolean; point?: number; message?: string};
    change_permission(username: string, role: Role): void;
    set_user_password(username: string, password: string): void;
    get_point_logs(username: string, limit?: number): {success: boolean; game_id?: string; logs?: Array<{id: number; game_id: string; action: "add" | "remove"; num: number; reason: string; ext: string | null; create_at: string}>; message?: string};
    search_admin_point_logs(page?: number, page_size?: number, filters?: {keyword?: string; username?: string; ext?: string; create_time_from?: string; create_time_to?: string}): {logs: Array<{id: number; game_id: string; action: "add" | "remove"; num: number; reason: string; ext: string | null; create_at: string}>; total: number; page: number; page_size: number};
}

function storage(response: Response): BangxiStorage | null {
    const value = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!value?.search_admin_users || !value.get_user_info || !value.create_admin_user || !value.delete_admin_user || !value.change_point || !value.change_permission || !value.set_user_password || !value.get_point_logs || !value.search_admin_point_logs) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"}); return null;
    }
    return value;
}
function positiveInteger(value: unknown, fallback: number): number | null { if (value === undefined) return fallback; if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null; const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : null; }
function text(value: unknown, max = 256): string | undefined | null { if (value === undefined) return undefined; if (typeof value !== "string") return null; const parsed = value.trim(); return parsed.length <= max ? parsed || undefined : null; }
function username(value: unknown): string | null { const parsed = text(value, 64); return parsed === undefined ? null : parsed; }
function password(value: unknown): string | null { return typeof value === "string" && value.length >= 6 && value.length <= 128 ? value : null; }

export async function init(app: Express) {
    app.get("/api/admin/point-logs", require_admin, (request: AdminRequest, response: Response) => {
        const page = positiveInteger(request.query.page, 1), limit = positiveInteger(request.query.limit, 20);
        const keyword = text(request.query.keyword, 128), usernameFilter = text(request.query.username, 64), ext = text(request.query.ext, 128), createTimeFrom = text(request.query.create_time_from, 32), createTimeTo = text(request.query.create_time_to, 32);
        if (page === null || limit === null || keyword === null || usernameFilter === null || ext === null || createTimeFrom === null || createTimeTo === null || (createTimeFrom && createTimeTo && createTimeFrom > createTimeTo)) { response.status(400).json({success: false, message: "积分流水查询参数无效"}); return; }
        const db = storage(response); if (!db) return;
        const result = db.search_admin_point_logs(page, Math.min(limit, 100), {keyword, username: usernameFilter, ext, create_time_from: createTimeFrom, create_time_to: createTimeTo});
        const totalPages = Math.max(1, Math.ceil(result.total / result.page_size));
        response.json({success: true, logs: result.logs, pagination: {page: result.page, limit: result.page_size, total: result.total, total_pages: totalPages, has_previous: result.page > 1, has_next: result.page < totalPages}});
    });
    app.get("/api/admin/users", require_admin, (request: AdminRequest, response: Response) => {
        const page = positiveInteger(request.query.page, 1), limit = positiveInteger(request.query.limit, 20);
        const keyword = text(request.query.keyword, 64), role = text(request.query.role, 16), registeredText = text(request.query.registered, 8);
        const registered = registeredText === undefined ? undefined : registeredText === "true" ? true : registeredText === "false" ? false : null;
        if (page === null || limit === null || keyword === null || role === null || registered === null || (role !== undefined && !roles.has(role as Role))) { response.status(400).json({success: false, message: "用户查询参数无效"}); return; }
        const db = storage(response); if (!db) return;
        const safeLimit = Math.min(limit, 100), result = db.search_admin_users(page, safeLimit, {keyword, role, registered});
        const totalPages = Math.max(1, Math.ceil(result.total / safeLimit));
        response.json({success: true, users: result.users, pagination: {page, limit: safeLimit, total: result.total, total_pages: totalPages, has_previous: page > 1, has_next: page < totalPages}});
    });
    app.get("/api/admin/users/:username", require_admin, (request: AdminRequest, response: Response) => { const name = username(request.params.username), db = storage(response); if (!name || !db) { if (!name) response.status(400).json({success: false, message: "用户名无效"}); return; } const user = db.get_user_info(name); if (!user) { response.status(404).json({success: false, message: "用户不存在"}); return; } response.json({success: true, user}); });
    app.get("/api/admin/users/:username/point-logs", require_admin, (request: AdminRequest, response: Response) => { const name = username(request.params.username), db = storage(response); if (!name || !db) { if (!name) response.status(400).json({success: false, message: "用户名无效"}); return; } const result = db.get_point_logs(name, 50); if (!result.success) { response.status(404).json({success: false, message: result.message || "用户不存在"}); return; } response.json({success: true, username: result.game_id, logs: result.logs || []}); });
    app.post("/api/admin/users", require_admin, (request: AdminRequest, response: Response) => { const name = username(request.body?.username), secret = password(request.body?.password), db = storage(response); if (!name || !secret || !db) { if (!name || !secret) response.status(400).json({success: false, message: "用户名无效或密码至少 6 位"}); return; } const result = db.create_admin_user(name, secret); if (!result.success) { response.status(409).json({success: false, message: result.message}); return; } response.status(201).json({success: true}); });
    app.patch("/api/admin/users/:username/points", require_admin, (request: AdminRequest, response: Response) => { const name = username(request.params.username), action = request.body?.action, amount = request.body?.amount, reason = text(request.body?.reason, 200), db = storage(response); if (!name || (action !== "add" && action !== "remove") || typeof amount !== "number" || !Number.isFinite(amount) || !reason || !db) { response.status(400).json({success: false, message: "积分操作参数无效"}); return; } const result = db.change_point(name, action, amount, reason, `admin:${request.admin?.username || "unknown"}`); if (!result.success) { response.status(400).json({success: false, message: result.message}); return; } response.json({success: true, point: result.point}); });
    app.put("/api/admin/users/:username/password", require_admin, (request: AdminRequest, response: Response) => { const name = username(request.params.username), secret = password(request.body?.password), db = storage(response); if (!name || !secret || !db) { response.status(400).json({success: false, message: "用户名无效或密码至少 6 位"}); return; } const user = db.get_user_info(name) as {role?: string} | null; if (!user) { response.status(404).json({success: false, message: "用户不存在"}); return; } if (user.role === "owner" && request.admin?.role !== "owner") { response.status(403).json({success: false, message: "管理员不能重置所有者密码"}); return; } db.set_user_password(name, secret); response.json({success: true}); });
    app.delete("/api/admin/users/:username", require_admin, (request: AdminRequest, response: Response) => { const name = username(request.params.username), db = storage(response); if (!name || !db) { if (!name) response.status(400).json({success: false, message: "用户名无效"}); return; } if (name.toLocaleLowerCase() === request.admin?.username.toLocaleLowerCase()) { response.status(400).json({success: false, message: "不能删除当前登录账号"}); return; } const result = db.delete_admin_user(name); if (!result.success) { response.status(404).json({success: false, message: result.message}); return; } response.json({success: true, deleted: result.deleted}); });
    app.patch("/api/admin/users/:username/role", require_owner, (request: AdminRequest, response: Response) => { const name = username(request.params.username), role = request.body?.role, db = storage(response); if (!name || typeof role !== "string" || !roles.has(role as Role) || !db) { response.status(400).json({success: false, message: "角色修改参数无效"}); return; } if (name === request.admin?.username && role !== "owner") { response.status(400).json({success: false, message: "不能降级当前所有者账号"}); return; } try { db.change_permission(name, role as Role); response.json({success: true}); } catch (error) { response.status(404).json({success: false, message: error instanceof Error ? error.message : "角色修改失败"}); } });
}
