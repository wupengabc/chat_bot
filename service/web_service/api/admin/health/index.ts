import os from "node:os";
import {execSync} from "node:child_process";
import type {Express, Request, Response} from "express";
import {get_game_adapter} from "../../../../../game_adapter/index.js";
import {running_chat_adapters} from "../../../../../chat_adapter/index.js";
import {get_plugin_counts} from "../../../../../plugin/index.js";
import {log_utils} from "../../../../../utils/log_utils.js";
import {require_admin} from "../auth.js";
import {list_backups} from "../../../../../utils/backup_utils.js";

function getUptimeSeconds(): number {
    return Math.floor(process.uptime());
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function getDiskUsage(): {percent: number; used: number; total: number} {
    try {
        if (os.platform() === "win32") {
            const out = execSync("wmic logicaldisk where drivetype=3 get size,freespace /format:csv", {encoding: "utf8", timeout: 5000});
            const lines = out.trim().split(/\r?\n/).filter(Boolean);
            let totalFree = 0n, totalSize = 0n;
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(",");
                if (parts.length >= 3) {
                    const free = BigInt(parts[1].trim());
                    const size = BigInt(parts[2].trim());
                    if (size > 0n) { totalFree += free; totalSize += size; }
                }
            }
            const used = totalSize - totalFree;
            return {percent: totalSize === 0n ? 0 : Number(used * 100n / totalSize), used: Number(used), total: Number(totalSize)};
        } else {
            const out = execSync("df -k /", {encoding: "utf8", timeout: 5000});
            const lines = out.trim().split("\n");
            if (lines.length >= 2) {
                const parts = lines[1].split(/\s+/);
                if (parts.length >= 5) {
                    const total = parseInt(parts[1], 10) * 1024;
                    const free = parseInt(parts[3], 10) * 1024;
                    const used = total - free;
                    return {percent: total === 0 ? 0 : Math.round(used / total * 100), used, total};
                }
            }
        }
        return {percent: 0, used: 0, total: 0};
    } catch {
        return {percent: 0, used: 0, total: 0};
    }
}

function getMemoryUsage(): {percent: number; used: number; total: number} {
    try {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        return {percent: total === 0 ? 0 : Math.round(used / total * 100), used, total};
    } catch {
        return {percent: 0, used: 0, total: 0};
    }
}

function getRuntimeInfo() {
    const cpu = os.cpus()[0];
    const processMemory = process.memoryUsage();
    return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        architecture: os.arch(),
        cpu: cpu?.model ?? "未知",
        cpu_cores: os.cpus().length,
        process_memory: processMemory.rss,
        node_version: process.version,
    };
}

function getTodayErrorCount(): number {
    try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
        const [total] = log_utils.query_logs({type: "error", time_from: start, time_to: end}, 1, 1);
        return total;
    } catch {
        return 0;
    }
}

function getBotStatus(): {status: string; label: string; healthy: boolean; level: string} {
    try {
        const instance = get_game_adapter("mineflayer", "bangxi") as {status?: string} | undefined;
        const status = instance?.status ?? "unknown";
        const map: Record<string, {label: string; healthy: boolean; level: string}> = {
            running: {label: "运行中", healthy: true, level: "ok"},
            connecting: {label: "连接中", healthy: true, level: "warn"},
            stopped: {label: "离线", healthy: false, level: "err"},
        };
        const mapped = map[status] ?? {label: "未知", healthy: false, level: "na"};
        return {status, label: mapped.label, healthy: mapped.healthy, level: mapped.level};
    } catch {
        return {status: "unknown", label: "未知", healthy: false, level: "na"};
    }
}

function getChatAdapterStatuses(): Array<{adapter: string; config: string; status: string; label: string; level: string}> {
    try {
        const result: Array<{adapter: string; config: string; status: string; label: string; level: string}> = [];
        const map: Record<string, {label: string; level: string}> = {
            running: {label: "运行中", level: "ok"},
            connecting: {label: "连接中", level: "warn"},
            stopped: {label: "离线", level: "err"},
        };
        for (const [adapterName, configMap] of running_chat_adapters) {
            for (const [configName, instance] of configMap) {
                const status = instance?.status ?? "unknown";
                const mapped = map[status] ?? {label: "未知", level: "na"};
                result.push({adapter: adapterName, config: configName, status, label: mapped.label, level: mapped.level});
            }
        }
        if (result.length === 0) {
            result.push({adapter: "—", config: "—", status: "stopped", label: "离线", level: "err"});
        }
        return result;
    } catch {
        return [{adapter: "—", config: "—", status: "unknown", label: "未知", level: "na"}];
    }
}

export async function init(app: Express) {
    app.get("/api/admin/health", require_admin, (request: Request, response: Response) => {
        try {
            const todayErrors = getTodayErrorCount();
            const uptimeSeconds = getUptimeSeconds();
            const bot = getBotStatus();
            const chatAdapters = getChatAdapterStatuses();

            const diskUsage = getDiskUsage();
            const memoryUsage = getMemoryUsage();
            const pluginCounts = get_plugin_counts();
            const runtime = getRuntimeInfo();

            response.json({
                success: true,
                server: {
                    status: "online",
                    label: "在线",
                    healthy: true,
                    level: "ok",
                    uptime: formatUptime(uptimeSeconds),
                    uptime_seconds: uptimeSeconds,
                },
                bot,
                chat_adapters: chatAdapters,
                plugin_counts: pluginCounts,
                disk_usage: diskUsage,
                memory_usage: memoryUsage,
                runtime,
                today_errors: todayErrors,
                last_backup: list_backups()[0]?.created_at ?? null,
            });
        } catch (error) {
            log_utils.logger("web_api", "admin", `获取系统健康失败: ${error instanceof Error ? error.message : String(error)}`, "error");
            response.status(500).json({success: false, message: "获取系统健康失败"});
        }
    });
}
