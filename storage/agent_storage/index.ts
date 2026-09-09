import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {path_utils} from "../../utils/path_utils.js";
import {storage_logger} from "../index.js";

export type AgentMessageRole = "user" | "assistant" | "tool";

export interface AgentConversation {
    id: number;
    owner_username: string;
    title: string;
    visibility: "private" | "public";
    public_slug: string | null;
    anonymous: boolean;
    view_count: number;
    created_at: string;
    updated_at: string;
    message_count?: number;
    last_message?: string | null;
    workflow_status?: "draft" | "running" | "waiting_for_input" | "completed" | "error";
}

export interface AgentMessage {
    id: number;
    conversation_id: number;
    role: AgentMessageRole;
    content: string;
    metadata: Record<string, unknown>;
    created_at: string;
}

type ConversationRow = Omit<AgentConversation, "anonymous"> & {
    anonymous: number;
    allow_fork: number;
    published_until_message_id: number | null;
    last_metadata_json?: string | null;
    last_role?: AgentMessageRole | null;
};
type MessageRow = Omit<AgentMessage, "metadata"> & {metadata_json: string};

function conversationFromRow(row: ConversationRow): AgentConversation {
    const {
        allow_fork: _allowFork,
        published_until_message_id: _publishedUntilMessageId,
        last_metadata_json: lastMetadataJson,
        last_role: lastRole,
        ...conversation
    } = row;
    let workflowStatus: AgentConversation["workflow_status"] = (row.message_count || 0) > 0 ? "running" : "draft";
    try {
        const metadata = JSON.parse(lastMetadataJson || "{}");
        if (["draft", "running", "waiting_for_input", "completed", "error"].includes(metadata?.workflow_status)) {
            workflowStatus = metadata.workflow_status;
        } else if (lastRole === "assistant") {
            workflowStatus = "completed";
        }
    } catch {}
    return {...conversation, anonymous: Boolean(row.anonymous), workflow_status: workflowStatus};
}

function messageFromRow(row: MessageRow): AgentMessage {
    let metadata: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(row.metadata_json || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
    } catch {}
    const {metadata_json: _metadataJson, ...message} = row;
    return {...message, metadata};
}

export class init {
    private readonly databasePath = path.join(path_utils.get_project_root_path(), "storage/agent_storage/data/agent_storage.db");
    private readonly database: Database.Database;

