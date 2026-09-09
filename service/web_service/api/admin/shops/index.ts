import type {Express, Response} from "express";
import {get_storage} from "../../../../../storage/index.js";
import {type AdminRequest, require_admin} from "../auth.js";

type SortBy = "shop_name" | "updated_at" | "item_count" | "price_count";
type SortOrder = "asc" | "desc";
type SellType = "sell" | "buy";

const sortBySet = new Set<SortBy>(["shop_name", "updated_at", "item_count", "price_count"]);
const sortOrderSet = new Set<SortOrder>(["asc", "desc"]);
const sellTypeSet = new Set<SellType>(["sell", "buy"]);

interface BangxiStorage {
    search_admin_shops(page: number, limit: number, filters: {
        shop_name?: string; player?: string; item_id?: string;
        sell_type?: SellType; updated_from?: string; updated_to?: string;
        sort_by?: SortBy; sort_order?: SortOrder;
    }): {
        shops: Array<{
            shop_name: string; new_batch_id: string | null; listed_at: string;
            latest_update: string | null; price_count: number; batch_count: number;
            item_count: number; sell_count: number; buy_count: number; players: string[];
        }>;
        total: number;
        stats: {shops: number; prices: number; batches: number; sell: number; buy: number; latest_update: string | null};
    };
    get_shop_batch_history(shop_name: string, page: number, limit: number): {
        batches: Array<{
            batch_id: string; create_at: string; record_count: number;
            item_count: number; sell_count: number; buy_count: number; players: string[];
        }>;
        total: number;
    };
    get_shop_batch_price_info(shop_name: string, batch_id: string): {
        shop_name: string; batch_id: string; create_at: string; prices: unknown[];
    } | null;
    search_shop_item_prices_across_shops(item_id: string, sell_type?: SellType): unknown[];
    update_shop_price_record(shop_name: string, batch_id: string, price_id: number, price: number): {success: boolean; price?: unknown; message?: string};
    delete_shop_price_record(shop_name: string, batch_id: string, price_id: number): {success: boolean; deleted?: number; new_batch_id?: string | null; shop_removed?: boolean; message?: string};
    delete_shop_batch_item(shop_name: string, batch_id: string, item_id: string, sell_type?: SellType): {success: boolean; deleted?: number; new_batch_id?: string | null; shop_removed?: boolean; message?: string};
    sync_shop_list_from_price(): {success: boolean; inserted?: number; updated?: number; deleted?: number; total?: number; message?: string; count?: number};
    delete_shop_prices(shop_name: string): {success: boolean; deleted?: number; message?: string};
    delete_shop_price_batch_by_shop(shop_name: string, batch_id: string): {success: boolean; deleted?: number; new_batch_id?: string | null; shop_removed?: boolean; message?: string};
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

function parseEnumFilter<T extends string>(value: unknown, allowed: Set<string>): T | null | undefined {
    const parsed = parseFilter(value);
    if (parsed === null) return null;
    if (parsed === undefined || !parsed.trim()) return undefined;
    return allowed.has(parsed) ? parsed as T : null;
}

function getBangxiStorage(response: Response): BangxiStorage | null {
    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!storage?.search_admin_shops || !storage.get_shop_batch_history || !storage.get_shop_batch_price_info ||
        !storage.search_shop_item_prices_across_shops || !storage.update_shop_price_record ||
        !storage.delete_shop_price_record || !storage.delete_shop_batch_item || !storage.sync_shop_list_from_price ||
        !storage.delete_shop_prices || !storage.delete_shop_price_batch_by_shop) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
        return null;
    }
    return storage;
}

function shopNameQuery(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const parsed = value.trim();
    return parsed && parsed.length <= 256 ? parsed : null;
}

function stringParam(value: unknown): string | null {
    return typeof value === "string" ? value.trim() : null;
}

function parseTimestamp(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

function parsePriceId(value: unknown): number | null {
    const parsed = parsePositiveInteger(value, 0);
    return parsed && parsed > 0 ? parsed : null;
}

function parsePriceValue(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) return null;
    return value;
}

