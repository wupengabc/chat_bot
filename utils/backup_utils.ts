import fs from "node:fs";
import path from "node:path";
import {path_utils} from "./path_utils.js";

export interface BackupSummary {
    id: string;
    created_at: string;
    created_by: string;
    files: number;
    bytes: number;
}

const RUNTIME_FILES = [
    "storage/bangxi_server_storage/data/bangxi_server.db",
    "storage/chat_storage/data/chat_storage.db",
    "storage/chat_permission_storage/data/chat_permission_storage.db",
    "storage/bangxi_server_storage/data/last_player_list.json",
];

function root(): string {
    return path_utils.get_project_root_path();
}

function backupRoot(): string {
    return path.join(root(), "backups");
}

function formatTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function copyFile(relativePath: string, destination: string): number {
    const source = path.join(root(), relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return 0;
    const target = path.join(destination, relativePath);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);
    return fs.statSync(source).size;
}

function configFiles(directory: string, output: string[] = []): string[] {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        if (["node_modules", ".git", "dist", "backups"].includes(entry.name)) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) configFiles(entryPath, output);
        if (entry.isFile() && entry.name === "config.json") output.push(path.relative(root(), entryPath));
    }
    return output;
}

export function create_backup(createdBy: string): BackupSummary {
    const created_at = new Date().toISOString();
    const id = `snapshot-${formatTimestamp(new Date())}`;
    const directory = path.join(backupRoot(), id);
    fs.mkdirSync(directory, {recursive: true});
    let files = 0;
    let bytes = 0;
    for (const relativePath of [...configFiles(root()), ...RUNTIME_FILES]) {
        const size = copyFile(relativePath, directory);
        if (size > 0) { files++; bytes += size; }
    }
    const summary: BackupSummary = {id, created_at, created_by: createdBy, files, bytes};
    fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return summary;
}

export function list_backups(): BackupSummary[] {
    const directory = backupRoot();
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, {withFileTypes: true}).filter(entry => entry.isDirectory()).flatMap(entry => {
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(directory, entry.name, "manifest.json"), "utf8")) as BackupSummary;
            return manifest.id === entry.name ? [manifest] : [];
        } catch { return []; }
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function delete_backup(id: string): boolean {
    if (!/^snapshot-\d{8}-\d{6}$/.test(id)) return false;
    const target = path.join(backupRoot(), id);
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, {recursive: true, force: true});
    return true;
}
