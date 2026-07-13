import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import path from "node:path";
import {path_utils} from "../../utils/path_utils.js";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {orm_utils} from "../../utils/orm_utils.js";
import {eq} from "drizzle-orm";
import fs from "fs";
import {storage_logger} from "../index.js";

const user_table = sqliteTable("user",{
    id: integer().primaryKey({autoIncrement: true}),
    user_id: text("user_id").notNull().unique(),
    game_id: text("game_id").default(""),
    create_time: text("create_time").notNull(),
    update_time: text("update_time")
})

export class init {
    private database_path = path.join(path_utils.get_project_root_path(), "/storage/chat_permission_storage/data", "chat_permission_storage.db")
    private database: any
    private orm: any

    constructor() {
        this.init_database()
    }

    private init_database() {
        const dir = path.dirname(this.database_path)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true})
        }
        if (!fs.existsSync(this.database_path)) {
            fs.writeFileSync(this.database_path, "")
        }
        this.database = new Database(this.database_path)
        this.orm = drizzle(this.database)
        const init_user_table_sql = orm_utils.convert_table_to_sqlite_sql(user_table)
        this.database.exec(init_user_table_sql)
        storage_logger("chat_permission_storage", "数据库初始化成功", "info")
    }

    /** 确保用户记录存在 */
    private ensure_user_exists(user_id: string): void {
        const user = this.orm.select({id: user_table.id})
            .from(user_table)
            .where(eq(user_table.user_id, user_id))
            .get()
        
        if (!user) {
            this.orm.insert(user_table).values({
                user_id,
                game_id: "",
                create_time: new Date().toISOString()
            }).run()
            storage_logger("chat_permission_storage", `创建新用户记录: ${user_id}`, "info")
        }
    }

    /** 获取用户信息 */
    get_user_info(user_id: string) {
        this.ensure_user_exists(user_id)
        return this.orm.select()
            .from(user_table)
            .where(eq(user_table.user_id, user_id))
            .get()
    }

    /** 绑定游戏账户 */
    bind_game_id(user_id: string, game_id: string) {
        try {
            this.ensure_user_exists(user_id)
            
            // 检查用户是否已绑定
            const user_info = this.orm.select()
                .from(user_table)
                .where(eq(user_table.user_id, user_id))
                .get()
            
            if (user_info?.game_id && user_info.game_id !== "") {
                storage_logger("chat_permission_storage", `用户 ${user_id} 尝试重复绑定`, "warn")
                return {
                    success: false,
                    message: `您已绑定游戏账户: ${user_info.game_id}`
                }
            }
            
            // 检查游戏ID是否已被其他用户绑定
            const existing_bind = this.orm.select()
                .from(user_table)
                .where(eq(user_table.game_id, game_id))
                .get()
            
            if (existing_bind && existing_bind.user_id !== user_id) {
                storage_logger("chat_permission_storage", `游戏账户 ${game_id} 已被其他用户绑定`, "warn")
                return {
                    success: false,
                    message: "该游戏账户已被其他用户绑定"
                }
            }
            
            // 执行绑定
            this.orm.update(user_table)
                .set({
                    game_id,
                    update_time: new Date().toISOString()
                })
                .where(eq(user_table.user_id, user_id))
                .run()
            
            storage_logger("chat_permission_storage", `用户 ${user_id} 成功绑定游戏账户 ${game_id}`, "info")
            return {
                success: true,
                message: "绑定成功"
            }
        } catch (e: any) {
            storage_logger("chat_permission_storage", `绑定失败: ${e.message}`, "error")
            return {
                success: false,
                message: `绑定失败: ${e.message || e}`
            }
        }
    }

    /** 解绑游戏账户 */
    unbind_game_id(user_id: string) {
        try {
            const user_info = this.orm.select()
                .from(user_table)
                .where(eq(user_table.user_id, user_id))
                .get()
            
            if (!user_info || !user_info.game_id || user_info.game_id === "") {
                return {
                    success: false,
                    message: "您还未绑定游戏账户"
                }
            }
            
            const old_game_id = user_info.game_id
            
            this.orm.update(user_table)
                .set({
                    game_id: "",
                    update_time: new Date().toISOString()
                })
                .where(eq(user_table.user_id, user_id))
                .run()
            
            storage_logger("chat_permission_storage", `用户 ${user_id} 解绑游戏账户 ${old_game_id}`, "info")
            return {
                success: true,
                message: "解绑成功",
                old_game_id
            }
        } catch (e: any) {
            storage_logger("chat_permission_storage", `解绑失败: ${e.message}`, "error")
            return {
                success: false,
                message: `解绑失败: ${e.message || e}`
            }
        }
    }

    /** 根据游戏ID查询用户ID */
    get_user_id_by_game_id(game_id: string): string | null {
        const user = this.orm.select()
            .from(user_table)
            .where(eq(user_table.game_id, game_id))
            .get()
        
        return user?.user_id || null
    }

    /** 检查游戏ID是否已绑定 */
    is_game_id_bound(game_id: string): boolean {
        const user = this.orm.select({id: user_table.id})
            .from(user_table)
            .where(eq(user_table.game_id, game_id))
            .get()
        
        return !!user
    }

    event_handler(_event: string, _data: any) {
        // 暂无事件处理逻辑
    }
}