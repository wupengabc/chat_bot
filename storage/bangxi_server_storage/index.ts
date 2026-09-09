import {path_utils} from "../../utils/path_utils.js";
import path from "node:path";
import fs from "fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {eq, and, sql, desc, lt, lte, SQLWrapper} from "drizzle-orm";
import {orm_utils} from "../../utils/orm_utils.js";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {storage_logger} from "../index.js";
import {split_price_outliers, calculate_adjusted_shop_average, type ShopPriceValue, type AdjustedShop} from "../../utils/price_utils.js";

interface ChatInfo {
    area?: string
    address?: string
    content?: string
}

function parseChatInfo(json: any): ChatInfo {
    const result: ChatInfo = {}

    function flatten(node: any): string {
        if (!node) return ""

        let text = node.text ?? ""

        if (Array.isArray(node.extra)) {
            for (const child of node.extra) {
                text += flatten(child)
            }
        }

        return text
    }

    function walk(node: any) {
        if (!node) return

        // 解析 hover
        if (node.hoverEvent?.value) {
            const hover = flatten(node.hoverEvent.value)

            // [生存二区]
            const area = hover.match(/\[([^\]]+)\]\s*\n?\[人数\]/)
            if (area) {
                result.area = area[1]
            }

            // [IP归属地] [山东]
            const address = hover.match(/\[IP归属地\]\s*\[([^\]]+)\]/)
            if (address) {
                result.address = address[1]
            }
        }

        // 最后一段白色文本就是聊天内容
        if (
            Array.isArray(node.extra) &&
            node.extra.length === 1 &&
            typeof node.extra[0].text === "string" &&
            node.extra[0].text.trim()
        ) {
            result.content = node.extra[0].text
        }

        if (Array.isArray(node.extra)) {
            for (const child of node.extra) {
                walk(child)
            }
        }
    }

    walk(json)

    return result
}

function isPrivateMessage(node: any): boolean {
    if (!node) return false

    if (
        node.clickEvent?.action === "suggest_command" &&
        typeof node.clickEvent.command === "string" &&
        /^\/(?:tell|msg|w|m)\s+\S+/.test(node.clickEvent.command)
    ) {
        return true
    }

    return Array.isArray(node.extra) && node.extra.some(isPrivateMessage)
}

function parsePrivateMessage(text: string) {
    const match = text.match(/^\[(.+?)\s*->\s*(.+?)\]\s*(.*)$/)

    if (!match) return null

    return {
        from: match[1].trim(),
        to: match[2].trim(),
        content: match[3]
    }
}

function parsePointTransferMessage(text: string) {
    const match = text.match(/你从(.+?)账户收到转账金额:\s*([\d,]+(?:\.\d+)?)\s*金币/)

    if (!match) return null

    const point = Number(match[2].replaceAll(",", ""))
    if (!Number.isFinite(point) || point <= 0) return null

    return {
        username: match[1],
        point
    }
}

const user_table = sqliteTable("user", {
    id: integer("id").primaryKey({autoIncrement: true}),
    username: text("username").notNull(),
    password: text("password"),
    money: integer("money").default(0),
    money_history: text("money_history").default("[]"),
    point: integer("point").default(0),
    address_list: text("address_list").default("[]"),
    message_count: integer("message_count").default(0),
    online_time: integer("online_time").default(0),
    first_record_time: text("first_record_time"),
    online_session: text("online_session").default("[]"),
    role: text("role").default("member"),
    apikey: text("apikey").notNull().default(""),
    create_time: text("create_time").notNull(),
})

const message_table = sqliteTable("message", {
    id: integer("id").primaryKey({autoIncrement: true}),
    username: text("username").notNull(),
    content: text("content").notNull(),
    address: text("address").notNull(),
    area: text("area").notNull(),
    message_type: text("message_type").default("public"),
    position: text("position").default("chat"),
    create_time: text("create_time").notNull(),
})

const point_log_table = sqliteTable("point_log", {
    id: integer("id").primaryKey({autoIncrement: true}),
    game_id: text("game_id").notNull(),
    action: text("action").notNull(),
    num: integer("num").notNull(),
    reason: text("reason").notNull(),
    ext: text("ext"),
    create_at: text("create_at").notNull(),
})

const shop_price_table = sqliteTable("shop_price", {
    id: integer("id").primaryKey({autoIncrement: true}),
    item_id: text("item_id").notNull(),
    shop_name: text("shop_name").notNull(),
    player: text("player"),
    sell_type: text("sell_type").notNull(),
    count: text("count"),
    position: text("position"),
    batch_id: text("batch_id").notNull(),
    create_at: text("create_at").notNull(),
    price: integer("price").notNull(),
})

const landmark_table = sqliteTable("landmark", {
    id: integer("id").primaryKey({autoIncrement: true}),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    description: text("description").notNull(),
    owner: text("owner").notNull(),
    owner_key: text("owner_key").notNull(),
    visits: integer("visits").notNull(),
    price: text("price").notNull(),
    item_id: text("item_id").notNull(),
    batch_id: text("batch_id").notNull(),
    first_seen_at: text("first_seen_at").notNull(),
    updated_at: text("updated_at").notNull(),
})

const shop_list_table = sqliteTable("shop_list", {
    id: integer("id").primaryKey({autoIncrement: true}),
    shopname: text("shopname").notNull().unique(),
    create_at: text("create_at").notNull(),
    new_batch_id: text("new_batch_id"),
})

const map_artwork_table = sqliteTable("map_artwork", {
    id: integer("id").primaryKey({autoIncrement: true}),
    dat_name: text("dat_name").notNull(),
    content_hash: text("content_hash").notNull(),
    name: text("name").notNull(),
    price: text("price").notNull(),
    source_pw: text("source_pw").notNull(),
    author: text("author").notNull(),
    creator_username: text("creator_username").notNull(),
    group_id: text("group_id").notNull(),
    artwork_hash: text("artwork_hash"),
    group_position_x: integer("group_position_x").notNull(),
    group_position_y: integer("group_position_y").notNull(),
    rotation: integer("rotation").notNull().default(0),
    mirror: integer("mirror").notNull().default(0),
    map_id: integer("map_id").notNull(),
    frame_x: integer("frame_x").notNull(),
    frame_y: integer("frame_y").notNull(),
    frame_z: integer("frame_z").notNull(),
    frame_facing: text("frame_facing"),
    icons_file: text("icons_file").notNull(),
    preview_file: text("preview_file").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
})

export interface PublicChatMessageCursor {
    readonly id: number
}

export interface PublicChatMessagePageMessage {
    readonly id: number
    readonly username: string
    readonly content: string
    readonly create_time: string
}

export interface PublicChatMessagePage {
    readonly messages: readonly PublicChatMessagePageMessage[]
    readonly next_cursor: PublicChatMessageCursor | null
}

export class init {
    private database_path = path.join(path_utils.get_project_root_path(), "/storage/bangxi_server_storage/data", "bangxi_server.db")
    private last_player_list_path = path.join(path_utils.get_project_root_path(), "/storage/bangxi_server_storage/data", "last_player_list.json")
    private database: any
    private orm: any
    /** 玩家消失超过该时间（毫秒）才判定为下线 */
    private static readonly OFFLINE_TIMEOUT_MS = 30_000
    /** 两次检测间隔超过该时间（毫秒）则切断旧会话，开启新会话 */
    private static readonly SESSION_GAP_MS = 3_600_000
    private player_list = {
        display_name_list: [] as string[],
        player_name_list: [] as string[],
        session_start: {} as Record<string, number>,
        last_seen: {} as Record<string, number>,
    }

    public user_permission_map = {
        "member": 0,
        "admin": 1,
        "owner": 2
    }

    /** 声明控制台命令 */
    public console_commands = {
        change_permission: {
            description: "修改用户权限",
            args: ["username", "permission(member|admin|owner)"],
            handler: (args: string[]) => {
                const [username, permission] = args
                if (!username || !permission) {
                    return "用法: /storage select bangxi_server_storage change_permission <username> <permission>"
                }
                if (!["member", "admin", "owner"].includes(permission)) {
                    return `错误: 权限必须是 member, admin 或 owner`
                }
                try {
                    this.change_permission(username, permission as keyof typeof this.user_permission_map)
                    return `成功将用户 ${username} 的权限修改为 ${permission}`
                } catch (error: any) {
                    return `修改权限失败: ${error.message}`
                }
            }
        },
        add_user: {
            description: "添加用户（默认 member 权限）",
            args: ["username", "password"],
            handler: (args: string[]) => {
                const [username, password] = args
                if (!username || !password) {
                    return "用法: /storage select bangxi_server_storage add_user <username> <password>"
                }
                try {
                    const existing = this.orm.select({id: user_table.id})
                        .from(user_table)
                        .where(eq(user_table.username, username))
                        .get()
                    if (existing) {
                        return `用户 ${username} 已存在`
                    }
                    this.orm.insert(user_table).values({
                        username,
                        password,
                        role: "member",
                        create_time: new Date().toISOString(),
                        first_record_time: new Date().toISOString(),
                    }).run()
                    return `成功添加用户 ${username}，权限为 member`
                } catch (error: any) {
                    return `添加用户失败: ${error.message}`
                }
            }
        },
        remove_user: {
            description: "删除用户",
            args: ["username"],
            handler: (args: string[]) => {
                const [username] = args
                if (!username) {
                    return "用法: /storage select bangxi_server_storage remove_user <username>"
                }
                try {
                    const existing = this.orm.select({id: user_table.id})
                        .from(user_table)
                        .where(eq(user_table.username, username))
                        .get()
                    if (!existing) {
                        return `用户 ${username} 不存在`
                    }
                    this.orm.delete(user_table)
                        .where(eq(user_table.username, username))
                        .run()
                    return `成功删除用户 ${username}`
                } catch (error: any) {
                    return `删除用户失败: ${error.message}`
                }
            }
        },
        cpwd: {
            description: "修改用户密码",
            args: ["username", "password"],
            handler: (args: string[]) => {
                const [username, password] = args
                if (!username || !password) {
                    return "用法: /storage select bangxi_server_storage cpwd <username> <new_password>"
                }
                try {
                    const existing = this.orm.select({id: user_table.id})
                        .from(user_table)
                        .where(eq(user_table.username, username))
                        .get()
                    if (!existing) {
                        return `用户 ${username} 不存在`
                    }
                    this.database.prepare("UPDATE user SET password = ? WHERE LOWER(username) = LOWER(?)")
                        .run(password, username.trim())
                    return `成功修改用户 ${username} 的密码`
                } catch (error: any) {
                    return `修改密码失败: ${error.message}`
                }
            }
        },
        add_point: {
            description: "为用户添加积分",
            args: ["username", "amount", "reason(可选)"],
            handler: (args: string[]) => {
                const [username, amount, ...reasonParts] = args
                const reason = reasonParts.join(" ") || "控制台添加"
                if (!username || !amount) {
                    return "用法: /storage select bangxi_server_storage add_point <username> <amount> [reason]"
                }
                const point = Number(amount)
                if (!Number.isFinite(point) || point <= 0) {
                    return "错误: 积分数量必须大于 0"
                }
                try {
                    const result = this.change_point(username, "add", point, reason)
                    if (!result.success) {
                        return `添加积分失败: ${result.message}`
                    }
                    return `成功为用户 ${username} 添加 ${point} 积分，当前余额: ${result.point}`
                } catch (error: any) {
                    return `添加积分失败: ${error.message}`
                }
            }
        }
    }

    constructor() {
        this.init_database()
    }

    private init_database() {
        if (!fs.existsSync(this.database_path)) {
            fs.mkdirSync(path.dirname(this.database_path), {recursive: true})
            fs.writeFileSync(this.database_path, "")
        }
        this.database = new Database(this.database_path)
        this.orm = drizzle(this.database)
        const user_table_init_sql = orm_utils.convert_table_to_sqlite_sql(user_table)
        this.database.exec(user_table_init_sql)
        const message_table_init_sql = orm_utils.convert_table_to_sqlite_sql(message_table)
        this.database.exec(message_table_init_sql)
        const point_log_table_init_sql = orm_utils.convert_table_to_sqlite_sql(point_log_table)
        this.database.exec(point_log_table_init_sql)
        const shop_price_table_init_sql = orm_utils.convert_table_to_sqlite_sql(shop_price_table)
        this.database.exec(shop_price_table_init_sql)
        const landmark_table_init_sql = orm_utils.convert_table_to_sqlite_sql(landmark_table)
        this.database.exec(landmark_table_init_sql)
        const shop_list_table_init_sql = orm_utils.convert_table_to_sqlite_sql(shop_list_table)
        this.database.exec(shop_list_table_init_sql)
        const map_artwork_table_init_sql = orm_utils.convert_table_to_sqlite_sql(map_artwork_table)
        this.database.exec(map_artwork_table_init_sql)
        this.migrate_user_table()
        this.migrate_shop_price_table()
        this.migrate_map_artwork_table()
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_point_log_game_id ON point_log(game_id)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_point_log_sign_lookup ON point_log(game_id, ext, create_at)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_message_position_type_id ON message(position, message_type, id DESC)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_message_username_type_position_id ON message(username, message_type, position, id DESC)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_shop_price_item_type_shop ON shop_price(item_id, sell_type, shop_name, id)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_shop_price_shop ON shop_price(shop_name, id)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_shop_price_batch ON shop_price(batch_id)")
        this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_landmark_owner_name ON landmark(owner_key, name_key)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_landmark_name ON landmark(name_key, id)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_landmark_owner ON landmark(owner_key, name_key, id)")
        this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_list_shopname ON shop_list(shopname)")
        this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_map_artwork_dat_name ON map_artwork(dat_name)")
        this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_map_artwork_artwork_hash ON map_artwork(artwork_hash)")
        this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_map_artwork_group_position ON map_artwork(group_id, group_position_x, group_position_y)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_map_artwork_creator_created ON map_artwork(creator_username, created_at DESC)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_map_artwork_source_pw ON map_artwork(source_pw)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_map_artwork_group ON map_artwork(group_id, group_position_y, group_position_x)")
        this.restore_player_list()
    }

