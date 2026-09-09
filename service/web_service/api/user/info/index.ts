import {validateOnlineMode} from "../../../../minecraft_service/index.js";
import type {Express, Request, Response} from "express";
import {get_game_adapter} from "../../../../../game_adapter/index.js";
import {get_storage} from "../../../../../storage/index.js";
import {verify_resource_token} from "../auth/index.js";

const MONEY_CACHE_TTL_MS = 10 * 60 * 1000;
const MONEY_QUERY_TIMEOUT_MS = 5 * 1000;
const HISTORY_PAGE_SIZE = 10;
const POINT_LOG_PAGE_SIZE = 10;
const POINT_LOG_CATEGORIES = new Set(["all", "sign", "recharge", "player_info", "agent", "map_share", "shop", "public_api", "admin", "manual"]);

interface MoneyHistoryEntry {
    money: unknown;
    timestamp: string;
}

interface UserInfo {
    username: string;
    money: number;
    money_history: MoneyHistoryEntry[];
    point: number;
    address_list: string[];
    message_count: number;
    online_time: number;
    first_record_time: string;
    online_session: Array<{start: string, end: string | null, duration: number | null}>;
    last_join_time: string | null;
    last_leave_time: string | null;
    role: string;
    create_time: string;
}

interface Landmark {
    name: string;
    description: string;
    owner: string;
    visits: number;
    price: string;
    item_id: string;
    updated_at: string;
}

interface BangxiStorage {
    get_user_info(username: string): UserInfo | null;
    get_latest_money_history(username: string): MoneyHistoryEntry | null;
    insert_money_history(username: string, money: unknown): void;
    is_user_online(username: string): boolean;
    get_landmarks_by_owner(owner: string, limit?: number): Landmark[];
    change_point(game_id: string, action: "add" | "remove", point: number, reason: string, ext?: string | null): {
        success: boolean;
        message?: string;
        point?: number;
    };
    get_point_logs(game_id: string, limit?: number): {success: boolean; game_id?: string; logs?: Array<{id: number, game_id: string, action: "add" | "remove", num: number, reason: string, ext: string | null, create_at: string}>; message?: string};
    get_point_logs_page(game_id: string, page?: number, page_size?: number, category?: string): {success: boolean; game_id?: string; logs?: Array<{id: number, game_id: string, action: "add" | "remove", num: number, reason: string, ext: string | null, category: string, create_at: string}>; pagination?: {page: number, page_size: number, total: number, total_pages: number, has_previous: boolean, has_next: boolean}; message?: string};
}

interface BangxiGameInstance {
    status?: string;
    config?: {
        host?: string;
        port?: number;
    };
    event: {
        on(event: "message", listener: (data: unknown) => void): void;
        off(event: "message", listener: (data: unknown) => void): void;
    };
    send_message(message: string): boolean;
}

interface WalletInfo {
    amount: number | string | null;
    fetched_at: string | null;
    source: "live" | "cache" | "history" | "unavailable";
}

const pendingMoneyQueries = new Map<string, Promise<WalletInfo>>();
function normalizeMoney(value: unknown): number | string | null {
    const normalized = String(value ?? "").replaceAll(",", "").trim();
    if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) || !Number.isInteger(amount) ? amount : normalized;
}

function getCachedWallet(storage: BangxiStorage, username: string): WalletInfo | null {
    const cached = storage.get_latest_money_history(username);
    if (!cached) return null;

    const fetchedAt = Date.parse(cached.timestamp);
    const amount = normalizeMoney(cached.money);
    if (amount === null || Number.isNaN(fetchedAt)) return null;

    return {
        amount,
        fetched_at: cached.timestamp,
        source: Date.now() - fetchedAt < MONEY_CACHE_TTL_MS ? "cache" : "history",
    };
}

