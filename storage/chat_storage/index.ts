import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {and, asc, desc, eq, lt, lte, or} from "drizzle-orm";
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
    channel_id: text("channel_id").notNull().default(""),
    role: text("role").notNull(),
    content: text("content").notNull(),
    create_time: text("create_time").notNull(),
});

const ai_profile_snapshot_table = sqliteTable("ai_profile_snapshot", {
    plugin_name: text("plugin_name").notNull(),
    config_name: text("config_name").notNull(),
    sender_id: text("sender_id").notNull(),
    profile_content: text("profile_content").notNull(),
    personality_traits: text("personality_traits").notNull().default(""),
    create_time: text("create_time").notNull(),
    update_time: text("update_time").notNull(),
});

const MAX_AI_PROFILE_CONTENT_LENGTH = 12000;

export type ChatRole = "user" | "assistant";

export interface ChatSessionKey {
    plugin_name: string;
    config_name: string;
    sender_id: string;
    channel_id: string;
}

export interface StoredChatMessage {
    role: ChatRole;
    content: string;
    create_time: string;
}

export interface ChatMessageCursor {
    readonly id: number;
}

export interface ChatMessagePageMessage {
    readonly id: number;
    readonly role: ChatRole;
    readonly content: string;
    readonly create_time: string;
}

export interface ChatMessagePage {
    readonly messages: readonly ChatMessagePageMessage[];
    readonly next_cursor: ChatMessageCursor | null;
}

export interface StoredAiProfileSnapshot {
    readonly plugin_name: string;
    readonly config_name: string;
    readonly sender_id: string;
    readonly profile_content: string;
    readonly personality_traits: string;
    readonly create_time: string;
    readonly update_time: string;
}