    /** 为已经存在的 shop_price 表补齐价格快照字段。 */
    private migrate_shop_price_table() {
        const columns = new Set((this.database.prepare("PRAGMA table_info(shop_price)").all() as Array<{name: string}>).map(column => column.name))
        if (!columns.has("sell_type")) this.database.exec("ALTER TABLE shop_price ADD COLUMN sell_type TEXT NOT NULL DEFAULT 'sell'")
        if (!columns.has("player")) this.database.exec("ALTER TABLE shop_price ADD COLUMN player TEXT")
        if (!columns.has("count")) this.database.exec("ALTER TABLE shop_price ADD COLUMN count TEXT")
        if (!columns.has("position")) this.database.exec("ALTER TABLE shop_price ADD COLUMN position TEXT")
        if (!columns.has("batch_id")) this.database.exec("ALTER TABLE shop_price ADD COLUMN batch_id TEXT NOT NULL DEFAULT 'legacy'")
    }

    /** 从本地文件恢复上次的 player_list，防止重启丢失会话数据 */
    private restore_player_list() {
        try {
            if (fs.existsSync(this.last_player_list_path)) {
                const data = fs.readFileSync(this.last_player_list_path, "utf-8")
                const parsed = JSON.parse(data)
                this.player_list = {
                    display_name_list: parsed.display_name_list || [],
                    player_name_list: parsed.player_name_list || [],
                    session_start: parsed.session_start || {},
                    last_seen: parsed.last_seen || {},
                }
            }
        } catch {
            // 文件不存在或解析失败，保持默认空列表
        }
    }

    /** 将当前 player_list 持久化到本地文件 */
    private save_player_list() {
        try {
            fs.writeFileSync(this.last_player_list_path, JSON.stringify(this.player_list, null, 2))
        } catch {
            // 写入失败，忽略
        }
    }

    /** 确保用户记录存在，不存在则创建 */
    private ensure_user_exists(username: string) {
        const row = this.orm.select({id: user_table.id})
            .from(user_table)
            .where(eq(user_table.username, username))
            .get()
        if (!row) {
            this.orm.insert(user_table).values({
                username,
                create_time: new Date().toISOString(),
                first_record_time: new Date().toISOString(),
            }).run()
        }
    }

    /** 迁移旧格式的 session 数据：将 {start, end, duration} 转换为新格式 */
    private migrate_old_sessions(sessions: any[]): any[] {
        return sessions.map(session => {
            // 如果已经是新格式（有 start, end, duration 三个字段且 end 可能为 null），则保持不变
            // 如果是旧格式（start, end, duration 都有值但可能缺少 null 的情况），也保持不变
            if (session.start && session.end && session.duration !== undefined) {
                return session
            }
            // 其他异常格式，尝试保留
            return session
        })
    }

    /** 开启新会话：在 online_session 中追加一个开放的 session */
    private start_session(username: string, start_time: number) {
        this.ensure_user_exists(username)

        const row = this.orm.select({
            id: user_table.id,
            online_session: user_table.online_session,
        })
            .from(user_table)
            .where(eq(user_table.username, username))
            .get() as { id: number; online_session: string } | undefined

        if (!row) return

        const online_session_list = this.migrate_old_sessions(JSON.parse(row.online_session || "[]"))
        online_session_list.push({
            start: new Date(start_time).toISOString(),
            end: null,
            duration: null,
        })

        this.orm.update(user_table)
            .set({
                online_session: JSON.stringify(online_session_list),
            })
            .where(eq(user_table.id, row.id))
            .run()
    }

    /** 关闭玩家会话：找到最后一个开放的 session，计算时长并更新 */
    private close_session(username: string, end_time: number) {
        const row = this.orm.select({
            id: user_table.id,
            online_time: user_table.online_time,
            online_session: user_table.online_session,
        })
            .from(user_table)
            .where(eq(user_table.username, username))
            .get() as { id: number; online_time: number; online_session: string } | undefined

        if (!row) return

        const online_session_list = this.migrate_old_sessions(JSON.parse(row.online_session || "[]"))
        
        // 找到最后一个未关闭的 session（end 为 null）
        const last_open_index = online_session_list.findLastIndex((s: any) => s.end === null)
        
        if (last_open_index === -1) return

        const session = online_session_list[last_open_index]
        const start_time = new Date(session.start).getTime()
        const duration = Math.floor((end_time - start_time) / 1000)

        // 更新该 session
        online_session_list[last_open_index] = {
            start: session.start,
            end: new Date(end_time).toISOString(),
            duration,
        }

        const online_time = row.online_time || 0

        this.orm.update(user_table)
            .set({
                online_time: online_time + duration,
                online_session: JSON.stringify(online_session_list),
            })
            .where(eq(user_table.id, row.id))
            .run()
    }

    handle_player_list(players: any[]) {
        const new_display_name_list = players.map(player => player.displayName.toString())
        const new_player_name_list = players.map(player => player.username.toString())

        const now = Date.now()
        const tracked = this.player_list.player_name_list
        const session_start = this.player_list.session_start
        const last_seen = this.player_list.last_seen

        // 最终仍在线的玩家（包括宽限期内尚未确认下线的玩家）
        const still_online: string[] = []
        const still_online_display: string[] = []
        let changed = false

        // 1. 遍历已追踪的玩家，判断是否仍在服务器中
        for (let i = 0; i < tracked.length; i++) {
            const username = tracked[i]
            const new_idx = new_player_name_list.indexOf(username)

            if (new_idx !== -1) {
                const seen = last_seen[username]
                if (seen !== undefined && now - seen >= init.SESSION_GAP_MS) {
                    // 距上次检测已超过 1h（bot 断线重连等），在 last_seen 时间点关闭旧会话，开启新会话
                    this.close_session(username, seen)
                    this.start_session(username, now)
                    session_start[username] = now
                    changed = true
                }
                // 玩家仍在服务器中，更新最后可见时间
                last_seen[username] = now
                still_online.push(username)
                still_online_display.push(new_display_name_list[new_idx])
            } else {
                // 玩家不在新列表中，检查是否超过宽限时间
                const seen = last_seen[username]

                if (seen !== undefined && now - seen >= init.OFFLINE_TIMEOUT_MS) {
                    // 消失超过 30s，判定为真正下线
                    this.close_session(username, now)
                    delete session_start[username]
                    delete last_seen[username]
                    changed = true
                } else {
                    // 宽限期内，继续追踪，保留旧的 display_name
                    still_online.push(username)
                    still_online_display.push(this.player_list.display_name_list[i])
                }
            }
        }

        // 2. 找出真正新上线的玩家（在新列表中但不在追踪列表中）
        for (let i = 0; i < new_player_name_list.length; i++) {
            const username = new_player_name_list[i]
            if (!still_online.includes(username)) {
                this.ensure_user_exists(username)
                this.start_session(username, now)
                session_start[username] = now
                last_seen[username] = now
                still_online.push(username)
                still_online_display.push(new_display_name_list[i])
                changed = true
            }
        }

        // 更新追踪列表
        this.player_list.display_name_list = still_online_display
        this.player_list.player_name_list = still_online

        // 只在发生变化时持久化
        if (changed) {
            this.save_player_list()
        }
    }

    handle_message(data: any) {
        if (data.position === "chat") {
            const chat_info = parseChatInfo(data.message.normalized)
            this.orm.insert(message_table).values({
                username: data.player_name || "unknown",
                area: chat_info.area || "unknown",
                address: chat_info.address || "unknown",
content: data.message.plainText || "",
                message_type: "public",
                position: "chat",
                create_time: new Date().toISOString(),
            }).run()

            this.ensure_user_exists(data.player_name)

            const set_values: Record<string, any> = {
                message_count: sql`${user_table.message_count} + 1`,
            }

            // 更新 address_list：去重追加
            if (chat_info.address) {
                const user_row = this.orm.select({address_list: user_table.address_list})
                    .from(user_table)
                    .where(eq(user_table.username, data.player_name))
                    .get() as { address_list: string } | undefined

                const address_list = JSON.parse(user_row?.address_list || "[]") as string[]
                if (!address_list.includes(chat_info.address)) {
                    address_list.push(chat_info.address)
                    set_values.address_list = JSON.stringify(address_list)
                }
            }

            this.orm.update(user_table)
                .set(set_values)
                .where(eq(user_table.username, data.player_name))
                .run()
        } else {
            if (isPrivateMessage(data.message.normalized)) {
                const private_msg = parsePrivateMessage(data.message.plainText)
                if (private_msg) {
                    this.orm.insert(message_table).values({
                        username: private_msg.from,
                        area: "私聊无法获取",
                        address: "私聊无法获取",
                        content: private_msg.content || "unknown",
                        message_type: "private",
                        position: "chat",
                        create_time: new Date().toISOString(),
                    }).run()
                }
            } else {
                const point_transfer_msg = parsePointTransferMessage(data.message.plainText)
                if (point_transfer_msg) {
                    this.ensure_user_exists(point_transfer_msg.username)
                    const result = this.change_point(
                        point_transfer_msg.username,
                        "add",
                        point_transfer_msg.point,
                        "用户通过bot充值",
                        "bot_recharge"
                    )
                    if (!result.success) {
                        storage_logger("bangxi_server_storage", `用户 ${point_transfer_msg.username} 充值积分失败: ${result.message}`, "error")
                    }
                }
                this.orm.insert(message_table).values({
                    username: "system",
                    area: "系统",
                    address: "系统",
content: data.message.plainText || "",
                    message_type: "public",
                    position: "system",
                    create_time: new Date().toISOString(),
                }).run()
            }
        }
    }

    event_handler(event: string, data: any) {
        if (data.adapter === "mineflayer" && data.instance_name === "bangxi") {
            switch (event) {
                case "player_list":
                    this.handle_player_list(data.players)
                    break
                case "message":
                    this.handle_message(data)
                    break
                default:
                    break
            }
        }
    }

    get_message_orm() {
        return {
            orm: this.orm,
            table: message_table
        }
    }

    insert_money_history(
        username: string | SQLWrapper,
        money: unknown
    ): void {
        const usernameValue =
            typeof username === 'string'
                ? username
                : username.toString();

        this.ensure_user_exists(usernameValue);

        const row = this.orm
            .select({
                moneyHistory: user_table.money_history
            })
            .from(user_table)
            .where(eq(user_table.username, usernameValue))
            .get();

        const history = JSON.parse(
            row?.moneyHistory || '[]'
        ) as unknown[];

        this.orm
            .update(user_table)
            .set({
                money_history: JSON.stringify([
                    ...history,
                    {
                        money,
                        timestamp: new Date().toISOString()
                    }
                ])
            })
            .where(eq(user_table.username, usernameValue))
            .run();
    }

    /** 为已经存在的用户表补齐 API key 摘要字段。 */
    private migrate_user_table() {
        const columns = new Set((this.database.prepare("PRAGMA table_info(user)").all() as Array<{name: string}>).map(column => column.name))
        if (!columns.has("apikey")) this.database.exec("ALTER TABLE user ADD COLUMN apikey TEXT NOT NULL DEFAULT ''")
    }