    constructor() {
        const directory = path.dirname(this.databasePath);
        if (!fs.existsSync(directory)) fs.mkdirSync(directory, {recursive: true});
        this.database = new Database(this.databasePath);
        this.database.pragma("journal_mode = WAL");
        this.database.pragma("foreign_keys = ON");
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS agent_conversation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_username TEXT NOT NULL,
                title TEXT NOT NULL,
                visibility TEXT NOT NULL DEFAULT 'private',
                public_slug TEXT UNIQUE,
                published_until_message_id INTEGER,
                anonymous INTEGER NOT NULL DEFAULT 0,
                allow_fork INTEGER NOT NULL DEFAULT 0,
                view_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_message (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES agent_conversation(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS agent_conversation_owner_idx ON agent_conversation(owner_username, updated_at DESC);
            CREATE INDEX IF NOT EXISTS agent_conversation_lobby_idx ON agent_conversation(visibility, updated_at DESC);
            CREATE INDEX IF NOT EXISTS agent_message_conversation_idx ON agent_message(conversation_id, id);
        `);
        this.database.prepare("UPDATE agent_conversation SET allow_fork = 0 WHERE allow_fork <> 0").run();
        storage_logger("agent_storage", "数据库初始化成功", "info");
    }

    create_conversation(ownerUsername: string, title = "新 Session"): AgentConversation {
        const now = new Date().toISOString();
        const result = this.database.prepare(`
            INSERT INTO agent_conversation (owner_username, title, visibility, created_at, updated_at)
            VALUES (?, ?, 'public', ?, ?)
        `).run(ownerUsername, title.trim().slice(0, 80) || "新 Session", now, now);
        return this.get_owned_conversation(ownerUsername, Number(result.lastInsertRowid))!;
    }

    list_conversations(ownerUsername: string): AgentConversation[] {
        const rows = this.database.prepare(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM agent_message m WHERE m.conversation_id = c.id) AS message_count,
                   (SELECT content FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT metadata_json FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_metadata_json,
                   (SELECT role FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
            FROM agent_conversation c
            WHERE c.owner_username = ?
              AND EXISTS (SELECT 1 FROM agent_message m WHERE m.conversation_id = c.id)
            ORDER BY c.updated_at DESC, c.id DESC
        `).all(ownerUsername) as ConversationRow[];
        return rows.map(conversationFromRow);
    }

    list_all_conversations(): AgentConversation[] {
        const rows = this.database.prepare(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM agent_message m WHERE m.conversation_id = c.id) AS message_count,
                   (SELECT content FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT metadata_json FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_metadata_json,
                   (SELECT role FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
            FROM agent_conversation c
            WHERE EXISTS (SELECT 1 FROM agent_message m WHERE m.conversation_id = c.id)
            ORDER BY c.updated_at DESC, c.id DESC
        `).all() as ConversationRow[];
        return rows.map(conversationFromRow);
    }

    get_owned_conversation(ownerUsername: string, conversationId: number): AgentConversation | null {
        const row = this.database.prepare(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM agent_message m WHERE m.conversation_id = c.id) AS message_count,
                   (SELECT content FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT metadata_json FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_metadata_json,
                   (SELECT role FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
            FROM agent_conversation c
            WHERE c.id = ? AND c.owner_username = ?
        `).get(conversationId, ownerUsername) as ConversationRow | undefined;
        return row ? conversationFromRow(row) : null;
    }

    get_conversation(conversationId: number): AgentConversation | null {
        const row = this.database.prepare(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM agent_message m WHERE m.conversation_id = c.id) AS message_count,
                   (SELECT content FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT metadata_json FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_metadata_json,
                   (SELECT role FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
            FROM agent_conversation c
            WHERE c.id = ?
        `).get(conversationId) as ConversationRow | undefined;
        return row ? conversationFromRow(row) : null;
    }

    get_owned_messages(ownerUsername: string, conversationId: number, limit = 100): AgentMessage[] | null {
        if (!this.get_owned_conversation(ownerUsername, conversationId)) return null;
        return this.get_messages(conversationId, limit);
    }

    get_messages(conversationId: number, limit = 100): AgentMessage[] | null {
        if (!this.get_conversation(conversationId)) return null;
        const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 100));
        const rows = this.database.prepare(`
            SELECT * FROM (
                SELECT * FROM agent_message WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
        `).all(conversationId, safeLimit) as MessageRow[];
        return rows.map(messageFromRow);
    }

    append_message(ownerUsername: string, conversationId: number, role: AgentMessageRole, content: string, metadata: Record<string, unknown> = {}): AgentMessage | null {
        if (!this.get_owned_conversation(ownerUsername, conversationId)) return null;
        const safeContent = content.trim();
        if (!safeContent) return null;
        const now = new Date().toISOString();
        const transaction = this.database.transaction(() => {
            const result = this.database.prepare(`
                INSERT INTO agent_message (conversation_id, role, content, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(conversationId, role, safeContent, JSON.stringify(metadata), now);
            this.database.prepare("UPDATE agent_conversation SET updated_at = ? WHERE id = ?").run(now, conversationId);
            return Number(result.lastInsertRowid);
        });
        const messageId = transaction();
        const row = this.database.prepare("SELECT * FROM agent_message WHERE id = ?").get(messageId) as MessageRow;
        return messageFromRow(row);
    }

    rollback_from_message(ownerUsername: string, conversationId: number, messageId: number): AgentConversation | null {
        if (!this.get_owned_conversation(ownerUsername, conversationId)) return null;
        const target = this.database.prepare(`
            SELECT role FROM agent_message WHERE id = ? AND conversation_id = ?
        `).get(messageId, conversationId) as {role?: AgentMessageRole} | undefined;
        if (!target || target.role !== "user") return null;
        const now = new Date().toISOString();
        const transaction = this.database.transaction(() => {
            this.database.prepare("DELETE FROM agent_message WHERE conversation_id = ? AND id >= ?")
                .run(conversationId, messageId);
            const latest = this.database.prepare("SELECT MAX(id) AS id FROM agent_message WHERE conversation_id = ?")
                .get(conversationId) as {id: number | null};
            this.database.prepare(`
                UPDATE agent_conversation
                SET published_until_message_id = ?, updated_at = ?
                WHERE id = ? AND owner_username = ?
            `).run(latest.id, now, conversationId, ownerUsername);
        });
        transaction();
        return this.get_owned_conversation(ownerUsername, conversationId);
    }

    rename_conversation(ownerUsername: string, conversationId: number, title: string): AgentConversation | null {
        const safeTitle = title.trim().replace(/\s+/g, " ").slice(0, 80);
        if (!safeTitle || !this.get_owned_conversation(ownerUsername, conversationId)) return null;
        this.database.prepare("UPDATE agent_conversation SET title = ?, updated_at = ? WHERE id = ? AND owner_username = ?")
            .run(safeTitle, new Date().toISOString(), conversationId, ownerUsername);
        return this.get_owned_conversation(ownerUsername, conversationId);
    }

    rename_default_conversation(ownerUsername: string, conversationId: number, firstMessage: string): void {
        const conversation = this.get_owned_conversation(ownerUsername, conversationId);
        if (!conversation || !["新会话", "新工作流", "新 Session"].includes(conversation.title) || (conversation.message_count || 0) > 1) return;
        const title = firstMessage.trim().replace(/\s+/g, " ").slice(0, 32);
        if (title) this.rename_conversation(ownerUsername, conversationId, title);
    }

    delete_conversation(ownerUsername: string, conversationId: number): boolean {
        return this.database.prepare("DELETE FROM agent_conversation WHERE id = ? AND owner_username = ?")
            .run(conversationId, ownerUsername).changes > 0;
    }

    publish_conversation(ownerUsername: string, conversationId: number, anonymous: boolean): AgentConversation | null {
        const conversation = this.get_owned_conversation(ownerUsername, conversationId);
        if (!conversation) return null;
        const latest = this.database.prepare("SELECT MAX(id) AS id FROM agent_message WHERE conversation_id = ?")
            .get(conversationId) as {id: number | null};
        const publishUntil = latest.id;
        if (!publishUntil) return null;

        let slug = conversation.public_slug;
        while (!slug) {
            const candidate = crypto.randomBytes(9).toString("base64url");
            const exists = this.database.prepare("SELECT 1 FROM agent_conversation WHERE public_slug = ?").get(candidate);
            if (!exists) slug = candidate;
        }
        this.database.prepare(`
            UPDATE agent_conversation
            SET visibility = 'public', public_slug = ?, published_until_message_id = ?, anonymous = ?, allow_fork = 0, updated_at = ?
            WHERE id = ? AND owner_username = ?
        `).run(slug, publishUntil, anonymous ? 1 : 0, new Date().toISOString(), conversationId, ownerUsername);
        return this.get_owned_conversation(ownerUsername, conversationId);
    }

    unpublish_conversation(ownerUsername: string, conversationId: number): AgentConversation | null {
        if (!this.get_owned_conversation(ownerUsername, conversationId)) return null;
        this.database.prepare("UPDATE agent_conversation SET visibility = 'private', updated_at = ? WHERE id = ? AND owner_username = ?")
            .run(new Date().toISOString(), conversationId, ownerUsername);
        return this.get_owned_conversation(ownerUsername, conversationId);
    }

    list_lobby(page = 1, limit = 18, keyword = ""): {conversations: AgentConversation[]; total: number} {
        const safePage = Math.max(1, Math.floor(page) || 1);
        const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 18));
        const search = `%${keyword.trim().slice(0, 80)}%`;
        const where = "c.visibility = 'public' AND c.public_slug IS NOT NULL AND (c.title LIKE ? OR (c.anonymous = 0 AND c.owner_username LIKE ?))";
        const total = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM agent_conversation c WHERE ${where}`)
            .get(search, search) as {count: number}).count || 0);
        const rows = this.database.prepare(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM agent_message m WHERE m.conversation_id = c.id) AS message_count,
                   (SELECT content FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT metadata_json FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_metadata_json,
                   (SELECT role FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
            FROM agent_conversation c
            WHERE ${where}
            ORDER BY c.updated_at DESC, c.id DESC
            LIMIT ? OFFSET ?
        `).all(search, search, safeLimit, (safePage - 1) * safeLimit) as ConversationRow[];
        return {conversations: rows.map(conversationFromRow), total};
    }

    get_public_conversation(slug: string, incrementView = false): {conversation: AgentConversation; messages: AgentMessage[]} | null {
        const row = this.database.prepare(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM agent_message m WHERE m.conversation_id = c.id) AS message_count,
                   (SELECT content FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT metadata_json FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_metadata_json,
                   (SELECT role FROM agent_message m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
            FROM agent_conversation c
            WHERE c.public_slug = ? AND c.visibility = 'public'
        `).get(slug) as ConversationRow | undefined;
        if (!row) return null;
        if (incrementView) {
            this.database.prepare("UPDATE agent_conversation SET view_count = view_count + 1 WHERE id = ?").run(row.id);
            row.view_count += 1;
        }
        const messages = this.database.prepare("SELECT * FROM agent_message WHERE conversation_id = ? ORDER BY id ASC")
            .all(row.id) as MessageRow[];
        return {conversation: conversationFromRow(row), messages: messages.map(messageFromRow)};
    }

    event_handler(): void {}

    on_unload(): void {
        this.database.close();
    }
}
