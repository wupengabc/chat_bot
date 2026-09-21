import type {Express, Response} from "express";
import {log_utils, type LoggerType} from "../../../../../utils/log_utils.js";
import {type AdminRequest, require_owner} from "../auth.js";

const types = new Set<LoggerType>(["info", "warn", "error"]);

function positiveInteger(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function text(value: unknown, maxLength = 128): string | undefined | null {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return null;
    const parsed = value.trim();
    return parsed.length <= maxLength ? parsed || undefined : null;
}

function logTime(value: unknown, endOfDay = false): string | undefined | null {
    const parsed = text(value, 64);
    if (!parsed || parsed === null) return parsed;
    const time = Date.parse(parsed);
    if (Number.isNaN(time)) return null;
    const date = new Date(time);
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(parsed)) date.setHours(23, 59, 59, 999);
    const format = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${format(date.getMonth() + 1)}-${format(date.getDate())} ${format(date.getHours())}:${format(date.getMinutes())}:${format(date.getSeconds())}`;
}

export async function init(app: Express) {
    app.get("/api/admin/logs/meta", require_owner, (request: AdminRequest, response: Response) => {
        const platform = text(request.query.platform);
        if (platform === null) {
            response.status(400).json({success: false, message: "平台参数无效"});
            return;
        }
        response.json({success: true, ...log_utils.get_platforms_plugins_types(platform)});
    });

    app.get("/api/admin/logs", require_owner, (request: AdminRequest, response: Response) => {
        const page = positiveInteger(request.query.page, 1);
        const requestedLimit = positiveInteger(request.query.limit, 30);
        const platform = text(request.query.platform);
        const plugin = text(request.query.plugin);
        const type = text(request.query.type, 16);
        const keyword = text(request.query.keyword, 128);
        const timeFrom = logTime(request.query.time_from);
        const timeTo = logTime(request.query.time_to, true);
        if (page === null || requestedLimit === null || platform === null || plugin === null || type === null || keyword === null || timeFrom === null || timeTo === null || (type !== undefined && !types.has(type as LoggerType))) {
            response.status(400).json({success: false, message: "日志查询参数无效"});
            return;
        }
        if (timeFrom && timeTo && timeFrom > timeTo) {
            response.status(400).json({success: false, message: "开始时间不能晚于结束时间"});
            return;
        }
        const limit = Math.min(requestedLimit, 100);
        const [total, logs] = log_utils.query_logs({platform, plugin, type: type as LoggerType | undefined, keyword, time_from: timeFrom, time_to: timeTo}, page, limit);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        response.json({success: true, logs, pagination: {page, limit, total, total_pages: totalPages, has_previous: page > 1, has_next: page < totalPages}});
    });
}