    private migrate_map_artwork_table() {
        const columns = new Set((this.database.prepare("PRAGMA table_info(map_artwork)").all() as Array<{name: string}>).map(column => column.name))
        if (!columns.has("rotation")) this.database.exec("ALTER TABLE map_artwork ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0")
        if (!columns.has("mirror")) this.database.exec("ALTER TABLE map_artwork ADD COLUMN mirror INTEGER NOT NULL DEFAULT 0")
        if (!columns.has("artwork_hash")) this.database.exec("ALTER TABLE map_artwork ADD COLUMN artwork_hash TEXT")
        this.database.exec("DROP INDEX IF EXISTS idx_map_artwork_content_hash")
        this.database.exec(`CREATE TABLE IF NOT EXISTS map_artwork_group (
            group_id TEXT PRIMARY KEY, name TEXT NOT NULL, price TEXT NOT NULL, source_pw TEXT NOT NULL,
            author TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'other',
            tags TEXT NOT NULL DEFAULT '[]', creator_username TEXT NOT NULL, preview_file TEXT NOT NULL,
            artwork_hash TEXT, visibility TEXT NOT NULL DEFAULT 'public', status TEXT NOT NULL DEFAULT 'published',
            moderation_reason TEXT NOT NULL DEFAULT '', view_count INTEGER NOT NULL DEFAULT 0,
            like_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            moderated_by TEXT, moderated_at TEXT
        )`)
        this.database.exec(`CREATE TABLE IF NOT EXISTS map_artwork_favorite (
            group_id TEXT NOT NULL, username TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY (group_id, username)
        )`)
        this.database.exec(`CREATE TABLE IF NOT EXISTS map_artwork_version (
            id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, revision INTEGER NOT NULL,
            metadata TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE(group_id, revision)
        )`)
        this.database.exec(`CREATE TABLE IF NOT EXISTS map_artwork_report (
            id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, reporter_username TEXT NOT NULL,
            reason TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT
        )`)
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_map_artwork_group_browse ON map_artwork_group(status, visibility, created_at DESC)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_map_artwork_group_creator ON map_artwork_group(creator_username, updated_at DESC)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_map_artwork_favorite_user ON map_artwork_favorite(username, created_at DESC)")
        const legacyGroups = this.database.prepare("SELECT group_id, MIN(id) AS id FROM map_artwork GROUP BY group_id").all() as Array<{group_id: string, id: number}>
        const legacy = this.database.prepare("SELECT * FROM map_artwork WHERE id = ?")
        const insert = this.database.prepare(`INSERT OR IGNORE INTO map_artwork_group (
            group_id, name, price, source_pw, author, creator_username, preview_file, artwork_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        const backfill = this.database.transaction(() => legacyGroups.forEach(({id}) => {
            const row = legacy.get(id) as any
            insert.run(row.group_id, row.name, row.price, row.source_pw, row.author, row.creator_username, row.preview_file, row.artwork_hash, row.created_at, row.updated_at)
        }))
        backfill()
    }

    /** 获取最近一次金币查询结果，供 Web API 的短期缓存使用。 */
    get_latest_money_history(username: string): {money: unknown, timestamp: string} | null {
        const row = this.orm.select({moneyHistory: user_table.money_history})
            .from(user_table)
            .where(eq(user_table.username, username))
            .get() as {moneyHistory: string | null} | undefined
        if (!row?.moneyHistory) return null

        try {
            const history = JSON.parse(row.moneyHistory) as Array<{money?: unknown, timestamp?: unknown}>
            for (let index = history.length - 1; index >= 0; index--) {
                const item = history[index]
                if (item && typeof item.timestamp === "string" && !Number.isNaN(Date.parse(item.timestamp))) {
                    return {money: item.money, timestamp: item.timestamp}
                }
            }
        } catch {
            return null
        }

        return null
    }

    /** 返回玩家是否在最近一次服务器玩家列表中在线。 */
    is_user_online(username: string): boolean {
        return this.player_list.player_name_list.includes(username)
    }

    change_permission(username: string, permission: keyof typeof this.user_permission_map): void {
        if (!this.user_permission_map.hasOwnProperty(permission)) {
            throw new Error("错误的权限类型")
        }
        this.ensure_user_exists(username)
        this.orm.update(user_table)
            .set({ role: permission })
            .where(eq(user_table.username, username))
            .run();
    }

    /** 查询已存在玩家的积分余额。point 为对外积分单位，point_minor 为数据库整数单位。 */
    get_point_balance(game_id: string) {
        const row = this.database.prepare(
            "SELECT username, point FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
        ).get(game_id) as {username: string, point: number | null} | undefined

        if (!row) return {success: false as const, message: "玩家不存在"}
        const point_minor = row.point || 0
        return {success: true as const, game_id: row.username, point: point_minor / 100, point_minor}
    }

    /** 查询积分流水，按最新记录倒序返回。 */
    get_point_logs(game_id: string, limit: number = 10) {
        const user = this.database.prepare(
            "SELECT username FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
        ).get(game_id) as {username: string} | undefined
        if (!user) return {success: false as const, message: "玩家不存在"}

        const safe_limit = Math.max(1, Math.min(50, Math.floor(limit)))
        const logs = this.database.prepare(
            "SELECT id, game_id, action, num, reason, ext, create_at FROM point_log WHERE LOWER(game_id) = LOWER(?) ORDER BY id DESC LIMIT ?"
        ).all(user.username, safe_limit) as Array<{
            id: number
            game_id: string
            action: "add" | "remove"
            num: number
            reason: string
            ext: string | null
            create_at: string
        }>
        return {success: true as const, game_id: user.username, logs}
    }

    /** 分页查询全服积分流水，供管理端审计使用。 */
    search_admin_point_logs(page: number = 1, page_size: number = 20, filters: {keyword?: string, username?: string, ext?: string, create_time_from?: string, create_time_to?: string} = {}) {
        const conditions: string[] = []
        const values: string[] = []
        const addLike = (column: string, value?: string) => {
            if (!value) return
            conditions.push(`LOWER(${column}) LIKE LOWER(?)`)
            values.push(`%${value}%`)
        }
        addLike("game_id", filters.username)
        addLike("reason", filters.keyword)
        addLike("ext", filters.ext)
        if (filters.create_time_from) {
            conditions.push("create_at >= ?")
            values.push(filters.create_time_from)
        }
        if (filters.create_time_to) {
            conditions.push("create_at <= ?")
            values.push(filters.create_time_to)
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
        const safe_page_size = Math.max(1, Math.min(100, Math.floor(page_size)))
        const total = Number((this.database.prepare(`SELECT COUNT(*) AS total FROM point_log ${where}`).get(...values) as {total: number}).total || 0)
        const total_pages = Math.max(1, Math.ceil(total / safe_page_size))
        const current_page = Math.min(Math.max(1, Math.floor(page)), total_pages)
        const logs = this.database.prepare(
            `SELECT id, game_id, action, num, reason, ext, create_at FROM point_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
        ).all(...values, safe_page_size, (current_page - 1) * safe_page_size) as Array<{
            id: number
            game_id: string
            action: "add" | "remove"
            num: number
            reason: string
            ext: string | null
            create_at: string
        }>
        return {logs, total, page: current_page, page_size: safe_page_size}
    }