export interface AiProfileSnapshotInput {
    readonly profile_content: string;
    readonly personality_traits?: string;
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
        this.database.exec(`CREATE TABLE IF NOT EXISTS ai_profile_snapshot (
    "plugin_name" TEXT NOT NULL,
    "config_name" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "profile_content" TEXT NOT NULL,
    "personality_traits" TEXT NOT NULL DEFAULT '',
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    PRIMARY KEY ("plugin_name", "config_name", "sender_id")
);`);
        const profileColumns = this.database.prepare("PRAGMA table_info(ai_profile_snapshot)").all() as Array<{name?: string}>;
        if (!profileColumns.some(column => column.name === "personality_traits")) {
            this.database.exec("ALTER TABLE ai_profile_snapshot ADD COLUMN personality_traits TEXT NOT NULL DEFAULT ''");
        }
        if (profileColumns.some(column => column.name === "bound_game_id")) {
            this.database.exec("DROP INDEX IF EXISTS ai_profile_snapshot_game_update_idx");
            this.database.exec("ALTER TABLE ai_profile_snapshot DROP COLUMN bound_game_id");
        }
        const chatMessageColumns = this.database.prepare("PRAGMA table_info(chat_message)").all() as Array<{name?: string}>;
        if (!chatMessageColumns.some(column => column.name === "channel_id")) {
            this.database.exec("ALTER TABLE chat_message ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''");
        }
        this.database.exec("CREATE INDEX IF NOT EXISTS chat_message_session_idx ON chat_message (plugin_name, config_name, sender_id, channel_id, id)");
        storage_logger("chat_storage", "数据库初始化成功", "info");
    }

    append_message(key: ChatSessionKey, role: ChatRole, content: string): void {
        const safeContent = content.trim();
        if (!safeContent) return;

        this.orm.insert(chat_message_table).values({
            plugin_name: key.plugin_name,
            config_name: key.config_name,
            sender_id: key.sender_id,
            channel_id: key.channel_id,
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
            create_time: chat_message_table.create_time,
        }).from(chat_message_table).where(and(
            eq(chat_message_table.plugin_name, key.plugin_name),
            eq(chat_message_table.config_name, key.config_name),
            eq(chat_message_table.sender_id, key.sender_id),
            eq(chat_message_table.channel_id, key.channel_id),
        )).orderBy(asc(chat_message_table.id)).all();

        return messages.slice(-safeLimit).flatMap((message): StoredChatMessage[] =>
                message.role === "user" || message.role === "assistant"
                    ? [{role: message.role, content: message.content, create_time: message.create_time}]
                : []
        );
    }

    get_chat_message_snapshot_id(key: ChatSessionKey): number | null {
        const snapshot = this.orm.select({
            id: chat_message_table.id,
        }).from(chat_message_table).where(and(
            eq(chat_message_table.plugin_name, key.plugin_name),
            eq(chat_message_table.config_name, key.config_name),
            eq(chat_message_table.sender_id, key.sender_id),
            eq(chat_message_table.channel_id, key.channel_id),
        )).orderBy(desc(chat_message_table.id)).limit(1).get();

        return snapshot?.id ?? null;
    }

    get_chat_message_page(
        key: ChatSessionKey,
        cursor: ChatMessageCursor | null,
        snapshot_max_id: number,
        limit: number,
    ): ChatMessagePage {
        const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 1));
        const messages = this.orm.select({
            id: chat_message_table.id,
            role: chat_message_table.role,
            content: chat_message_table.content,
            create_time: chat_message_table.create_time,
        }).from(chat_message_table).where(and(
            eq(chat_message_table.plugin_name, key.plugin_name),
            eq(chat_message_table.config_name, key.config_name),
            eq(chat_message_table.sender_id, key.sender_id),
            eq(chat_message_table.channel_id, key.channel_id),
            lte(chat_message_table.id, snapshot_max_id),
            cursor ? lt(chat_message_table.id, cursor.id) : undefined,
            or(
                eq(chat_message_table.role, "user"),
                eq(chat_message_table.role, "assistant"),
            ),
        )).orderBy(desc(chat_message_table.id)).limit(safeLimit).all().flatMap(
            (message): ChatMessagePageMessage[] =>
                message.role === "user" || message.role === "assistant"
                    ? [{
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        create_time: message.create_time,
                    }]
                    : []
        );

        return {
            messages,
            next_cursor: messages.length === safeLimit
                ? {id: messages[messages.length - 1].id}
                : null,
        };
    }

    get_ai_profile_snapshot(key: ChatSessionKey): StoredAiProfileSnapshot | null {
        const snapshot = this.orm.select({
            plugin_name: ai_profile_snapshot_table.plugin_name,
            config_name: ai_profile_snapshot_table.config_name,
            sender_id: ai_profile_snapshot_table.sender_id,
            profile_content: ai_profile_snapshot_table.profile_content,
            personality_traits: ai_profile_snapshot_table.personality_traits,
            create_time: ai_profile_snapshot_table.create_time,
            update_time: ai_profile_snapshot_table.update_time,
        }).from(ai_profile_snapshot_table).where(and(
            eq(ai_profile_snapshot_table.plugin_name, key.plugin_name),
            eq(ai_profile_snapshot_table.config_name, key.config_name),
            eq(ai_profile_snapshot_table.sender_id, key.sender_id),
        )).get();

        return snapshot ?? null;
    }

    upsert_ai_profile_snapshot(key: ChatSessionKey, input: AiProfileSnapshotInput): void {
        const now = new Date().toISOString();
        const profile_content = input.profile_content.trim().slice(0, MAX_AI_PROFILE_CONTENT_LENGTH);
        const personality_traits = (input.personality_traits || "").trim().slice(0, MAX_AI_PROFILE_CONTENT_LENGTH);

        this.orm.insert(ai_profile_snapshot_table).values({
            plugin_name: key.plugin_name,
            config_name: key.config_name,
            sender_id: key.sender_id,
            profile_content,
            personality_traits,
            create_time: now,
            update_time: now,
        }).onConflictDoUpdate({
            target: [
                ai_profile_snapshot_table.plugin_name,
                ai_profile_snapshot_table.config_name,
                ai_profile_snapshot_table.sender_id,
            ],
            set: {
                profile_content,
                personality_traits,
                update_time: now,
            },
        }).run();
    }

    remove_ai_profile_snapshot(key: ChatSessionKey): void {
        this.orm.delete(ai_profile_snapshot_table).where(and(
            eq(ai_profile_snapshot_table.plugin_name, key.plugin_name),
            eq(ai_profile_snapshot_table.config_name, key.config_name),
            eq(ai_profile_snapshot_table.sender_id, key.sender_id),
        )).run();
    }

    event_handler(): void {}

    on_unload(): void {
        this.database.close();
    }
}
