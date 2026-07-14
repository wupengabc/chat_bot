import {path_utils} from "../../utils/path_utils.js";
import path from "node:path";
import fs from "fs";
import Database from "better-sqlite3";
import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {eq, and, sql, desc, SQLWrapper} from "drizzle-orm";
import {orm_utils} from "../../utils/orm_utils.js";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {storage_logger} from "../index.js";

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
    const match = text.match(/你从(.+?)账户收到转账金额:\s*([\d.]+)\s*金币/)

    if (!match) return null

    return {
        username: match[1],
        point: Number(match[2])
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
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_point_log_game_id ON point_log(game_id)")
        this.database.exec("CREATE INDEX IF NOT EXISTS idx_point_log_sign_lookup ON point_log(game_id, ext, create_at)")
        this.restore_player_list()
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
                username: data.player_name,
                area: chat_info.area,
                address: chat_info.address,
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
                        content: private_msg.content,
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

    /** 原子修改积分并记录流水；所有修改必须提供理由，删除积分时不允许余额变为负数。 */
    change_point(game_id: string, action: "add" | "remove", point: number, reason: string, ext: string | null = null) {
        const normalized_reason = typeof reason === "string" ? reason.trim() : ""
        if (action !== "add" && action !== "remove") {
            return {success: false as const, message: "积分操作类型无效"}
        }
        if (!normalized_reason) {
            return {success: false as const, message: "积分修改必须提供 reason"}
        }
        if (normalized_reason.length > 200) {
            return {success: false as const, message: "reason 最多 200 个字符"}
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

    /** 查询玩家完整信息，不存在则返回 null */
    get_user_info(username: string) {
        const row = this.orm.select()
            .from(user_table)
            .where(eq(user_table.username, username))
            .get()
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
}