    /** 分页查询积分流水，并将动态 ext 归入稳定的网页筛选分类。 */
    get_point_logs_page(game_id: string, page: number = 1, page_size: number = 10, category: string = "all") {
        const user = this.database.prepare(
            "SELECT username FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
        ).get(game_id) as {username: string} | undefined
        if (!user) return {success: false as const, message: "玩家不存在"}

        const categories: Record<string, string> = {
            all: "1 = 1",
            sign: "ext = 'sign'",
            recharge: "ext = 'bot_recharge'",
            player_info: "(ext IN ('info_realtime', 'info_history') OR ext LIKE 'web_player_info:%')",
            agent: "(ext LIKE 'agent_prompt:%' OR ext LIKE 'agent_prompt_refund:%')",
            map_share: "ext = 'map_share_scan'",
            shop: "(ext LIKE 'web_shop_%' OR ext LIKE 'price_update:%')",
            public_api: "ext = 'public_info'",
            admin: "ext LIKE 'admin:%'",
        }
        const known = Object.entries(categories).filter(([key]) => key !== "all").map(([, clause]) => clause).join(" OR ")
        categories.manual = `(ext IS NULL OR NOT (${known}))`
        if (!Object.hasOwn(categories, category)) return {success: false as const, message: "积分流水分类无效"}

        const safe_page = Math.max(1, Math.floor(page))
        const safe_page_size = Math.max(1, Math.min(50, Math.floor(page_size)))
        const where = `LOWER(game_id) = LOWER(?) AND (${categories[category]})`
        const total = Number((this.database.prepare(`SELECT COUNT(*) AS total FROM point_log WHERE ${where}`).get(user.username) as {total: number}).total || 0)
        const total_pages = Math.max(1, Math.ceil(total / safe_page_size))
        const current_page = Math.min(safe_page, total_pages)
        const logs = this.database.prepare(
            `SELECT id, game_id, action, num, reason, ext, create_at FROM point_log WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
        ).all(user.username, safe_page_size, (current_page - 1) * safe_page_size) as Array<{
            id: number
            game_id: string
            action: "add" | "remove"
            num: number
            reason: string
            ext: string | null
            create_at: string
        }>

        const category_of = (ext: string | null) => {
            if (ext === "sign") return "sign"
            if (ext === "bot_recharge") return "recharge"
            if (ext === "info_realtime" || ext === "info_history" || ext?.startsWith("web_player_info:")) return "player_info"
            if (ext?.startsWith("agent_prompt:") || ext?.startsWith("agent_prompt_refund:")) return "agent"
            if (ext === "map_share_scan") return "map_share"
            if (ext?.startsWith("web_shop_") || ext?.startsWith("price_update:")) return "shop"
            if (ext === "public_info") return "public_api"
            if (ext?.startsWith("admin:")) return "admin"
            return "manual"
        }
        return {
            success: true as const,
            game_id: user.username,
            logs: logs.map(log => ({...log, category: category_of(log.ext)})),
            pagination: {
                page: current_page,
                page_size: safe_page_size,
                total,
                total_pages,
                has_previous: current_page > 1,
                has_next: current_page < total_pages,
            },
        }
    }

    /** 原子修改积分并记录流水；所有修改必须提供理由，删除积分时不允许余额变为负数。 */
    change_point(game_id: string, action: "add" | "remove", point: number, reason: string, ext: string | null = null) {
        const normalized_reason = typeof reason === "string" ? reason.trim() : ""
        if (action !== "add" && action !== "remove") {
            return {success: false as const, message: "积分操作类型无效"}
        }
        if (!normalized_reason) {
            return {success: false as const, message: "修改积分时必须提供原因"}
        }
        if (normalized_reason.length > 200) {
            return {success: false as const, message: "原因最多允许 200 个字符"}
        }

        const point_minor = Math.round(point * 100)
        if (!Number.isFinite(point) || point_minor <= 0 || point_minor !== point * 100) {
            return {success: false as const, message: "积分数量必须大于 0 且最多两位小数"}
        }

        return this.database.transaction(() => {
            const row = this.database.prepare(
                "SELECT username, point FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
            ).get(game_id) as {username: string, point: number | null} | undefined
            if (!row) return {success: false as const, message: "玩家不存在"}

            const current_minor = row.point || 0
            if (action === "remove" && current_minor < point_minor) {
                return {success: false as const, message: "积分余额不足", point: current_minor / 100}
            }

            const balance_minor = action === "add"
                ? current_minor + point_minor
                : current_minor - point_minor
            const create_at = new Date().toISOString()
            this.database.prepare("UPDATE user SET point = ? WHERE username = ?")
                .run(balance_minor, row.username)
            this.database.prepare(
                "INSERT INTO point_log (game_id, action, num, reason, ext, create_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(row.username, action, point_minor, normalized_reason, ext, create_at)

            return {
                success: true as const,
                game_id: row.username,
                point: balance_minor / 100,
                changed_point: point_minor / 100
            }
        })()
    }

    /** 按 Asia/Shanghai 日期原子完成每日签到和流水记录。 */
    sign_point(game_id: string, reward_point: number, sign_date: string) {
        const reward_minor = Math.round(reward_point * 100)
        if (!Number.isFinite(reward_point) || reward_minor < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(sign_date)) {
            return {success: false as const, message: "签到参数无效"}
        }

        const start_at = new Date(`${sign_date}T00:00:00+08:00`)
        const end_at = new Date(start_at.getTime() + 24 * 60 * 60 * 1000)
        return this.database.transaction(() => {
            const row = this.database.prepare(
                "SELECT username, point FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
            ).get(game_id) as {username: string, point: number | null} | undefined
            if (!row) return {success: false as const, message: "玩家不存在"}

            const signed = this.database.prepare(
                "SELECT id FROM point_log WHERE LOWER(game_id) = LOWER(?) AND action = 'add' AND ext = 'sign' AND create_at >= ? AND create_at < ? LIMIT 1"
            ).get(row.username, start_at.toISOString(), end_at.toISOString())
            if (signed) return {success: false as const, message: "今天已经签到过了"}

            const balance_minor = (row.point || 0) + reward_minor
            const create_at = new Date().toISOString()
            this.database.prepare("UPDATE user SET point = ? WHERE username = ?")
                .run(balance_minor, row.username)
            this.database.prepare(
                "INSERT INTO point_log (game_id, action, num, reason, ext, create_at) VALUES (?, 'add', ?, '每日签到', 'sign', ?)"
            ).run(row.username, reward_minor, create_at)

            return {
                success: true as const,
                game_id: row.username,
                point: balance_minor / 100,
                reward_point: reward_minor / 100
            }
        })()
    }

    /** 追加一次完整商店快照。price 使用金币单位，对外允许最多两位小数。 */
    private repair_shop_list_after_price_change(shop_name: string) {
        const shop = shop_name.trim()
        const latest = this.database.prepare(`
            SELECT shop_name, batch_id, create_at FROM shop_price
            WHERE LOWER(shop_name) = LOWER(?) ORDER BY id DESC LIMIT 1
        `).get(shop) as {shop_name: string, batch_id: string, create_at: string} | undefined
        if (latest) {
            this.database.prepare(
                "UPDATE shop_list SET shopname = ?, new_batch_id = ?, create_at = ? WHERE LOWER(shopname) = LOWER(?)"
            ).run(latest.shop_name, latest.batch_id, latest.create_at, shop)
        } else {
            this.database.prepare("DELETE FROM shop_list WHERE LOWER(shopname) = LOWER(?)").run(shop)
        }
        return {new_batch_id: latest?.batch_id || null, shop_removed: !latest}
    }

    add_shop_price_snapshot(shop_name: string, prices: Array<{item_id: string, player?: string, sell_type: "sell" | "buy", price: number, count?: string, position?: string}>) {
        const normalized_shop = shop_name.trim()
        if (!normalized_shop || normalized_shop.length > 64) return {success: false as const, message: "商店名称无效"}
        if (!Array.isArray(prices) || prices.length === 0) return {success: false as const, message: "没有读取到有效价格"}

        const rows = prices.map(item => ({
            item_id: item.item_id.trim(), player: item.player?.trim() || null, sell_type: item.sell_type,
            price: Math.round(item.price * 100), count: item.count?.trim() || null,
            position: item.position?.trim() || null
        }))
        if (rows.some(row => !row.item_id || !["sell", "buy"].includes(row.sell_type) || !Number.isSafeInteger(row.price) || row.price <= 0)) {
            return {success: false as const, message: "价格快照包含无效数据"}
        }

        const batch_id = crypto.randomUUID()
        const create_at = new Date().toISOString()
        this.database.transaction(() => {
            const insert = this.database.prepare(
                "INSERT INTO shop_price (item_id, shop_name, player, sell_type, count, position, batch_id, create_at, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            for (const row of rows) insert.run(row.item_id, normalized_shop, row.player, row.sell_type, row.count, row.position, batch_id, create_at, row.price)
            this.database.prepare(
                "INSERT INTO shop_list (shopname, create_at, new_batch_id) VALUES (?, ?, ?) ON CONFLICT(shopname) DO UPDATE SET new_batch_id = excluded.new_batch_id"
            ).run(normalized_shop, create_at, batch_id)
        })()
        return {success: true as const, shop_name: normalized_shop, batch_id, inserted: rows.length}
    }

    /** 每家商店只返回其最近一次快照中的当前价格；若同店同批次同物品有多个价格，先在店内做一次异常值剔除后取均价。 */
    get_current_shop_prices(item_id: string, sell_type: "sell" | "buy") {
        const item = item_id.trim()
        if (!item || !["sell", "buy"].includes(sell_type)) return []
        const latest_batches = this.database.prepare(`
            SELECT LOWER(shop_name) AS shop_key, batch_id, MAX(id) AS last_id
            FROM shop_price
            GROUP BY LOWER(shop_name)
        `).all() as Array<{shop_key: string, batch_id: string, last_id: number}>
        if (!latest_batches.length) return []

        const select_rows = this.database.prepare(`
            SELECT shop_name AS shop, player, price, count, position, create_at
            FROM shop_price
            WHERE LOWER(shop_name) = ? AND batch_id = ? AND LOWER(item_id) = LOWER(?) AND sell_type = ?
            ORDER BY id ASC
        `)

        const result = latest_batches.flatMap(batch => {
            const rows = select_rows.all(batch.shop_key, batch.batch_id, item, sell_type) as Array<{shop: string, player: string | null, price: number, count: string | null, position: string | null, create_at: string}>
            if (!rows.length) return []
            const {valid: filtered_rows} = split_price_outliers(rows)
            const average_price = filtered_rows.reduce((sum, row) => sum + row.price, 0) / filtered_rows.length
            const base = filtered_rows[0] || rows[0]
            return [{...base, price: average_price / 100}]
        })

        return result.sort((a, b) => a.price - b.price)
    }

    get_shop_list() {
        return this.database.prepare(`
            SELECT id, shopname, create_at, new_batch_id
            FROM shop_list
            ORDER BY shopname COLLATE NOCASE ASC, id ASC
        `).all() as Array<{id: number, shopname: string, create_at: string, new_batch_id: string | null}>
    }

    /** 获取指定商店最近一次完整快照中的全部价格。 */
    get_latest_shop_price_info(shop_name: string) {
        const shop = shop_name.trim()
        if (!shop) return null
        const latest = this.database.prepare(`
            SELECT shop_name, batch_id, create_at
            FROM shop_price
            WHERE LOWER(shop_name) = LOWER(?)
            ORDER BY id DESC
            LIMIT 1
        `).get(shop) as {shop_name: string, batch_id: string, create_at: string} | undefined
        if (!latest) return null

        const prices = this.database.prepare(`
            SELECT id, item_id, player, sell_type, count, position, create_at, price / 100.0 AS price
            FROM shop_price
            WHERE LOWER(shop_name) = LOWER(?) AND batch_id = ?
            ORDER BY id ASC
        `).all(latest.shop_name, latest.batch_id) as Array<{
            id: number, item_id: string, player: string | null, sell_type: "sell" | "buy",
            count: string | null, position: string | null, create_at: string, price: number
        }>
        return {...latest, prices}
    }

    /** 获取某物品在某商店的全部历史价格，按最新记录优先。 */
    get_shop_item_price_history(item_id: string, shop_name: string) {
        const item = item_id.trim()
        const shop = shop_name.trim()
        if (!item || !shop) return []
        return this.database.prepare(`
            SELECT id, item_id, shop_name AS shop, player, sell_type, count, position,
                   batch_id, create_at, price / 100.0 AS price
            FROM shop_price
            WHERE LOWER(item_id) = LOWER(?) AND LOWER(shop_name) = LOWER(?)
            ORDER BY id DESC
        `).all(item, shop) as Array<{
            id: number, item_id: string, shop: string, player: string | null, sell_type: "sell" | "buy",
            count: string | null, position: string | null, batch_id: string, create_at: string, price: number
        }>
    }

    /** 获取指定商店指定批次的完整价格快照。 */
    get_shop_batch_price_info(shop_name: string, batch_id: string) {
        const shop = shop_name.trim()
        const batch = batch_id.trim()
        if (!shop || !batch) return null
        const latest = this.database.prepare(`
            SELECT shop_name, batch_id, MIN(create_at) AS create_at
            FROM shop_price
            WHERE LOWER(shop_name) = LOWER(?) AND batch_id = ?
            GROUP BY shop_name, batch_id
            LIMIT 1
        `).get(shop, batch) as {shop_name: string, batch_id: string, create_at: string} | undefined
        if (!latest) return null
        const prices = this.database.prepare(`
            SELECT id, item_id, player, sell_type, count, position, create_at, price / 100.0 AS price
            FROM shop_price
            WHERE LOWER(shop_name) = LOWER(?) AND batch_id = ?
            ORDER BY item_id COLLATE NOCASE ASC, sell_type DESC, id ASC
        `).all(shop, batch) as Array<{
            id: number, item_id: string, player: string | null, sell_type: "sell" | "buy",
            count: string | null, position: string | null, create_at: string, price: number
        }>
        return {...latest, prices}
    }

    /** 查询某物品在各商店最新批次中的全部报价。 */
    search_shop_item_prices_across_shops(item_id: string, sell_type?: "sell" | "buy") {
        const item = item_id.trim()
        if (!item || item.length > 256 || (sell_type && !["sell", "buy"].includes(sell_type))) return []
        return this.database.prepare(`
            WITH latest_batches AS (
                SELECT LOWER(shop_name) AS shop_key, batch_id
                FROM shop_price
                WHERE id IN (SELECT MAX(id) FROM shop_price GROUP BY LOWER(shop_name))
            )
            SELECT sp.id, sp.item_id, sp.shop_name AS shop, sp.player, sp.sell_type,
                   sp.count, sp.position, sp.batch_id, sp.create_at, sp.price / 100.0 AS price
            FROM shop_price sp
            JOIN latest_batches lb ON LOWER(sp.shop_name) = lb.shop_key AND sp.batch_id = lb.batch_id
            WHERE LOWER(sp.item_id) = LOWER(?) AND (? IS NULL OR sp.sell_type = ?)
            ORDER BY sp.price ASC, sp.shop_name COLLATE NOCASE ASC, sp.id ASC
        `).all(item, sell_type || null, sell_type || null) as Array<{
            id: number, item_id: string, shop: string, player: string | null, sell_type: "sell" | "buy",
            count: string | null, position: string | null, batch_id: string, create_at: string, price: number
        }>
    }

    /** 使用 price 插件相同规则计算各商店最新批次中的物品均价。 */
get_current_item_average(item_id: string, sell_type: "sell" | "buy") {
        const item = item_id.trim()
        if (!item || !["sell", "buy"].includes(sell_type)) return null
        const latest_batches = this.database.prepare(`
            SELECT LOWER(shop_name) AS shop_key, batch_id, MAX(id) AS last_id
            FROM shop_price
            GROUP BY LOWER(shop_name)
        `).all() as Array<{shop_key: string, batch_id: string, last_id: number}>
        if (!latest_batches.length) return null

        const select_rows = this.database.prepare(`
            SELECT shop_name AS shop, player, price, count, position, create_at
            FROM shop_price
            WHERE LOWER(shop_name) = ? AND batch_id = ? AND LOWER(item_id) = LOWER(?) AND sell_type = ?
            ORDER BY id ASC
        `)

        interface ShopRow {shop: string; player: string | null; price: number; count: string | null; position: string | null; create_at: string}
        const shopAverages: ShopPriceValue[] = []
        const rawShopPrices = new Map<string, number[]>()
        const shopBaseRows = new Map<string, ShopRow>()

        for (const batch of latest_batches) {
            const rows = select_rows.all(batch.shop_key, batch.batch_id, item, sell_type) as ShopRow[]
            if (!rows.length) continue
            const {valid: filtered_rows} = split_price_outliers(rows)
            const rawPrices = filtered_rows.map(row => row.price / 100)
            const averagePrice = rawPrices.reduce((sum, p) => sum + p, 0) / rawPrices.length
            shopAverages.push({shop: batch.shop_key, price: averagePrice})
            if (rawPrices.length > 1) rawShopPrices.set(batch.shop_key, rawPrices)
            shopBaseRows.set(batch.shop_key, filtered_rows[0] || rows[0])
        }

        if (!shopAverages.length) return null
        const {valid, adjusted, outliers} = calculate_adjusted_shop_average(shopAverages, rawShopPrices)
        const allValid = [...valid, ...adjusted.map(a => ({shop: a.shop, price: a.adjusted_price}))]
        const average = allValid.reduce((sum, item) => sum + Number(item.price), 0) / allValid.length

        const mapItem = (item: ShopPriceValue): ShopRow => {
            const base = shopBaseRows.get(item.shop)
            return {shop: item.shop, player: base?.player || null, price: item.price, count: base?.count || null, position: base?.position || null, create_at: base?.create_at || ""}
        }
        const mapAdjusted = (item: AdjustedShop): ShopRow & {adjusted_price: number} => {
            const base = shopBaseRows.get(item.shop)
            return {shop: item.shop, player: base?.player || null, price: item.price, adjusted_price: item.adjusted_price, count: base?.count || null, position: base?.position || null, create_at: base?.create_at || ""}
        }
        return {average, shop_count: allValid.length, prices: valid.map(mapItem), adjusted: adjusted.map(mapAdjusted), outliers: outliers.map(mapItem)}
    }

    delete_shop_price_batch(batch_id: string) {
        return this.database.prepare("DELETE FROM shop_price WHERE batch_id = ?").run(batch_id).changes
    }

    /** 删除指定商店的指定批次，自动修复 shop_list 状态。 */
    delete_shop_price_batch_by_shop(shop_name: string, batch_id: string) {
        const shop = shop_name.trim()
        if (!shop || !batch_id) return {success: false as const, message: "参数无效"}
        return this.database.transaction(() => {
            const count = this.database.prepare(
                "DELETE FROM shop_price WHERE LOWER(shop_name) = LOWER(?) AND batch_id = ?"
            ).run(shop, batch_id).changes
            if (!count) return {success: false as const, message: "没有找到该商店的该批次价格记录"}
            const repaired = this.repair_shop_list_after_price_change(shop)
            return {success: true as const, deleted: count, ...repaired}
        })()
    }

    update_shop_price_record(shop_name: string, batch_id: string, price_id: number, price: number) {
        const shop = shop_name.trim()
        const batch = batch_id.trim()
        const cents = Math.round(price * 100)
        if (!shop || !batch || !Number.isSafeInteger(price_id) || price_id <= 0 || !Number.isSafeInteger(cents) || cents <= 0) {
            return {success: false as const, message: "参数无效"}
        }
        const result = this.database.prepare(
            "UPDATE shop_price SET price = ? WHERE id = ? AND LOWER(shop_name) = LOWER(?) AND batch_id = ?"
        ).run(cents, price_id, shop, batch)
        if (!result.changes) return {success: false as const, message: "没有找到该价格记录"}
        const row = this.database.prepare(`
            SELECT id, item_id, player, sell_type, count, position, create_at, price / 100.0 AS price
            FROM shop_price WHERE id = ?
        `).get(price_id)
        return {success: true as const, price: row}
    }

    delete_shop_price_record(shop_name: string, batch_id: string, price_id: number) {
        const shop = shop_name.trim()
        const batch = batch_id.trim()
        if (!shop || !batch || !Number.isSafeInteger(price_id) || price_id <= 0) return {success: false as const, message: "参数无效"}
        return this.database.transaction(() => {
            const result = this.database.prepare(
                "DELETE FROM shop_price WHERE id = ? AND LOWER(shop_name) = LOWER(?) AND batch_id = ?"
            ).run(price_id, shop, batch)
            if (!result.changes) return {success: false as const, message: "没有找到该价格记录"}
            const repaired = this.repair_shop_list_after_price_change(shop)
            return {success: true as const, deleted: result.changes, ...repaired}
        })()
    }

    delete_shop_batch_item(shop_name: string, batch_id: string, item_id: string, sell_type?: "sell" | "buy") {
        const shop = shop_name.trim()
        const batch = batch_id.trim()
        const item = item_id.trim()
        if (!shop || !batch || !item || item.length > 256 || (sell_type && !["sell", "buy"].includes(sell_type))) return {success: false as const, message: "参数无效"}
        return this.database.transaction(() => {
            const result = sell_type
                ? this.database.prepare("DELETE FROM shop_price WHERE LOWER(shop_name) = LOWER(?) AND batch_id = ? AND LOWER(item_id) = LOWER(?) AND sell_type = ?").run(shop, batch, item, sell_type)
                : this.database.prepare("DELETE FROM shop_price WHERE LOWER(shop_name) = LOWER(?) AND batch_id = ? AND LOWER(item_id) = LOWER(?)").run(shop, batch, item)
            if (!result.changes) return {success: false as const, message: "没有找到该批次物品价格"}
            const repaired = this.repair_shop_list_after_price_change(shop)
            return {success: true as const, deleted: result.changes, ...repaired}
        })()
    }

    clear_landmarks() {
        return this.database.prepare("DELETE FROM landmark").run().changes
    }

    insert_landmark_page(landmarks: Array<{name: string, description: string, owner: string, visits: number, price: string, item_id?: string}>) {
        if (!Array.isArray(landmarks)) return {success: false as const, message: "地标页面数据无效"}
        const rows = landmarks.map(landmark => ({
            name: landmark.name?.trim(), description: landmark.description?.trim() || "None",
            owner: landmark.owner?.trim(), visits: Math.max(0, Math.floor(Number(landmark.visits) || 0)),
            price: landmark.price?.trim() || "None", item_id: landmark.item_id?.trim() || ""
        }))
        if (rows.some(row => !row.name || !row.owner || row.name.length > 128 || row.owner.length > 64 || row.description.length > 2000 || row.price.length > 128 || row.item_id.length > 256)) {
            return {success: false as const, message: "地标数据包含无效字段"}
        }
        const batch_id = crypto.randomUUID()
        const now = new Date().toISOString()
        const normalize = (value: string) => value.trim().toLocaleLowerCase()
        return this.database.transaction(() => {
            const find = this.database.prepare("SELECT id FROM landmark WHERE owner_key = ? AND name_key = ?")
            const insert = this.database.prepare("INSERT INTO landmark (name, name_key, description, owner, owner_key, visits, price, item_id, batch_id, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            const update = this.database.prepare("UPDATE landmark SET name = ?, description = ?, owner = ?, visits = ?, price = ?, item_id = ?, batch_id = ?, updated_at = ? WHERE id = ?")
            const seen = new Set<string>()
            let inserted = 0
            let updated = 0
            for (const row of rows) {
                const name_key = normalize(row.name!)
                const owner_key = normalize(row.owner!)
                const key = `${owner_key}\u0000${name_key}`
                if (seen.has(key)) continue
                seen.add(key)
                const current = find.get(owner_key, name_key) as {id: number} | undefined
                if (current) {
                    update.run(row.name, row.description, row.owner, row.visits, row.price, row.item_id, batch_id, now, current.id)
                    updated++
                } else {
                    insert.run(row.name, name_key, row.description, row.owner, owner_key, row.visits, row.price, row.item_id, batch_id, now, now)
                    inserted++
                }
            }
            const total = (this.database.prepare("SELECT COUNT(*) AS count FROM landmark").get() as {count: number}).count
            return {success: true as const, inserted, updated, total}
        })()
    }

    sync_landmarks(landmarks: Array<{name: string, description: string, owner: string, visits: number, price: string, item_id?: string}>) {
        if (!Array.isArray(landmarks) || landmarks.length === 0) return {success: false as const, message: "没有读取到有效地标"}
        const rows = landmarks.map(landmark => ({
            name: landmark.name?.trim(), description: landmark.description?.trim() || "None",
            owner: landmark.owner?.trim(), visits: Math.max(0, Math.floor(Number(landmark.visits) || 0)),
            price: landmark.price?.trim() || "None", item_id: landmark.item_id?.trim() || ""
        }))
        if (rows.some(row => !row.name || !row.owner || row.name.length > 128 || row.owner.length > 64 || row.description.length > 2000 || row.price.length > 128 || row.item_id.length > 256)) {
            return {success: false as const, message: "地标数据包含无效字段"}
        }
        const batch_id = crypto.randomUUID()
        const now = new Date().toISOString()
        const normalize = (value: string) => value.trim().toLocaleLowerCase()
        return this.database.transaction(() => {
            const existing = new Map((this.database.prepare("SELECT id, owner_key, name_key FROM landmark").all() as Array<{id: number, owner_key: string, name_key: string}>)
                .map(row => [`${row.owner_key}\u0000${row.name_key}`, row]))
            const seen = new Set<string>()
            const insert = this.database.prepare("INSERT INTO landmark (name, name_key, description, owner, owner_key, visits, price, item_id, batch_id, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            const update = this.database.prepare("UPDATE landmark SET name = ?, description = ?, owner = ?, visits = ?, price = ?, item_id = ?, batch_id = ?, updated_at = ? WHERE id = ?")
            let inserted = 0
            let updated = 0
            for (const row of rows) {
                const name_key = normalize(row.name!)
                const owner_key = normalize(row.owner!)
                const key = `${owner_key}\u0000${name_key}`
                if (seen.has(key)) continue
                seen.add(key)
                const current = existing.get(key)
                if (current) {
                    update.run(row.name, row.description, row.owner, row.visits, row.price, row.item_id, batch_id, now, current.id)
                    updated++
                } else {
                    insert.run(row.name, name_key, row.description, row.owner, owner_key, row.visits, row.price, row.item_id, batch_id, now, now)
                    inserted++
                }
            }
            const remove = this.database.prepare("DELETE FROM landmark WHERE batch_id <> ?").run(batch_id).changes
            return {success: true as const, batch_id, inserted, updated, deleted: remove, total: seen.size}
        })()
    }

    get_landmarks_page(page: number = 1, page_size: number = 10) {
        const safe_page = Number.isInteger(page) && page > 0 ? page : 1
        const safe_size = Number.isInteger(page_size) ? Math.min(Math.max(page_size, 1), 30) : 10
        const total = (this.database.prepare("SELECT COUNT(*) AS count FROM landmark").get() as {count: number}).count
        const rows = this.database.prepare("SELECT name, description, owner, visits, price, item_id, updated_at FROM landmark ORDER BY name_key ASC, owner_key ASC, id ASC LIMIT ? OFFSET ?")
            .all(safe_size, (safe_page - 1) * safe_size)
        return {page: safe_page, page_size: safe_size, total, rows}
    }

    /** 供 Web 地标档案使用的组合筛选、排序和分页查询。 */
    search_landmarks_page(page: number, limit: number, filters: {
        keyword?: string
        name?: string
        owner?: string
        item_id?: string
        min_visits?: number
        max_visits?: number
        updated_from?: string
        updated_to?: string
        sort_by?: "name" | "owner" | "visits" | "updated_at" | "first_seen_at"
        sort_order?: "asc" | "desc"
    }) {
        const conditions: string[] = []
        const parameters: Array<string | number> = []
        const addLike = (fields: string[], value?: string) => {
            const query = value?.trim()
            if (!query) return
            const escaped = query.replace(/[\\%_]/g, "\\$&")
            conditions.push(`(${fields.map(field => `${field} LIKE ? COLLATE NOCASE ESCAPE '\\'`).join(" OR ")})`)
            parameters.push(...fields.map(() => `%${escaped}%`))
        }

        addLike(["name", "description", "owner", "item_id", "price"], filters.keyword)
        addLike(["name"], filters.name)
        addLike(["owner"], filters.owner)
        addLike(["item_id"], filters.item_id)
        if (filters.min_visits !== undefined) {
            conditions.push("visits >= ?")
            parameters.push(filters.min_visits)
        }
        if (filters.max_visits !== undefined) {
            conditions.push("visits <= ?")
            parameters.push(filters.max_visits)
        }
        if (filters.updated_from) {
            conditions.push("updated_at >= ?")
            parameters.push(filters.updated_from)
        }
        if (filters.updated_to) {
            conditions.push("updated_at <= ?")
            parameters.push(filters.updated_to)
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
        const sortColumns = {
            name: "name_key",
            owner: "owner_key",
            visits: "visits",
            updated_at: "updated_at",
            first_seen_at: "first_seen_at",
        } as const
        const sortColumn = sortColumns[filters.sort_by || "visits"]
        const sortOrder = filters.sort_order === "asc" ? "ASC" : "DESC"
        const totalRow = this.database.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(visits), 0) AS visits FROM landmark ${where}`).get(...parameters) as {total: number, visits: number}
        const rows = this.database.prepare(`
            SELECT id, name, description, owner, visits, price, item_id, first_seen_at, updated_at
            FROM landmark
            ${where}
            ORDER BY ${sortColumn} ${sortOrder}, name_key ASC, owner_key ASC, id ASC
            LIMIT ? OFFSET ?
        `).all(...parameters, limit, (page - 1) * limit)
        return {landmarks: rows, total: totalRow.total, visits: totalRow.visits}
    }