export async function init(app: Express) {
    app.get("/api/admin/shops", require_admin, (request: AdminRequest, response: Response) => {
        const page = parsePositiveInteger(request.query.page, 1);
        const requestedLimit = parsePositiveInteger(request.query.limit, 20);
        const shopName = parseFilter(request.query.shop_name);
        const player = parseFilter(request.query.player);
        const itemId = parseFilter(request.query.item_id);
        const sellType = parseEnumFilter<SellType>(request.query.sell_type, sellTypeSet);
        const updatedFrom = parseTimestamp(request.query.updated_from);
        const updatedTo = parseTimestamp(request.query.updated_to);
        const sortBy = parseEnumFilter<SortBy>(request.query.sort_by, sortBySet);
        const sortOrder = parseEnumFilter<SortOrder>(request.query.sort_order, sortOrderSet);

        if (page === null || requestedLimit === null) {
            response.status(400).json({success: false, message: "page 和 limit 必须是正整数"});
            return;
        }
        if (shopName === null || player === null || itemId === null || sellType === null || sortBy === null || sortOrder === null) {
            response.status(400).json({success: false, message: "筛选参数无效"});
            return;
        }
        if (updatedFrom === null || updatedTo === null) {
            response.status(400).json({success: false, message: "时间范围格式无效"});
            return;
        }
        if (updatedFrom && updatedTo && Date.parse(updatedFrom) > Date.parse(updatedTo)) {
            response.status(400).json({success: false, message: "开始时间不能晚于结束时间"});
            return;
        }

        const storage = getBangxiStorage(response);
        if (!storage) return;

        const limit = Math.min(requestedLimit, 100);
        const result = storage.search_admin_shops(page, limit, {
            shop_name: shopName, player, item_id: itemId, sell_type: sellType,
            updated_from: updatedFrom, updated_to: updatedTo, sort_by: sortBy, sort_order: sortOrder,
        });
        const totalPages = Math.max(1, Math.ceil(result.total / limit));

        response.json({
            success: true,
            shops: result.shops,
            stats: result.stats,
            pagination: {
                page, limit, total: result.total, total_pages: totalPages,
                has_previous: page > 1, has_next: page < totalPages,
            },
        });
    });

    app.get("/api/admin/shops/:shop/history", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        const page = parsePositiveInteger(request.query.page, 1);
        const requestedLimit = parsePositiveInteger(request.query.limit, 20);
        if (!shop) {
            response.status(400).json({success: false, message: "商店名称无效"});
            return;
        }
        if (page === null || requestedLimit === null) {
            response.status(400).json({success: false, message: "page 和 limit 必须是正整数"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;

        const limit = Math.min(requestedLimit, 100);
        const result = storage.get_shop_batch_history(shop, page, limit);
        const totalPages = Math.max(1, Math.ceil(result.total / limit));

        response.json({
            success: true, shop,
            batches: result.batches,
            pagination: {
                page, limit, total: result.total, total_pages: totalPages,
                has_previous: page > 1, has_next: page < totalPages,
            },
        });
    });

    app.get("/api/admin/shops/item-prices", require_admin, (request: AdminRequest, response: Response) => {
        const item = shopNameQuery(request.query.item_id);
        const sellType = parseEnumFilter<SellType>(request.query.sell_type, sellTypeSet);
        if (!item) {
            response.status(400).json({success: false, message: "物品名无效"});
            return;
        }
        if (sellType === null) {
            response.status(400).json({success: false, message: "价格类型无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        response.json({success: true, item, sell_type: sellType || null, prices: storage.search_shop_item_prices_across_shops(item, sellType)});
    });

    app.get("/api/admin/shops/:shop/batches/:batchId/prices", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        const batchId = stringParam(request.params.batchId);
        if (!shop || !batchId || batchId.length > 64) {
            response.status(400).json({success: false, message: "商店名称和批次 ID 无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const batch = storage.get_shop_batch_price_info(shop, batchId);
        if (!batch) {
            response.status(404).json({success: false, message: "没有找到该批次价格"});
            return;
        }
        response.json({success: true, batch});
    });

    app.patch("/api/admin/shops/:shop/batches/:batchId/prices/:priceId", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        const batchId = stringParam(request.params.batchId);
        const priceId = parsePriceId(request.params.priceId);
        const price = parsePriceValue(request.body?.price);
        if (!shop || !batchId || batchId.length > 64 || !priceId || price === null) {
            response.status(400).json({success: false, message: "改价参数无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.update_shop_price_record(shop, batchId, priceId, price);
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "改价失败"});
            return;
        }
        response.json({success: true, price: result.price});
    });

    app.delete("/api/admin/shops/:shop/batches/:batchId/prices/:priceId", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        const batchId = stringParam(request.params.batchId);
        const priceId = parsePriceId(request.params.priceId);
        if (!shop || !batchId || batchId.length > 64 || !priceId) {
            response.status(400).json({success: false, message: "删除价格参数无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.delete_shop_price_record(shop, batchId, priceId);
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "删除失败"});
            return;
        }
        response.json({success: true, deleted: result.deleted, new_batch_id: result.new_batch_id, shop_removed: result.shop_removed});
    });

    app.delete("/api/admin/shops/:shop/batches/:batchId/items", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        const batchId = stringParam(request.params.batchId);
        const item = shopNameQuery(request.query.item_id);
        const sellType = parseEnumFilter<SellType>(request.query.sell_type, sellTypeSet);
        if (!shop || !batchId || batchId.length > 64 || !item) {
            response.status(400).json({success: false, message: "删除物品参数无效"});
            return;
        }
        if (sellType === null) {
            response.status(400).json({success: false, message: "价格类型无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.delete_shop_batch_item(shop, batchId, item, sellType);
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "删除失败"});
            return;
        }
        response.json({success: true, deleted: result.deleted, new_batch_id: result.new_batch_id, shop_removed: result.shop_removed});
    });

    app.post("/api/admin/shops/sync", require_admin, (request: AdminRequest, response: Response) => {
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.sync_shop_list_from_price();
        response.json(result);
    });

    app.delete("/api/admin/shops/:shop", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        if (!shop) {
            response.status(400).json({success: false, message: "商店名称无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.delete_shop_prices(shop);
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "删除失败"});
            return;
        }
        response.json({success: true, deleted: result.deleted});
    });

    app.delete("/api/admin/shops/:shop/batches/:batchId", require_admin, (request: AdminRequest, response: Response) => {
        const shop = shopNameQuery(request.params.shop);
        const batchId = stringParam(request.params.batchId);
        if (!shop || !batchId) {
            response.status(400).json({success: false, message: "商店名称和批次 ID 不能为空"});
            return;
        }
        if (batchId.length > 64) {
            response.status(400).json({success: false, message: "批次 ID 无效"});
            return;
        }
        const storage = getBangxiStorage(response);
        if (!storage) return;
        const result = storage.delete_shop_price_batch_by_shop(shop, batchId);
        if (!result.success) {
            response.status(404).json({success: false, message: result.message || "删除失败"});
            return;
        }
        response.json({success: true, deleted: result.deleted, new_batch_id: result.new_batch_id, shop_removed: result.shop_removed});
    });
}
