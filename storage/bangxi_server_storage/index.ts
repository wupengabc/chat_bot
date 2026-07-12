import {path_utils} from "../../utils/path_utils.js";
import path from "node:path";
import fs from "fs";
import Database from "better-sqlite3";
import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {eq, sql, SQLWrapper} from "drizzle-orm";
import {orm_utils} from "../../utils/orm_utils.js";
import {drizzle} from "drizzle-orm/better-sqlite3";

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
    first_record_time: text("first_record_time").default(new Date().toISOString()),
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

    /** 关闭玩家会话：计算时长，更新 online_time 和 online_session */
    private close_session(username: string, start_time: number, end_time: number) {
        const duration = Math.floor((end_time - start_time) / 1000)
        const session = {
            start: new Date(start_time).toISOString(),
            end: new Date(end_time).toISOString(),
            duration,
        }

        const row = this.orm.select({
            id: user_table.id,
            online_time: user_table.online_time,
            online_session: user_table.online_session,
        })
            .from(user_table)
            .where(eq(user_table.username, username))
            .get() as { id: number; online_time: number; online_session: string } | undefined

        if (!row) {
            this.orm.insert(user_table).values({
                username,
                online_time: duration,
                online_session: JSON.stringify([session]),
                create_time: new Date().toISOString(),
            }).run()
            return
        }

        const online_time = row.online_time || 0
        const online_session_list = JSON.parse(row.online_session || "[]") as any[]
        online_session_list.push(session)

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
                    const start = session_start[username]
                    if (start) {
                        this.close_session(username, start, seen)
                    }
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
                    const start = session_start[username]
                    if (start) {
                        this.close_session(username, start, now)
                        delete session_start[username]
                    }
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
                session_start[username] = now
                last_seen[username] = now
                this.ensure_user_exists(username)
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
                    const add_point = Math.round(point_transfer_msg.point * 100)
                    this.orm.update(user_table)
                        .set({point: sql`${user_table.point} + ${add_point}`})
                        .where(eq(user_table.username, point_transfer_msg.username))
                        .run()
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
}