function queryLiveWallet(storage: BangxiStorage, username: string): Promise<WalletInfo> {
    const gameInstance = get_game_adapter("mineflayer", "bangxi") as BangxiGameInstance | undefined;
    if (!gameInstance || gameInstance.status !== "running") {
        return Promise.resolve({amount: null, fetched_at: null, source: "unavailable"});
    }

    return new Promise(resolve => {
        let settled = false;
        const finish = (result: WalletInfo) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            gameInstance.event.off("message", onMessage);
            resolve(result);
        };
        const onMessage = (data: any) => {
            if (data?.position !== "system") return;
            const plainText = data.message?.plainText;
            if (typeof plainText !== "string" || !plainText.includes("[邦溪]")) return;

            const match = plainText.match(/查询(.+?)的余额:\s*([\d,.]+)\s*金币/);
            if (!match || match[1] !== username) return;

            const amount = normalizeMoney(match[2]);
            if (amount === null) return finish({amount: null, fetched_at: null, source: "unavailable"});

            storage.insert_money_history(username, amount);
            finish({amount, fetched_at: new Date().toISOString(), source: "live"});
        };
        const timer = setTimeout(() => finish({amount: null, fetched_at: null, source: "unavailable"}), MONEY_QUERY_TIMEOUT_MS);

        gameInstance.event.on("message", onMessage);
        if (!gameInstance.send_message(`/money ${username}`)) {
            finish({amount: null, fetched_at: null, source: "unavailable"});
        }
    });
}

function getWallet(storage: BangxiStorage, username: string): Promise<WalletInfo> {
    const cached = getCachedWallet(storage, username);
    if (cached?.source === "cache") return Promise.resolve(cached);

    const pending = pendingMoneyQueries.get(username);
    if (pending) return pending;

    const query = queryLiveWallet(storage, username).then(result => {
        if (result.source !== "unavailable") return result;
        return cached ?? result;
    }).finally(() => pendingMoneyQueries.delete(username));
    pendingMoneyQueries.set(username, query);
    return query;
}

function parseHistoryPage(value: unknown): number | null {
    if (value === undefined) return 1;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const page = Number(value);
    return Number.isSafeInteger(page) ? page : null;
}

function paginateHistory<T>(history: T[], requestedPage: number) {
    const total = history.length;
    const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * HISTORY_PAGE_SIZE;
    const items = history.slice().reverse().slice(offset, offset + HISTORY_PAGE_SIZE);
    return {
        items,
        pagination: {
            page,
            page_size: HISTORY_PAGE_SIZE,
            total,
            total_pages: totalPages,
            has_previous: page > 1,
            has_next: page < totalPages,
        },
    };
}

function getHistoryUser(request: Request, response: Response): UserInfo | null {
    const identity = verify_resource_token(request);
    if (!identity) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return null;
    }

    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!storage) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
        return null;
    }

    const user = storage.get_user_info(identity.username);
    if (!user) {
        response.status(404).json({success: false, message: "未找到用户信息"});
        return null;
    }
    return user;
}

async function getUserPayload(storage: BangxiStorage, user: UserInfo) {
    const wallet = await getWallet(storage, user.username);
    return {
        ...user,
        money_history: user.money_history.slice(-30),
        online_session: user.online_session.slice(-30),
        online: storage.is_user_online(user.username),
        landmarks: storage.get_landmarks_by_owner(user.username),
        wallet,
    };
}