    update_landmark(id: number, values: {name: string, owner: string, description: string, visits: number, price: string, item_id: string}) {
        const result = this.database.prepare(`
            UPDATE landmark SET name = ?, name_key = ?, owner = ?, owner_key = ?, description = ?, visits = ?, price = ?, item_id = ?, updated_at = ?
            WHERE id = ?
        `).run(values.name, values.name.trim().toLocaleLowerCase(), values.owner, values.owner.trim().toLocaleLowerCase(), values.description, values.visits, values.price, values.item_id, new Date().toISOString(), id)
        if (!result.changes) return {success: false as const, message: "没有找到该地标"}
        const landmark = this.database.prepare("SELECT id, name, description, owner, visits, price, item_id, first_seen_at, updated_at FROM landmark WHERE id = ?").get(id)
        return {success: true as const, landmark}
    }

    delete_landmark(id: number) {
        const result = this.database.prepare("DELETE FROM landmark WHERE id = ?").run(id)
        if (!result.changes) return {success: false as const, message: "没有找到该地标"}
        return {success: true as const, deleted: result.changes}
    }

    search_landmarks(keyword: string, limit: number = 20) {
        const query = keyword.trim()
        if (!query) return []
        const safe_limit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 30) : 20
        return this.database.prepare("SELECT name, description, owner, visits, price, item_id, updated_at FROM landmark WHERE name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE ORDER BY name_key ASC, owner_key ASC, id ASC LIMIT ?")
            .all(`%${query}%`, `%${query}%`, safe_limit)
    }

    get_landmarks_by_owner(owner: string, limit?: number) {
        const owner_key = owner.trim().toLocaleLowerCase()
        if (!owner_key) return []
        if (limit === undefined) {
            return this.database.prepare("SELECT name, description, owner, visits, price, item_id, updated_at FROM landmark WHERE owner_key = ? ORDER BY name_key ASC, id ASC")
                .all(owner_key)
        }
        const safe_limit = Number.isInteger(limit) ? Math.max(limit, 1) : 1
        return this.database.prepare("SELECT name, description, owner, visits, price, item_id, updated_at FROM landmark WHERE owner_key = ? ORDER BY name_key ASC, id ASC LIMIT ?")
            .all(owner_key, safe_limit)
    }

    get_landmarks_by_name(name: string, limit: number = 20) {
        const name_key = name.trim().toLocaleLowerCase()
        if (!name_key) return []
        const safe_limit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 30) : 20
        return this.database.prepare("SELECT name, description, owner, visits, price, item_id, updated_at FROM landmark WHERE name_key = ? ORDER BY owner_key ASC, id ASC LIMIT ?")
            .all(name_key, safe_limit)
    }

    get_landmark_stats() {
        return this.database.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT owner_key) AS owners, COALESCE(SUM(visits), 0) AS visits, MAX(updated_at) AS updated_at FROM landmark").get()
    }

    get_top_landmarks(limit: number = 10) {
        const safe_limit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 30) : 10
        return this.database.prepare("SELECT name, owner, visits, price FROM landmark ORDER BY visits DESC, name_key ASC, owner_key ASC LIMIT ?").all(safe_limit)
    }

    delete_shop_prices(shop_name: string) {
        const shop = shop_name.trim()
        if (!shop) return {success: false as const, message: "商店名称无效"}
        return this.database.transaction(() => {
            const priceResult = this.database.prepare("DELETE FROM shop_price WHERE LOWER(shop_name) = LOWER(?)").run(shop)
            if (!priceResult.changes) return {success: false as const, message: "没有找到该商店的价格记录"}
            this.database.prepare("DELETE FROM shop_list WHERE LOWER(shopname) = LOWER(?)").run(shop)
            return {success: true as const, deleted: priceResult.changes}
        })()
    }

    /** 从 shop_price 表同步数据到 shop_list 表，完整事务同步，删除已不存在的商店目录项。 */
    sync_shop_list_from_price() {
        return this.database.transaction(() => {
            const shops = this.database.prepare(`
                SELECT LOWER(shop_name) AS shop_key, shop_name, batch_id, create_at
                FROM shop_price
                WHERE id IN (SELECT MAX(id) FROM shop_price GROUP BY LOWER(shop_name))
            `).all() as Array<{shop_key: string, shop_name: string, batch_id: string, create_at: string}>
            const insert = this.database.prepare("INSERT INTO shop_list (shopname, create_at, new_batch_id) VALUES (?, ?, ?)")
            const update = this.database.prepare("UPDATE shop_list SET shopname = ?, create_at = ?, new_batch_id = ? WHERE id = ?")
            let inserted = 0, updated = 0
            for (const shop of shops) {
                const existing = this.database.prepare(
                    "SELECT id FROM shop_list WHERE LOWER(shopname) = LOWER(?)"
                ).get(shop.shop_name) as {id: number} | undefined
                if (existing) { updated++; update.run(shop.shop_name, shop.create_at, shop.batch_id, existing.id) }
                else { inserted++; insert.run(shop.shop_name, shop.create_at, shop.batch_id) }
            }
            const activeKeys = new Set(shops.map(s => s.shop_key))
            const allList = this.database.prepare("SELECT id, LOWER(shopname) AS key FROM shop_list").all() as Array<{id: number, key: string}>
            let deleted = 0
            for (const row of allList) {
                if (!activeKeys.has(row.key)) {
                    this.database.prepare("DELETE FROM shop_list WHERE id = ?").run(row.id)
                    deleted++
                }
            }
            const total = (this.database.prepare("SELECT COUNT(*) AS count FROM shop_list").get() as {count: number}).count
            return {success: true as const, inserted, updated, deleted, total}
        })()
    }

    /** 后台商店管理分页查询，支持筛选、排序。 */
    search_admin_shops(page: number, limit: number, filters: {
        shop_name?: string
        player?: string
        item_id?: string
        sell_type?: "sell" | "buy"
        updated_from?: string
        updated_to?: string
        sort_by?: "shop_name" | "updated_at" | "item_count" | "price_count"
        sort_order?: "asc" | "desc"
    }) {
        const conditions: string[] = []
        const parameters: Array<string | number> = []
        const addLike = (field: string, value?: string) => {
            const query = value?.trim()
            if (!query) return
            const escaped = query.replace(/[\\%_]/g, "\\$&")
            conditions.push(`${field} LIKE ? COLLATE NOCASE ESCAPE '\\'`)
            parameters.push(`%${escaped}%`)
        }
        addLike("sp.shop_name", filters.shop_name)
        addLike("sp.player", filters.player)
        addLike("sp.item_id", filters.item_id)
        if (filters.sell_type === "sell" || filters.sell_type === "buy") {
            conditions.push("sp.sell_type = ?")
            parameters.push(filters.sell_type)
        }
        if (filters.updated_from) {
            conditions.push("sp.create_at >= ?")
            parameters.push(filters.updated_from)
        }
        if (filters.updated_to) {
            conditions.push("sp.create_at <= ?")
            parameters.push(filters.updated_to)
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
        const sortColumns: Record<string, string> = {
            shop_name: "sl.shopname",
            updated_at: "latest_update",
            item_count: "item_count",
            price_count: "price_count",
        }
        const sortColumn = sortColumns[filters.sort_by || "shop_name"] || "sl.shopname"
        const sortOrder = filters.sort_order === "desc" ? "DESC" : "ASC"

        const totalRow = this.database.prepare(`
            SELECT COUNT(DISTINCT sl.shopname) AS total
            FROM shop_list sl
            LEFT JOIN shop_price sp ON LOWER(sp.shop_name) = LOWER(sl.shopname)
            ${where}
        `).get(...parameters) as {total: number}
        if (!totalRow.total) return {shops: [], total: 0, stats: {shops: 0, prices: 0, batches: 0, sell: 0, buy: 0, latest_update: null}}

        const stats = this.database.prepare(`
            SELECT
                COUNT(DISTINCT sl.shopname) AS shops,
                COUNT(sp.id) AS prices,
                COUNT(DISTINCT sp.batch_id) AS batches,
                SUM(CASE WHEN sp.sell_type = 'sell' THEN 1 ELSE 0 END) AS sell,
                SUM(CASE WHEN sp.sell_type = 'buy' THEN 1 ELSE 0 END) AS buy,
                MAX(sp.create_at) AS latest_update
            FROM shop_list sl
            LEFT JOIN shop_price sp ON LOWER(sp.shop_name) = LOWER(sl.shopname)
            ${where}
        `).get(...parameters) as {
            shops: number, prices: number, batches: number,
            sell: number | null, buy: number | null, latest_update: string | null
        }

        const rows = this.database.prepare(`
            SELECT
                sl.shopname AS shop_name,
                sl.new_batch_id,
                sl.create_at AS listed_at,
                MAX(sp.create_at) AS latest_update,
                COUNT(DISTINCT sp.id) AS price_count,
                COUNT(DISTINCT sp.batch_id) AS batch_count,
                COUNT(DISTINCT sp.item_id) AS item_count,
                COUNT(DISTINCT CASE WHEN sp.sell_type = 'sell' THEN sp.id END) AS sell_count,
                COUNT(DISTINCT CASE WHEN sp.sell_type = 'buy' THEN sp.id END) AS buy_count,
                GROUP_CONCAT(DISTINCT sp.player) AS players_raw
            FROM shop_list sl
            LEFT JOIN shop_price sp ON LOWER(sp.shop_name) = LOWER(sl.shopname)
            ${where}
            GROUP BY sl.shopname, sl.new_batch_id, sl.create_at
            ORDER BY ${sortColumn} ${sortOrder}, sl.shopname COLLATE NOCASE ASC
            LIMIT ? OFFSET ?
        `).all(...parameters, limit, (page - 1) * limit) as Array<{
            shop_name: string
            new_batch_id: string | null
            listed_at: string
            latest_update: string | null
            price_count: number
            batch_count: number
            item_count: number
            sell_count: number
            buy_count: number
            players_raw: string | null
        }>

        const shops = rows.map(row => {
            const players = row.players_raw
                ? [...new Set(row.players_raw.split(",").filter(Boolean))].slice(0, 20)
                : []
            return {
                shop_name: row.shop_name,
                new_batch_id: row.new_batch_id,
                listed_at: row.listed_at,
                latest_update: row.latest_update,
                price_count: row.price_count,
                batch_count: row.batch_count,
                item_count: row.item_count,
                sell_count: row.sell_count,
                buy_count: row.buy_count,
                players,
            }
        })

        return {
            shops,
            total: totalRow.total,
            stats: {...stats, sell: stats.sell || 0, buy: stats.buy || 0},
        }
    }

    /** 获取指定商店的批次历史。 */
    get_shop_batch_history(shop_name: string, page: number, limit: number) {
        const shop = shop_name.trim()
        if (!shop) return {batches: [], total: 0}
        const totalRow = this.database.prepare(
            "SELECT COUNT(DISTINCT batch_id) AS total FROM shop_price WHERE LOWER(shop_name) = LOWER(?)"
        ).get(shop) as {total: number}
        if (!totalRow.total) return {batches: [], total: 0}

        const batches = this.database.prepare(`
            SELECT batch_id, create_at,
                   COUNT(*) AS record_count,
                   COUNT(DISTINCT item_id) AS item_count,
                   SUM(CASE WHEN sell_type = 'sell' THEN 1 ELSE 0 END) AS sell_count,
                   SUM(CASE WHEN sell_type = 'buy' THEN 1 ELSE 0 END) AS buy_count,
                   GROUP_CONCAT(DISTINCT player) AS players_raw
            FROM shop_price
            WHERE LOWER(shop_name) = LOWER(?)
            GROUP BY batch_id, create_at
            ORDER BY create_at DESC
            LIMIT ? OFFSET ?
        `).all(shop, limit, (page - 1) * limit) as Array<{
            batch_id: string
            create_at: string
            record_count: number
            item_count: number
            sell_count: number
            buy_count: number
            players_raw: string | null
        }>

        return {
            total: totalRow.total,
            batches: batches.map(b => ({
                batch_id: b.batch_id,
                create_at: b.create_at,
                record_count: b.record_count,
                item_count: b.item_count,
                sell_count: b.sell_count,
                buy_count: b.buy_count,
                players: b.players_raw ? [...new Set(b.players_raw.split(",").filter(Boolean))].slice(0, 20) : [],
            })),
        }
    }

    /** 查询玩家完整信息，不存在则返回 null */
    get_user_info(username: string) {
        const row = this.database.prepare("SELECT * FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1").get(username) as typeof user_table.$inferSelect | undefined
        if (!row) return null

        const online_session = JSON.parse(row.online_session || "[]") as { start: string, end: string | null, duration: number | null }[]

        // 从 online_session 中提取最后一次加入和离开时间
        let last_join_time: string | null = null
        let last_leave_time: string | null = null
        if (online_session.length > 0) {
            const last_session = online_session[online_session.length - 1]
            last_join_time = last_session.start
            if (last_session.end) {
                last_leave_time = last_session.end
            } else {
                // 最后一个 session 未关闭，说明当前在线，往前找一个已关闭的
                for (let i = online_session.length - 2; i >= 0; i--) {
                    if (online_session[i].end) {
                        last_leave_time = online_session[i].end!
                        break
                    }
                }
            }
        }

        return {
            username: row.username as string,
            money: row.money as number,
            money_history: JSON.parse(row.money_history || "[]") as { money: unknown, timestamp: string }[],
            point: (row.point || 0) as number,
            address_list: JSON.parse(row.address_list || "[]") as string[],
            message_count: (row.message_count || 0) as number,
            online_time: (row.online_time || 0) as number,
            first_record_time: (row.first_record_time || row.create_time) as string,
            online_session,
            last_join_time,
            last_leave_time,
            role: (row.role || "member") as string,
            create_time: row.create_time as string,
        }
    }

    search_admin_users(page: number, limit: number, filters: {keyword?: string, role?: string, registered?: boolean}) {
        const conditions: string[] = []
        const parameters: Array<string | number> = []
        if (filters.keyword?.trim()) {
            const escaped = filters.keyword.trim().replace(/[\\%_]/g, "\\$&")
            conditions.push("username LIKE ? COLLATE NOCASE ESCAPE '\\'")
            parameters.push(`%${escaped}%`)
        }
        if (filters.role?.trim()) { conditions.push("role = ?"); parameters.push(filters.role.trim()) }
        if (filters.registered !== undefined) conditions.push(filters.registered ? "password IS NOT NULL AND password <> ''" : "password IS NULL OR password = ''")
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
        const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM user ${where}`).get(...parameters) as {total: number}).total
        const users = this.database.prepare(`
            SELECT username, role, point, message_count, online_time, first_record_time, create_time,
                CASE WHEN password IS NOT NULL AND password <> '' THEN 1 ELSE 0 END AS registered
            FROM user ${where} ORDER BY create_time DESC, username COLLATE NOCASE ASC LIMIT ? OFFSET ?
        `).all(...parameters, limit, (page - 1) * limit).map((row: any) => ({...row, point: (row.point || 0) / 100, registered: !!row.registered}))
        return {users, total}
    }

    create_admin_user(username: string, password: string) {
        const name = username.trim()
        if (!name || !password) return {success: false as const, message: "用户名和密码不能为空"}
        const existing = this.database.prepare("SELECT id FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1").get(name)
        if (existing) return {success: false as const, message: "用户已存在"}
        const now = new Date().toISOString()
        this.database.prepare("INSERT INTO user (username, password, role, create_time, first_record_time) VALUES (?, ?, 'member', ?, ?)").run(name, password, now, now)
        return {success: true as const}
    }

    delete_admin_user(username: string) {
        const result = this.database.prepare("DELETE FROM user WHERE LOWER(username) = LOWER(?)").run(username.trim())
        return result.changes ? {success: true as const, deleted: result.changes} : {success: false as const, message: "用户不存在"}
    }

    /** 按玩家名模糊查询已记录用户，返回稳定的分页结果。 */
    search_player_names(page: number, limit: number, like: string) {
        const escaped = like.replace(/[\\%_]/g, "\\$&")
        const pattern = `%${escaped}%`
        const offset = (page - 1) * limit
        const rows = this.database.prepare(
            "SELECT username FROM user WHERE username LIKE ? ESCAPE '\\' ORDER BY username COLLATE NOCASE ASC LIMIT ? OFFSET ?"
        ).all(pattern, limit, offset) as Array<{username: string}>
        const count = this.database.prepare(
            "SELECT COUNT(*) AS total FROM user WHERE username LIKE ? ESCAPE '\\'"
        ).get(pattern) as {total: number}

        return {names: rows.map(row => row.username), total: count.total}
    }

/** 验证网页登录凭据；密码不会离开 storage 层。 */
    verify_user_password(username: string, password: string): {username: string, role: string, registered: boolean} | null {
        const row = this.database.prepare(
            "SELECT username, password, role FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
        ).get(username.trim()) as {username: string, password: string | null, role: string | null} | undefined

        if (!row?.password) return null

        const expected = Buffer.from(row.password)
        const provided = Buffer.from(password)
        if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null

        return {username: row.username, role: row.role || "member", registered: true}
    }

    /** 检查用户是否已注册（已有密码）。 */
    is_user_registered(username: string): boolean {
        const row = this.database.prepare(
            "SELECT password FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1"
        ).get(username.trim()) as {password: string | null} | undefined
        return !!row?.password
    }

    /** 设置或更新用户密码。 */
    set_user_password(username: string, password: string): void {
        this.ensure_user_exists(username.trim())
        this.database.prepare("UPDATE user SET password = ? WHERE LOWER(username) = LOWER(?)")
            .run(password, username.trim())
    }

    /** 生成并替换用户 API key；数据库仅保存 SHA-256 摘要。 */
    create_api_key(username: string): string | null {
        const name = username.trim()
        if (!name) return null
        const key = `bx_${crypto.randomBytes(32).toString("base64url")}`
        const digest = crypto.createHash("sha256").update(key).digest("hex")
        const result = this.database.prepare("UPDATE user SET apikey = ? WHERE LOWER(username) = LOWER(?)")
            .run(digest, name)
        return result.changes ? key : null
    }

    has_api_key(username: string): boolean {
        const row = this.database.prepare("SELECT apikey FROM user WHERE LOWER(username) = LOWER(?) LIMIT 1")
            .get(username.trim()) as {apikey: string | null} | undefined
        return !!row?.apikey
    }

    /** 通过 API key 验证用户；密钥值不会离开 storage 层。 */
    verify_api_key(key: string): {username: string, role: string, registered: boolean} | null {
        if (!key || key.length > 256) return null
        const digest = crypto.createHash("sha256").update(key).digest("hex")
        const row = this.database.prepare("SELECT username, role, apikey FROM user WHERE apikey = ? LIMIT 1")
            .get(digest) as {username: string, role: string | null, apikey: string | null} | undefined
        if (!row?.apikey) return null
        const expected = Buffer.from(row.apikey)
        const provided = Buffer.from(digest)
        if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null
        return {username: row.username, role: row.role || "member", registered: true}
    }

    /** 查询玩家最近的公开聊天消息（默认3条） */
    get_recent_messages(username: string, limit: number = 3) {
        return this.orm.select({
            content: message_table.content,
            area: message_table.area,
            create_time: message_table.create_time,
        })
            .from(message_table)
            .where(and(
                eq(message_table.username, username),
                eq(message_table.message_type, "public"),
            ))
            .orderBy(desc(message_table.id))
            .limit(limit)
            .all() as { content: string, area: string, create_time: string }[]
    }

    get_public_chat_message_snapshot_id(username: string): number | null {
        const normalizedUsername = username.trim()
        if (!normalizedUsername) return null

        const snapshot = this.orm.select({
            id: message_table.id,
        }).from(message_table).where(and(
            eq(message_table.username, normalizedUsername),
            eq(message_table.message_type, "public"),
            eq(message_table.position, "chat"),
        )).orderBy(desc(message_table.id)).limit(1).get()

        return snapshot?.id ?? null
    }

    get_public_chat_message_page(
        username: string,
        cursor: PublicChatMessageCursor | null,
        snapshot_max_id: number,
        limit: number,
    ): PublicChatMessagePage {
        const normalizedUsername = username.trim()
        const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 1))
        const messages = normalizedUsername
            ? this.orm.select({
                id: message_table.id,
                username: message_table.username,
                content: message_table.content,
                create_time: message_table.create_time,
            }).from(message_table).where(and(
                eq(message_table.username, normalizedUsername),
                eq(message_table.message_type, "public"),
                eq(message_table.position, "chat"),
                lte(message_table.id, snapshot_max_id),
                cursor ? lt(message_table.id, cursor.id) : undefined,
            )).orderBy(desc(message_table.id)).limit(safeLimit).all()
            : []

        return {
            messages,
            next_cursor: messages.length === safeLimit
                ? {id: messages[messages.length - 1].id}
                : null,
        }
    }

    /** 分页查询公开聊天消息；所有筛选字段均按包含关系匹配。 */
    search_messages(page: number, limit: number, filters: {username?: string, create_time?: string, create_time_from?: string, create_time_to?: string, content?: string, sort_order?: "asc" | "desc"}) {
        return this.search_admin_messages(page, limit, {...filters, position: "chat", message_type: "public"})
    }

    /** 分页查询消息；管理员可按位置与消息类型筛选全部消息。 */
    search_admin_messages(page: number, limit: number, filters: {username?: string, create_time?: string, create_time_from?: string, create_time_to?: string, content?: string, position?: string, message_type?: string, include_private?: boolean, sort_order?: "asc" | "desc"}) {
        const conditions: string[] = []
        const parameters: Array<string | number> = []
        const searchableFields = ["username", "create_time", "content"] as const

        for (const field of searchableFields) {
            const value = filters[field]?.trim()
            if (!value) continue
            const escaped = value.replace(/[\\%_]/g, "\\$&")
            conditions.push(`${field} LIKE ? COLLATE NOCASE ESCAPE '\\'`)
            parameters.push(`%${escaped}%`)
        }
        if (filters.create_time_from) {
            conditions.push("create_time >= ?")
            parameters.push(filters.create_time_from)
        }
        if (filters.create_time_to) {
            conditions.push("create_time <= ?")
            parameters.push(filters.create_time_to)
        }
        if (filters.position?.trim()) {
            conditions.push("position = ?")
            parameters.push(filters.position.trim())
        }
        if (!filters.include_private) {
            conditions.push("message_type = ?")
            parameters.push("public")
        } else if (filters.message_type?.trim()) {
            conditions.push("message_type = ?")
            parameters.push(filters.message_type.trim())
        }

        const where = conditions.length ? conditions.join(" AND ") : "1 = 1"
        const totalRow = this.database.prepare(`SELECT COUNT(*) AS total FROM message WHERE ${where}`).get(...parameters) as {total: number}
        const sortOrder = filters.sort_order === "asc" ? "ASC" : "DESC"
        const rows = this.database.prepare(`
            SELECT id, username, content, address, area, message_type, position, create_time
            FROM message
            WHERE ${where}
            ORDER BY create_time ${sortOrder}, id ${sortOrder}
            LIMIT ? OFFSET ?
        `).all(...parameters, limit, (page - 1) * limit) as Array<{
            id: number
            username: string
            content: string
            address: string
            area: string
            message_type: string
            position: string
            create_time: string
        }>

        return {messages: rows, total: totalRow.total}
    }

    /** 返回包含目标消息的可分页筛选结果，按记录顺序排列。 */
    get_message_context(id: number, page: number | undefined, limit: number, filters: {username?: string, create_time?: string, create_time_from?: string, create_time_to?: string, content?: string, position?: string, message_type?: string, include_private?: boolean}) {
        const conditions: string[] = []
        const parameters: Array<string | number> = []
        const searchableFields = ["username", "create_time", "content"] as const

        for (const field of searchableFields) {
            const value = filters[field]?.trim()
            if (!value) continue
            const escaped = value.replace(/[\\%_]/g, "\\$&")
            conditions.push(`${field} LIKE ? COLLATE NOCASE ESCAPE '\\'`)
            parameters.push(`%${escaped}%`)
        }
        if (filters.create_time_from) {
            conditions.push("create_time >= ?")
            parameters.push(filters.create_time_from)
        }
        if (filters.create_time_to) {
            conditions.push("create_time <= ?")
            parameters.push(filters.create_time_to)
        }
        if (filters.position?.trim()) {
            conditions.push("position = ?")
            parameters.push(filters.position.trim())
        }
        if (!filters.include_private) {
            conditions.push("message_type = ?")
            parameters.push("public")
        } else if (filters.message_type?.trim()) {
            conditions.push("message_type = ?")
            parameters.push(filters.message_type.trim())
        }

        const where = conditions.length ? conditions.join(" AND ") : "1 = 1"
        const columns = "id, username, content, address, area, message_type, position, create_time"
        const center = this.database.prepare(`SELECT ${columns} FROM message WHERE (${where}) AND id = ?`).get(...parameters, id)
        if (!center) return null

        const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM message WHERE ${where}`).get(...parameters) as {total: number}).total
        const totalPages = Math.max(1, Math.ceil(total / limit))
        const centerIndex = (this.database.prepare(`SELECT COUNT(*) AS total FROM message WHERE (${where}) AND id <= ?`).get(...parameters, id) as {total: number}).total - 1
        const resolvedPage = Math.min(Math.max(page || Math.floor(centerIndex / limit) + 1, 1), totalPages)
        const messages = this.database.prepare(`SELECT ${columns} FROM message WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`)
            .all(...parameters, limit, (resolvedPage - 1) * limit)
        return {messages, total, page: resolvedPage, limit, total_pages: totalPages}
    }

    get_map_artwork_by_artwork_hash(artwork_hash: string) {
        return this.database.prepare("SELECT * FROM map_artwork WHERE artwork_hash = ?").get(artwork_hash) || null
    }

    get_existing_map_artwork_content_hashes(hashes: string[]) {
        const unique = [...new Set(hashes.filter(hash => /^[a-f0-9]{64}$/i.test(hash)))]
        const existing = new Set<string>()
        for (let index = 0; index < unique.length; index += 500) {
            const values = unique.slice(index, index + 500)
            const placeholders = values.map(() => "?").join(", ")
            for (const row of this.database.prepare(`SELECT content_hash FROM map_artwork WHERE content_hash IN (${placeholders})`).all(...values) as Array<{content_hash: string}>) existing.add(row.content_hash)
        }
        return existing
    }

    create_map_artworks(rows: Array<{
        dat_name: string, content_hash: string, artwork_hash: string | null, name: string, price: string, source_pw: string, author: string,
        creator_username: string, group_id: string, group_position_x: number, group_position_y: number, rotation: number, mirror?: number,
        map_id: number, frame_x: number, frame_y: number, frame_z: number, frame_facing?: string | null,
        icons_file: string, preview_file: string,
    }>) {
        const now = new Date().toISOString()
        const insert = this.database.prepare(`
            INSERT INTO map_artwork (
                dat_name, content_hash, artwork_hash, name, price, source_pw, author, creator_username, group_id,
                group_position_x, group_position_y, rotation, mirror, map_id, frame_x, frame_y, frame_z, frame_facing,
                icons_file, preview_file, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const transaction = this.database.transaction((values: typeof rows) => values.map(row => insert.run(
            row.dat_name, row.content_hash, row.artwork_hash, row.name, row.price, row.source_pw, row.author, row.creator_username,
            row.group_id, row.group_position_x, row.group_position_y, row.rotation, row.mirror ? 1 : 0, row.map_id, row.frame_x, row.frame_y,
            row.frame_z, row.frame_facing || null, row.icons_file, row.preview_file, now, now,
        ).lastInsertRowid))
        try {
            return {success: true as const, ids: transaction(rows).map(Number)}
        } catch (error) {
            return {success: false as const, message: error instanceof Error ? error.message : "地图画保存失败"}
        }
    }

    create_map_artwork_group(group: any, rows: any[]) {
        const now = new Date().toISOString()
        const groupInsert = this.database.prepare(`INSERT INTO map_artwork_group (
            group_id, name, price, source_pw, author, description, category, tags, creator_username,
            preview_file, artwork_hash, visibility, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        const tileInsert = this.database.prepare(`INSERT INTO map_artwork (
            dat_name, content_hash, artwork_hash, name, price, source_pw, author, creator_username, group_id,
            group_position_x, group_position_y, rotation, mirror, map_id, frame_x, frame_y, frame_z, frame_facing,
            icons_file, preview_file, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        const versionInsert = this.database.prepare("INSERT INTO map_artwork_version (group_id, revision, metadata, note, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?)")
        const transaction = this.database.transaction(() => {
            groupInsert.run(group.group_id, group.name, group.price, group.source_pw, group.author, group.description || "", group.category || "other", JSON.stringify(group.tags || []), group.creator_username, group.preview_file, group.artwork_hash, group.visibility || "public", group.status || "published", now, now)
            const ids = rows.map(row => tileInsert.run(row.dat_name, row.content_hash, row.artwork_hash, row.name, row.price, row.source_pw, row.author, row.creator_username, row.group_id, row.group_position_x, row.group_position_y, row.rotation, row.mirror ? 1 : 0, row.map_id, row.frame_x, row.frame_y, row.frame_z, row.frame_facing || null, row.icons_file, row.preview_file, now, now).lastInsertRowid)
            versionInsert.run(group.group_id, JSON.stringify({...group, tags: group.tags || []}), "创建作品", group.creator_username, now)
            return ids.map(Number)
        })
        try { return {success: true as const, ids: transaction()} } catch (error) { return {success: false as const, message: error instanceof Error ? error.message : "地图画保存失败"} }
    }

    get_random_public_map_artwork_group() {
        return this.database.prepare("SELECT * FROM map_artwork_group WHERE status = 'published' AND visibility = 'public' ORDER BY RANDOM() LIMIT 1").get() || null
    }

    get_public_map_artwork_groups_by_name(name: string) {
        return this.database.prepare("SELECT * FROM map_artwork_group WHERE status = 'published' AND visibility = 'public' AND name = ? COLLATE NOCASE ORDER BY updated_at DESC").all(name)
    }

    list_public_map_artwork_groups(page = 1, limit = 3) {
        const total = (this.database.prepare("SELECT COUNT(*) AS total FROM map_artwork_group WHERE status = 'published' AND visibility = 'public'").get() as {total: number}).total
        const groups = this.database.prepare("SELECT * FROM map_artwork_group WHERE status = 'published' AND visibility = 'public' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, (page - 1) * limit)
        return {groups, total}
    }

    search_public_map_artwork_group_names(field: "name" | "author", keyword: string, page = 1, limit = 10) {
        const escaped = `%${keyword.replace(/[\\%_]/g, "\\$&")}%`
        const where = "status = 'published' AND visibility = 'public' AND " + field + " LIKE ? COLLATE NOCASE ESCAPE '\\'"
        const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM map_artwork_group WHERE ${where}`).get(escaped) as {total: number}).total
        const groups = this.database.prepare(`SELECT name, author FROM map_artwork_group WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(escaped, limit, (page - 1) * limit)
        return {groups, total}
    }

    search_map_artwork_groups(page: number, limit: number, filters: any, username?: string, canManage = false) {
        const conditions: string[] = [], parameters: any[] = []
        if (!canManage) {
            conditions.push("(status = 'published' AND visibility = 'public') OR creator_username = ?")
            parameters.push(username || "")
        }
        for (const [column, raw] of Object.entries(filters)) {
            const value = typeof raw === "string" ? raw.trim() : ""
            if (!value) continue
            if (column === "scope") {
                if (value === "favorites") { conditions.push("EXISTS(SELECT 1 FROM map_artwork_favorite f WHERE f.group_id = map_artwork_group.group_id AND f.username = ?)"); parameters.push(username || "") }
                if (value === "added") { conditions.push("creator_username = ?"); parameters.push(username || "") }
                if (value === "created") { conditions.push("(',' || REPLACE(author, ' ', '') || ',') LIKE ? COLLATE NOCASE ESCAPE '\\'"); parameters.push(`%,${(username || "").replace(/[\\%_]/g, "\\$&")},%`) }
                continue
            }
            if (!["name", "author", "description", "tags", "source_pw", "category", "visibility", "status", "creator_username"].includes(column)) continue
            if (["visibility", "status", "category"].includes(column)) { conditions.push(`${column} = ?`); parameters.push(value); continue }
            conditions.push(`${column} LIKE ? COLLATE NOCASE ESCAPE '\\'`); parameters.push(`%${value.replace(/[\\%_]/g, "\\$&")}%`)
        }
        const where = conditions.length ? conditions.map(condition => `(${condition})`).join(" AND ") : "1 = 1"
        const order = filters.sort === "popular" ? "like_count DESC, view_count DESC, updated_at DESC" : filters.sort === "views" ? "view_count DESC, updated_at DESC" : "updated_at DESC"
        const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM map_artwork_group WHERE ${where}`).get(...parameters) as {total: number}).total
        const groups = this.database.prepare(`SELECT *, EXISTS(SELECT 1 FROM map_artwork_favorite f WHERE f.group_id = map_artwork_group.group_id AND f.username = ?) AS liked FROM map_artwork_group WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(username || "", ...parameters, limit, (page - 1) * limit)
        return {groups, total}
    }

    get_map_artwork_group_record(group_id: string, username?: string, canManage = false) {
        const group = this.database.prepare("SELECT *, EXISTS(SELECT 1 FROM map_artwork_favorite f WHERE f.group_id = map_artwork_group.group_id AND f.username = ?) AS liked FROM map_artwork_group WHERE group_id = ?").get(username || "", group_id) as any
        if (!group) return null
        const owner = username && group.creator_username.toLocaleLowerCase() === username.toLocaleLowerCase()
        const author = username && this.is_map_artwork_author(group.author, username)
        if (!canManage && !owner && !author && (group.status !== "published" || group.visibility !== "public")) return null
        group.tags = JSON.parse(group.tags || "[]")
        return group
    }

    private is_map_artwork_author(authors: string, username: string) {
        const normalized = username.trim().toLocaleLowerCase()
        return !!normalized && authors.split(",").some(author => author.trim().toLocaleLowerCase() === normalized)
    }

    private can_manage_map_artwork(group: any, username: string, canManage: boolean) {
        return canManage || group.creator_username.toLocaleLowerCase() === username.toLocaleLowerCase() || this.is_map_artwork_author(group.author || "", username)
    }

    update_map_artwork_group(group_id: string, updates: any, username: string, canManage = false, note = "更新作品信息") {
        const group = this.get_map_artwork_group_record(group_id, username, true) as any
        if (!group) return {success: false as const, message: "地图画不存在"}
        if (!this.can_manage_map_artwork(group, username, canManage)) return {success: false as const, message: "无权修改该地图画"}
        const fields = ["name", "price", "source_pw", "author", "description", "category", "visibility", "status"] as const
        const values: any[] = [], assignments: string[] = []
        for (const field of fields) if (updates[field] !== undefined) { assignments.push(`${field} = ?`); values.push(updates[field]) }
        if (updates.tags !== undefined) { assignments.push("tags = ?"); values.push(JSON.stringify(updates.tags)) }
        if (!assignments.length) return {success: true as const}
        const now = new Date().toISOString(); assignments.push("updated_at = ?"); values.push(now, group_id)
        const transaction = this.database.transaction(() => {
            this.database.prepare(`UPDATE map_artwork_group SET ${assignments.join(", ")} WHERE group_id = ?`).run(...values)
            const next = this.database.prepare("SELECT * FROM map_artwork_group WHERE group_id = ?").get(group_id) as any
            const revision = (this.database.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM map_artwork_version WHERE group_id = ?").get(group_id) as {revision: number}).revision
            this.database.prepare("INSERT INTO map_artwork_version (group_id, revision, metadata, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(group_id, revision, JSON.stringify({...next, tags: JSON.parse(next.tags || "[]")}), note, username, now)
            this.database.prepare("UPDATE map_artwork SET name = ?, price = ?, source_pw = ?, author = ?, updated_at = ? WHERE group_id = ?").run(next.name, next.price, next.source_pw, next.author, now, group_id)
        })
        try { transaction(); return {success: true as const} } catch (error) { return {success: false as const, message: error instanceof Error ? error.message : "更新失败"} }
    }

    update_map_artwork_layout(group_id: string, tiles: Array<{id: number, x: number, y: number, rotation: number, mirror: boolean}>, username: string, canManage = false) {
        const group = this.get_map_artwork_group_record(group_id, username, true) as any
        if (!group) return {success: false as const, message: "地图画不存在"}
        if (!this.can_manage_map_artwork(group, username, canManage)) return {success: false as const, message: "无权重新设计该地图画"}
        const current = this.get_map_artwork_group(group_id) as Array<{id: number}>
        if (tiles.length !== current.length || new Set(tiles.map(tile => tile.id)).size !== current.length || tiles.some(tile => !current.some(row => row.id === tile.id))) return {success: false as const, message: "图块布局不完整"}
        const now = new Date().toISOString()
        const transaction = this.database.transaction(() => {
            const update = this.database.prepare("UPDATE map_artwork SET group_position_x = ?, group_position_y = ?, rotation = ?, mirror = ?, updated_at = ? WHERE id = ? AND group_id = ?")
            // Move every tile out of the constrained grid before applying swaps.
            // Updating a swapped pair one at a time would otherwise violate the
            // unique (group_id, group_position_x, group_position_y) index.
            const park = this.database.prepare("UPDATE map_artwork SET group_position_x = ?, group_position_y = ? WHERE id = ? AND group_id = ?")
            for (const tile of tiles) park.run(1_000_000 + tile.id, 1_000_000, tile.id, group_id)
            for (const tile of tiles) update.run(tile.x, tile.y, tile.rotation, tile.mirror ? 1 : 0, now, tile.id, group_id)
            this.database.prepare("UPDATE map_artwork_group SET updated_at = ? WHERE group_id = ?").run(now, group_id)
            const next = this.database.prepare("SELECT * FROM map_artwork_group WHERE group_id = ?").get(group_id) as any
            const layout = this.get_map_artwork_group(group_id).map((tile: any) => ({id: tile.id, group_position_x: tile.group_position_x, group_position_y: tile.group_position_y, rotation: tile.rotation, mirror: tile.mirror}))
            const revision = (this.database.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM map_artwork_version WHERE group_id = ?").get(group_id) as {revision: number}).revision
            this.database.prepare("INSERT INTO map_artwork_version (group_id, revision, metadata, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(group_id, revision, JSON.stringify({...next, tags: JSON.parse(next.tags || "[]"), layout}), "重新设计图块排版", username, now)
        })
        try { transaction(); return {success: true as const} } catch (error) { return {success: false as const, message: error instanceof Error ? error.message : "图块排版保存失败"} }
    }

    delete_map_artwork_group(group_id: string, username: string, canManage = false) {
        const group = this.get_map_artwork_group_record(group_id, username, true) as any
        if (!group) return {success: false as const, message: "地图画不存在"}
        if (!this.can_manage_map_artwork(group, username, canManage)) return {success: false as const, message: "无权删除该地图画"}
        const tiles = this.get_map_artwork_group(group_id)
        const transaction = this.database.transaction(() => {
            this.database.prepare("DELETE FROM map_artwork_favorite WHERE group_id = ?").run(group_id)
            this.database.prepare("DELETE FROM map_artwork_version WHERE group_id = ?").run(group_id)
            this.database.prepare("DELETE FROM map_artwork_report WHERE group_id = ?").run(group_id)
            this.database.prepare("DELETE FROM map_artwork WHERE group_id = ?").run(group_id)
            this.database.prepare("DELETE FROM map_artwork_group WHERE group_id = ?").run(group_id)
        })
        try { transaction(); return {success: true as const, group, tiles} } catch (error) { return {success: false as const, message: error instanceof Error ? error.message : "删除失败"} }
    }

    toggle_map_artwork_favorite(group_id: string, username: string, enabled: boolean) {
        const now = new Date().toISOString()
        const transaction = this.database.transaction(() => {
            if (enabled) this.database.prepare("INSERT OR IGNORE INTO map_artwork_favorite (group_id, username, created_at) VALUES (?, ?, ?)").run(group_id, username, now)
            else this.database.prepare("DELETE FROM map_artwork_favorite WHERE group_id = ? AND username = ?").run(group_id, username)
            const like_count = (this.database.prepare("SELECT COUNT(*) AS count FROM map_artwork_favorite WHERE group_id = ?").get(group_id) as {count: number}).count
            this.database.prepare("UPDATE map_artwork_group SET like_count = ?, updated_at = ? WHERE group_id = ?").run(like_count, now, group_id)
            return like_count
        })
        return {success: true as const, like_count: transaction()}
    }

    increment_map_artwork_views(group_id: string) { this.database.prepare("UPDATE map_artwork_group SET view_count = view_count + 1 WHERE group_id = ?").run(group_id) }
    list_map_artwork_versions(group_id: string) { return this.database.prepare("SELECT id, revision, metadata, note, created_by, created_at FROM map_artwork_version WHERE group_id = ? ORDER BY revision DESC").all(group_id).map((item: any) => ({...item, metadata: JSON.parse(item.metadata)})) }
    restore_map_artwork_version(group_id: string, revision: number, username: string, canManage = false) {
        const group = this.get_map_artwork_group_record(group_id, username, true) as any
        if (!group) return {success: false as const, message: "地图画不存在"}
        if (!this.can_manage_map_artwork(group, username, canManage)) return {success: false as const, message: "无权恢复该地图画"}
        const version = this.database.prepare("SELECT metadata FROM map_artwork_version WHERE group_id = ? AND revision = ?").get(group_id, revision) as {metadata: string} | undefined
        if (!version) return {success: false as const, message: "历史版本不存在"}
        const metadata = JSON.parse(version.metadata) as any
        return this.update_map_artwork_group(group_id, {name: metadata.name, price: metadata.price, source_pw: metadata.source_pw, author: metadata.author, description: metadata.description || "", category: metadata.category || "other", tags: metadata.tags || [], visibility: metadata.visibility || "public", status: metadata.status || "published"}, username, canManage, `恢复至 r${revision}`)
    }
    create_map_artwork_report(group_id: string, username: string, reason: string) { this.database.prepare("INSERT INTO map_artwork_report (group_id, reporter_username, reason, created_at) VALUES (?, ?, ?, ?)").run(group_id, username, reason, new Date().toISOString()) }
    moderate_map_artwork_group(group_id: string, status: string, reason: string, username: string) {
        const group = this.get_map_artwork_group_record(group_id, username, true) as any
        if (!group) return {success: false as const, message: "地图画不存在"}
        const now = new Date().toISOString()
        const transaction = this.database.transaction(() => {
            this.database.prepare("UPDATE map_artwork_group SET status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = ?, updated_at = ? WHERE group_id = ?").run(status, reason, username, now, now, group_id)
            const next = this.database.prepare("SELECT * FROM map_artwork_group WHERE group_id = ?").get(group_id) as any
            const revision = (this.database.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM map_artwork_version WHERE group_id = ?").get(group_id) as {revision: number}).revision
            this.database.prepare("INSERT INTO map_artwork_version (group_id, revision, metadata, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(group_id, revision, JSON.stringify({...next, tags: JSON.parse(next.tags || "[]")}), `审核：${reason || status}`, username, now)
        })
        try { transaction(); return {success: true as const} } catch (error) { return {success: false as const, message: error instanceof Error ? error.message : "审核失败"} }
    }

    search_admin_map_artwork_groups(page: number, limit: number, filters: {
        keyword?: string, status?: string, visibility?: string, category?: string,
        reported?: boolean, sort?: "updated" | "created" | "reports" | "views" | "likes"
    }) {
        const conditions: string[] = []
        const parameters: Array<string | number> = []
        const keyword = filters.keyword?.trim()
        if (keyword) {
            const escaped = `%${keyword.replace(/[\\%_]/g, "\\$&")}%`
            conditions.push("(g.name LIKE ? COLLATE NOCASE ESCAPE '\\' OR g.author LIKE ? COLLATE NOCASE ESCAPE '\\' OR g.creator_username LIKE ? COLLATE NOCASE ESCAPE '\\' OR g.source_pw LIKE ? COLLATE NOCASE ESCAPE '\\' OR g.group_id LIKE ? COLLATE NOCASE ESCAPE '\\')")
            parameters.push(escaped, escaped, escaped, escaped, escaped)
        }
        if (filters.status) { conditions.push("g.status = ?"); parameters.push(filters.status) }
        if (filters.visibility) { conditions.push("g.visibility = ?"); parameters.push(filters.visibility) }
        if (filters.category) { conditions.push("g.category = ?"); parameters.push(filters.category) }
        if (filters.reported) conditions.push("EXISTS(SELECT 1 FROM map_artwork_report r WHERE r.group_id = g.group_id AND r.resolved_at IS NULL)")
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
        const order = filters.sort === "created" ? "g.created_at DESC" : filters.sort === "reports" ? "open_reports DESC, g.updated_at DESC" : filters.sort === "views" ? "g.view_count DESC, g.updated_at DESC" : filters.sort === "likes" ? "g.like_count DESC, g.updated_at DESC" : "g.updated_at DESC"
        const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM map_artwork_group g ${where}`).get(...parameters) as {total: number}).total
        const groups = this.database.prepare(`
            SELECT g.*,
                (SELECT COUNT(*) FROM map_artwork a WHERE a.group_id = g.group_id) AS tile_count,
                (SELECT COUNT(*) FROM map_artwork_report r WHERE r.group_id = g.group_id AND r.resolved_at IS NULL) AS open_reports
            FROM map_artwork_group g ${where}
            ORDER BY ${order}, g.group_id ASC LIMIT ? OFFSET ?
        `).all(...parameters, limit, (page - 1) * limit).map((group: any) => ({...group, tags: JSON.parse(group.tags || "[]")}))
        const statusRows = this.database.prepare("SELECT status, COUNT(*) AS count FROM map_artwork_group GROUP BY status").all() as Array<{status: string, count: number}>
        const summary = {
            total: (this.database.prepare("SELECT COUNT(*) AS count FROM map_artwork_group").get() as {count: number}).count,
            tiles: (this.database.prepare("SELECT COUNT(*) AS count FROM map_artwork").get() as {count: number}).count,
            open_reports: (this.database.prepare("SELECT COUNT(*) AS count FROM map_artwork_report WHERE resolved_at IS NULL").get() as {count: number}).count,
            views: (this.database.prepare("SELECT COALESCE(SUM(view_count), 0) AS count FROM map_artwork_group").get() as {count: number}).count,
            likes: (this.database.prepare("SELECT COALESCE(SUM(like_count), 0) AS count FROM map_artwork_group").get() as {count: number}).count,
            statuses: Object.fromEntries(statusRows.map(row => [row.status, row.count])),
        }
        return {groups, total, summary}
    }

    get_admin_map_artwork_group(group_id: string) {
        const group = this.database.prepare(`
            SELECT g.*,
                (SELECT COUNT(*) FROM map_artwork a WHERE a.group_id = g.group_id) AS tile_count,
                (SELECT COUNT(*) FROM map_artwork_report r WHERE r.group_id = g.group_id AND r.resolved_at IS NULL) AS open_reports
            FROM map_artwork_group g WHERE g.group_id = ?
        `).get(group_id) as any
        if (!group) return null
        group.tags = JSON.parse(group.tags || "[]")
        const reports = this.database.prepare("SELECT id, reporter_username, reason, created_at, resolved_at, resolved_by FROM map_artwork_report WHERE group_id = ? ORDER BY resolved_at IS NULL DESC, created_at DESC, id DESC").all(group_id)
        return {group, tiles: this.get_map_artwork_group(group_id), versions: this.list_map_artwork_versions(group_id), reports}
    }

    resolve_map_artwork_report(report_id: number, username: string, resolved: boolean) {
        const result = this.database.prepare("UPDATE map_artwork_report SET resolved_at = ?, resolved_by = ? WHERE id = ?")
            .run(resolved ? new Date().toISOString() : null, resolved ? username : null, report_id)
        return result.changes ? {success: true as const} : {success: false as const, message: "举报不存在"}
    }

    search_map_artworks(page: number, limit: number, filters: {keyword?: string, author?: string, source_pw?: string, group_id?: string}) {
        const conditions: string[] = []
        const parameters: string[] = []
        for (const [column, value] of Object.entries(filters)) {
            const text = value?.trim()
            if (!text) continue
            if (column === "group_id") {
                conditions.push("group_id = ?")
                parameters.push(text)
            } else {
                const target = column === "keyword" ? "name" : column
                conditions.push(`${target} LIKE ? COLLATE NOCASE ESCAPE '\\'`)
                parameters.push(`%${text.replace(/[\\%_]/g, "\\$&")}%`)
            }
        }
        const where = conditions.length ? conditions.join(" AND ") : "1 = 1"
        const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM map_artwork WHERE ${where}`).get(...parameters) as {total: number}).total
        const artworks = this.database.prepare(`SELECT * FROM map_artwork WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
            .all(...parameters, limit, (page - 1) * limit)
        return {artworks, total}
    }

    get_map_artwork(id: number) {
        return this.database.prepare("SELECT * FROM map_artwork WHERE id = ?").get(id) || null
    }

    get_map_artwork_group(group_id: string) {
        return this.database.prepare("SELECT * FROM map_artwork WHERE group_id = ? ORDER BY group_position_y ASC, group_position_x ASC, id ASC").all(group_id)
    }

    update_map_artwork_name(id: number, name: string, username: string, can_manage = false) {
        const artwork = this.get_map_artwork(id) as {creator_username: string} | null
        if (!artwork) return {success: false as const, message: "地图画不存在"}
        if (!can_manage && artwork.creator_username.toLocaleLowerCase() !== username.toLocaleLowerCase()) return {success: false as const, message: "无权修改该地图画"}
        this.database.prepare("UPDATE map_artwork SET name = ?, updated_at = ? WHERE id = ?").run(name, new Date().toISOString(), id)
        return {success: true as const}
    }
}
