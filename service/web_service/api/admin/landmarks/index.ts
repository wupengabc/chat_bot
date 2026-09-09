import type {Response} from "express";
import {get_storage} from "../../../../../storage/index.js";
import {get_plugin} from "../../../../../plugin/index.js";
import {type AdminRequest, require_admin} from "../auth.js";

type SortBy = "name" | "owner" | "visits" | "updated_at" | "first_seen_at";
type SortOrder = "asc" | "desc";

interface LandmarkRecord {
    id: number; name: string; description: string; owner: string; visits: number; price: string; item_id: string; first_seen_at: string; updated_at: string;
}

interface BangxiStorage {
    search_landmarks_page(page: number, limit: number, filters: {keyword?: string; name?: string; owner?: string; item_id?: string; min_visits?: number; max_visits?: number; updated_from?: string; updated_to?: string; sort_by?: SortBy; sort_order?: SortOrder}): {landmarks: LandmarkRecord[]; total: number; visits: number};
    update_landmark(id: number, values: {name: string; owner: string; description: string; visits: number; price: string; item_id: string}): {success: boolean; landmark?: LandmarkRecord; message?: string};
    delete_landmark(id: number): {success: boolean; deleted?: number; message?: string};
}

interface PwPlugin {
    update_global(dryRun?: boolean): Promise<{dry_run: boolean; pages: number; total: number}>;
}

const sortBySet = new Set<SortBy>(["name", "owner", "visits", "updated_at", "first_seen_at"]);
const sortOrderSet = new Set<SortOrder>(["asc", "desc"]);

function getBangxiStorage(response: Response): BangxiStorage | null {
    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!storage?.search_landmarks_page || !storage.update_landmark || !storage.delete_landmark) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
        return null;
    }
    return storage;
}

function positiveInteger(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | undefined | null {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalText(value: unknown, maxLength = 256): string | undefined | null {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return null;
    const parsed = value.trim();
    return parsed.length <= maxLength ? parsed || undefined : null;
}

function requiredText(value: unknown, maxLength: number): string | null {
    const text = optionalText(value, maxLength);
    return text === undefined ? null : text;
}

function dateValue(value: unknown, endOfDay = false): string | undefined | null {
    const text = optionalText(value, 64);
    if (!text || text === null) return text;
    const timestamp = Date.parse(text);
    if (Number.isNaN(timestamp)) return null;
    const date = new Date(timestamp);
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text)) date.setUTCHours(23, 59, 59, 999);
    return date.toISOString();
}

function landmarkId(value: unknown): number | null {
    const parsed = positiveInteger(value, 0);
    return parsed && parsed > 0 ? parsed : null;
}

export async function init(app: import("express").Express) {
    app.get("/api/admin/landmarks", require_admin, (request: AdminRequest, response: Response) => {
        const page = positiveInteger(request.query.page, 1);
        const limit = positiveInteger(request.query.limit, 20);
        const keyword = optionalText(request.query.keyword);
        const name = optionalText(request.query.name, 128);
        const owner = optionalText(request.query.owner, 64);
        const itemId = optionalText(request.query.item_id);
        const minVisits = nonNegativeInteger(request.query.min_visits);
        const maxVisits = nonNegativeInteger(request.query.max_visits);
        const updatedFrom = dateValue(request.query.updated_from);
        const updatedTo = dateValue(request.query.updated_to, true);
        const sortBy = optionalText(request.query.sort_by, 32) || "visits";
        const sortOrder = optionalText(request.query.sort_order, 4) || "desc";
        if (page === null || limit === null || keyword === null || name === null || owner === null || itemId === null || minVisits === null || maxVisits === null || updatedFrom === null || updatedTo === null || !sortBySet.has(sortBy as SortBy) || !sortOrderSet.has(sortOrder as SortOrder)) {
            response.status(400).json({success: false, message: "地标查询参数无效"});
            return;
        }
        if (minVisits !== undefined && maxVisits !== undefined && minVisits > maxVisits) {
            response.status(400).json({success: false, message: "最低访问量不能大于最高访问量"});
            return;
        }
        if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
            response.status(400).json({success: false, message: "更新时间起点不能晚于终点"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const safeLimit = Math.min(limit, 100);
        const result = storage.search_landmarks_page(page, safeLimit, {keyword, name, owner, item_id: itemId, min_visits: minVisits, max_visits: maxVisits, updated_from: updatedFrom, updated_to: updatedTo, sort_by: sortBy as SortBy, sort_order: sortOrder as SortOrder});
        const totalPages = Math.max(1, Math.ceil(result.total / safeLimit));
        response.json({success: true, landmarks: result.landmarks, summary: {total: result.total, visits: result.visits}, pagination: {page, limit: safeLimit, total: result.total, total_pages: totalPages, has_previous: page > 1, has_next: page < totalPages}});
    });

    app.patch("/api/admin/landmarks/:id", require_admin, (request: AdminRequest, response: Response) => {
        const id = landmarkId(request.params.id);
        const name = requiredText(request.body?.name, 128);
        const owner = requiredText(request.body?.owner, 64);
        const description = requiredText(request.body?.description, 2000);
        const price = requiredText(request.body?.price, 128);
        const itemId = requiredText(request.body?.item_id, 256);
        const visits = request.body?.visits;
        if (!id || !name || !owner || description === null || !price || !itemId || typeof visits !== "number" || !Number.isSafeInteger(visits) || visits < 0) {
            response.status(400).json({success: false, message: "地标编辑参数无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.update_landmark(id, {name, owner, description, visits, price, item_id: itemId});
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "保存失败"});
            return;
        }
        response.json({success: true, landmark: result.landmark});
    });

    app.delete("/api/admin/landmarks/:id", require_admin, (request: AdminRequest, response: Response) => {
        const id = landmarkId(request.params.id);
        if (!id) {
            response.status(400).json({success: false, message: "地标 ID 无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.delete_landmark(id);
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "删除失败"});
            return;
        }
        response.json({success: true, deleted: result.deleted});
    });

    app.post("/api/admin/landmarks/update", require_admin, async (_request: AdminRequest, response: Response) => {
        const pw = get_plugin("pw", "default") as PwPlugin | undefined;
        if (!pw?.update_global) {
            response.status(503).json({success: false, message: "pw 地标更新插件不可用"});
            return;
        }
        try {
            const result = await pw.update_global(false);
            response.json({success: true, result});
        } catch (error) {
            response.status(409).json({success: false, message: error instanceof Error ? error.message : "地标更新失败"});
        }
    });
}
