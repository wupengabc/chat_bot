import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {path_utils} from "./path_utils.js";

export interface AuditEntry {
    id: number;
    time: string;
    actor: string;
    action: string;
    target: string;
    detail: string;
    ip: string;
    result: "success" | "failed";
}

let database: ReturnType<typeof Database> | null = null;

function getDatabase(): ReturnType<typeof Database> {
    if (database) return database;
    const directory = path.join(path_utils.get_project_root_path(), "logs");
    fs.mkdirSync(directory, {recursive: true});
    database = new Database(path.join(directory, "audit.db"));
    database.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT NOT NULL,
            detail TEXT NOT NULL,
            ip TEXT NOT NULL,
            result TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs(time DESC);
    `);
    return database;
}

function formatTime(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function record_audit(entry: Omit<AuditEntry, "id" | "time">): void {
    getDatabase().prepare(`
        INSERT INTO audit_logs (time, actor, action, target, detail, ip, result)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(formatTime(new Date()), entry.actor, entry.action, entry.target, entry.detail, entry.ip, entry.result);
}

export function query_audits(page = 1, pageSize = 30): [number, AuditEntry[]] {
    const db = getDatabase();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const total = (db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as {count: number}).count;
    const entries = db.prepare(`
        SELECT id, time, actor, action, target, detail, ip, result
        FROM audit_logs
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).all(safePageSize, (safePage - 1) * safePageSize) as AuditEntry[];
    return [total, entries];
}
