import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {and, asc, eq} from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {path_utils} from "../../utils/path_utils.js";
import {orm_utils} from "../../utils/orm_utils.js";
import {storage_logger} from "../index.js";

const chat_message_table = sqliteTable("chat_message", {
    id: integer().primaryKey({autoIncrement: true}),
    plugin_name: text("plugin_name").notNull(),
    config_name: text("config_name").notNull(),
    sender_id: text("sender_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    create_time: text("create_time").notNull(),
});

export type ChatRole = "user" | "assistant";

export interface ChatSessionKey {
    plugin_name: string;
    config_name: string;
    sender_id: string;
}

export interface StoredChatMessage {
    role: ChatRole;
    content: string;
}

export class init {
    private readonly database_path = path.join(
        path_utils.get_project_root_path(),
        "storage/chat_storage/data/chat_storage.db"
    );
    private database: Database.Database;
    private orm: ReturnType<typeof drizzle>;

    constructor() {
        const dir = path.dirname(this.database_path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
        if (!fs.existsSync(this.database_path)) fs.writeFileSync(this.database_path, "");

        this.database = new Database(this.database_path);
        this.orm = drizzle(this.database);
        this.database.exec(orm_utils.convert_table_to_sqlite_sql(chat_message_table));
        this.database.exec("CREATE INDEX IF NOT EXISTS chat_message_session_idx ON chat_message (plugin_name, config_name, sender_id, id)");
        storage_logger("chat_storage", "数据库初始化成功", "info");
    }

    append_message(key: ChatSessionKey, role: ChatRole, content: string): void {
        const safeContent = content.trim();
        if (!safeContent) return;

        this.orm.insert(chat_message_table).values({
            plugin_name: key.plugin_name,
            config_name: key.config_name,
            sender_id: key.sender_id,
            role,
            content: safeContent,
            create_time: new Date().toISOString(),
        }).run();
    }

    get_recent_messages(key: ChatSessionKey, limit: number): StoredChatMessage[] {
        const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 12));
        const messages = this.orm.select({
            role: chat_message_table.role,
            content: chat_message_table.content,
        }).from(chat_message_table).where(and(
            eq(chat_message_table.plugin_name, key.plugin_name),
            eq(chat_message_table.config_name, key.config_name),
            eq(chat_message_table.sender_id, key.sender_id),
        )).orderBy(asc(chat_message_table.id)).all();

        return messages.slice(-safeLimit).flatMap((message): StoredChatMessage[] =>
            message.role === "user" || message.role === "assistant"
                ? [{role: message.role, content: message.content}]
                : []
        );
    }

    event_handler(): void {}

    on_unload(): void {
        this.database.close();
    }
}
