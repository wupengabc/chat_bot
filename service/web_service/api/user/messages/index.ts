import type {Express, Request, Response} from "express";
import {get_storage} from "../../../../../storage/index.js";
import {verify_resource_token} from "../auth/index.js";

interface MessageFilters {
    username?: string;
    create_time?: string;
    create_time_from?: string;
    create_time_to?: string;
    content?: string;
}

interface MessageSearchResult {
    messages: Array<{
        id: number;
        username: string;
        content: string;
        address: string;
        area: string;
        message_type: string;
        position: string;
        create_time: string;
    }>;
    total: number;
}

interface BangxiStorage {
    search_messages(page: number, limit: number, filters: MessageFilters): MessageSearchResult;
    get_message_context(id: number, page: number | undefined, limit: number, filters: MessageFilters & {position?: string, message_type?: string, include_private?: boolean}): {messages: MessageSearchResult["messages"]; total: number; page: number; limit: number; total_pages: number} | null;
}

function parsePositiveInteger(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseFilter(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    return typeof value === "string" ? value : null;
}

export async function init(app: Express) {
    app.get("/api/user/messages/:id/context", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"});
            return;
        }

        const id = parsePositiveInteger(request.params.id, 0);
        const page = request.query.page === undefined ? undefined : parsePositiveInteger(request.query.page, 1);
        const requestedLimit = parsePositiveInteger(request.query.limit, 30);
        const username = parseFilter(request.query.username);
        const createTime = parseFilter(request.query.create_time);
        const createTimeFrom = parseFilter(request.query.create_time_from);
        const createTimeTo = parseFilter(request.query.create_time_to);
        const content = parseFilter(request.query.content);
        if (id === null || page === null || requestedLimit === null || username === null || createTime === null || createTimeFrom === null || createTimeTo === null || content === null) {
            response.status(400).json({success: false, message: "上下文查询参数无效"});
            return;
        }
        const fromTimestamp = createTimeFrom ? Date.parse(createTimeFrom) : null;
        const toTimestamp = createTimeTo ? Date.parse(createTimeTo) : null;
        if ((createTimeFrom && Number.isNaN(fromTimestamp)) || (createTimeTo && Number.isNaN(toTimestamp)) || (fromTimestamp !== null && toTimestamp !== null && fromTimestamp > toTimestamp)) {
            response.status(400).json({success: false, message: "时间范围无效"});
            return;
        }
        const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
        if (!storage?.get_message_context) {
            response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
            return;
        }
        const result = storage.get_message_context(id, page, Math.min(requestedLimit, 100), {username, create_time: createTime, create_time_from: createTimeFrom ? new Date(fromTimestamp!).toISOString() : undefined, create_time_to: createTimeTo ? new Date(toTimestamp!).toISOString() : undefined, content, position: "chat", message_type: "public"});
        if (!result) {
            response.status(404).json({success: false, message: "消息不存在或不符合当前筛选条件"});
            return;
        }
        response.json({success: true, center_id: id, messages: result.messages, pagination: {page: result.page, limit: result.limit, total: result.total, total_pages: result.total_pages, has_previous: result.page > 1, has_next: result.page < result.total_pages}});
    });

    app.get("/api/user/messages", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"});
            return;
        }

        const page = parsePositiveInteger(request.query.page, 1);
        const requestedLimit = parsePositiveInteger(request.query.limit, 20);
        const username = parseFilter(request.query.username);
        const createTime = parseFilter(request.query.create_time);
        const createTimeFrom = parseFilter(request.query.create_time_from);
        const createTimeTo = parseFilter(request.query.create_time_to);
        const content = parseFilter(request.query.content);

        if (page === null || requestedLimit === null) {
            response.status(400).json({success: false, message: "page 和 limit 必须是正整数"});
            return;
        }
        if (username === null || createTime === null || createTimeFrom === null || createTimeTo === null || content === null) {
            response.status(400).json({success: false, message: "消息筛选参数必须是字符串"});
            return;
        }
        const fromTimestamp = createTimeFrom ? Date.parse(createTimeFrom) : null;
        const toTimestamp = createTimeTo ? Date.parse(createTimeTo) : null;
        if ((createTimeFrom && Number.isNaN(fromTimestamp)) || (createTimeTo && Number.isNaN(toTimestamp))) {
            response.status(400).json({success: false, message: "时间范围格式无效"});
            return;
        }
        if (fromTimestamp !== null && toTimestamp !== null && fromTimestamp > toTimestamp) {
            response.status(400).json({success: false, message: "开始时间不能晚于结束时间"});
            return;
        }

        const limit = Math.min(requestedLimit, 50);
        const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
        if (!storage?.search_messages) {
            response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
            return;
        }

        const result = storage.search_messages(page, limit, {
            username,
            create_time: createTime,
            create_time_from: createTimeFrom ? new Date(fromTimestamp!).toISOString() : undefined,
            create_time_to: createTimeTo ? new Date(toTimestamp!).toISOString() : undefined,
            content,
        });
        const totalPages = Math.max(1, Math.ceil(result.total / limit));

        response.json({
            success: true,
            messages: result.messages,
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
}