export async function init(app: Express) {
async function getAvatarUrl(username: string): Promise<string> {
    const isOnline = await validateOnlineMode(username);
    if (isOnline.status) {
        return `https://land.wupeng1.top/api/generate/minimal/mojang/${encodeURIComponent(username)}?type=head&scale=150`;
    }
    return `https://littleskin.cn/avatar/player/${encodeURIComponent(username)}`;
}

app.post("/api/user/info/avatar", async (request: Request, response: Response) => {
    const identity = verify_resource_token(request);
    if (!identity) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    const {usernames} = request.body ?? {};
    if (!Array.isArray(usernames) || usernames.length === 0) {
        response.status(400).json({success: false, message: "usernames 为必填数组"});
        return;
    }

    if (usernames.length > 50) {
        response.status(400).json({success: false, message: "单次最多查询 50 个玩家"});
        return;
    }

    const results = await Promise.all(usernames.map(async (name: string) => {
        if (typeof name !== "string" || !name.trim()) {
            return {username: String(name ?? ""), avatar_url: null, error: "无效的用户名"};
        }
        try {
            const url = await getAvatarUrl(name.trim());
            return {username: name.trim(), avatar_url: url};
        } catch {
            return {username: name.trim(), avatar_url: null, error: "获取头像失败"};
        }
    }));

    response.json({success: true, avatars: results});
});

app.get("/api/user/info/avatar", async (request: Request, response: Response) => {
    const identity = verify_resource_token(request);
    if (!identity) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    const raw = request.query.username;
    const names = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
    if (names.length === 0) {
        response.status(400).json({success: false, message: "请提供 username 查询参数"});
        return;
    }

    if (names.length > 50) {
        response.status(400).json({success: false, message: "单次最多查询 50 个玩家"});
        return;
    }

    const results = await Promise.all(names.map(async (name: string) => {
        if (!name.trim()) {
            return {username: name, avatar_url: null, error: "无效的用户名"};
        }
        try {
            const url = await getAvatarUrl(name.trim());
            return {username: name.trim(), avatar_url: url};
        } catch {
            return {username: name.trim(), avatar_url: null, error: "获取头像失败"};
        }
    }));

    response.json({success: true, avatars: results});
});

app.get("/api/user/info/sessions", (request: Request, response: Response) => {
    const page = parseHistoryPage(request.query.page);
    if (page === null) {
        response.status(400).json({success: false, message: "page 必须是正整数"});
        return;
    }

    const user = getHistoryUser(request, response);
    if (!user) return;
    response.json({success: true, ...paginateHistory(user.online_session, page)});
});

app.get("/api/user/info/money_history", (request: Request, response: Response) => {
    const page = parseHistoryPage(request.query.page);
    if (page === null) {
        response.status(400).json({success: false, message: "page 必须是正整数"});
        return;
    }

    const user = getHistoryUser(request, response);
    if (!user) return;
    response.json({success: true, ...paginateHistory(user.money_history, page)});
});

app.get("/api/user/info/point_logs", (request: Request, response: Response) => {
    const page = parseHistoryPage(request.query.page);
    const category = typeof request.query.category === "string" ? request.query.category : "all";
    if (page === null) { response.status(400).json({success: false, message: "page 必须是正整数"}); return; }
    if (!POINT_LOG_CATEGORIES.has(category)) { response.status(400).json({success: false, message: "category 无效"}); return; }
    const identity = verify_resource_token(request);
    if (!identity) { response.status(401).json({success: false, message: "资源令牌无效或已过期"}); return; }
    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!storage?.get_point_logs_page) { response.status(503).json({success: false, message: "bangxi_server_storage 不可用"}); return; }
    const result = storage.get_point_logs_page(identity.username, page, POINT_LOG_PAGE_SIZE, category);
    if (!result.success) { response.status(404).json({success: false, message: result.message || "未找到用户信息"}); return; }
    response.json({success: true, username: result.game_id, logs: result.logs || [], pagination: result.pagination});
});

app.get("/api/user/info/player", async (request: Request, response: Response) => {
    const identity = verify_resource_token(request);
    if (!identity) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    const rawUsername = request.query.username;
    if (typeof rawUsername !== "string" || !rawUsername.trim()) {
        response.status(400).json({success: false, message: "username 为必填查询参数"});
        return;
    }

    const username = rawUsername.trim();
    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!storage) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
        return;
    }

    if (!storage.get_user_info(username)) {
        response.status(404).json({success: false, message: "未找到用户信息"});
        return;
    }

    const charge = storage.change_point(
        identity.username,
        "remove",
        100,
        `查询玩家信息：${username}`,
        `web_player_info:${username.toLowerCase()}`,
    );
    if (!charge.success) {
        response.status(402).json({success: false, message: charge.message || "扣除积分失败"});
        return;
    }

    const user = storage.get_user_info(username);
    if (!user) {
        response.status(404).json({success: false, message: "未找到用户信息"});
        return;
    }

    response.json({success: true, user: await getUserPayload(storage, user)});
});

app.get("/api/user/info/self", async (request: Request, response: Response) => {
    const identity = verify_resource_token(request);
    if (!identity) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined;
    if (!storage) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"});
        return;
    }

    const user = storage.get_user_info(identity.username);
    if (!user) {
        response.status(404).json({success: false, message: "未找到用户信息"});
        return;
    }

    response.json({success: true, user: await getUserPayload(storage, user)});
});
}
