import fs from "node:fs";
import path from "node:path";
import type {Express, Response} from "express";
import {get_plugin_statuses, reload_plugin, unload_plugin} from "../../../../../plugin/index.js";
import {reload_chat_adapter, running_chat_adapters, unload_chat_adapter} from "../../../../../chat_adapter/index.js";
import {reload_game_adapter, running_game_adapters, unload_game_adapter} from "../../../../../game_adapter/index.js";
import {get_storage_names, reload_storage, unload_storage} from "../../../../../storage/index.js";
import {record_audit, query_audits} from "../../../../../utils/audit_utils.js";
import {log_utils} from "../../../../../utils/log_utils.js";
import {path_utils} from "../../../../../utils/path_utils.js";
import {create_backup, delete_backup, list_backups} from "../../../../../utils/backup_utils.js";
import {require_admin, require_owner, type AdminRequest} from "../auth.js";
import {cachedPlaylistTracks, clearMediaCache, getAccountStatus, isKugouConfigPath, kugouCacheSummary, logout, playlistTracks, pollQrLogin, refreshToken, startQrLogin, syncAccountInfo, syncPlaylists} from "../../../../../service/kugou/kugou.js";
import {reload as reloadSensitiveFilter} from "../../../../../service/sensitive_filter/index.js";
import {validateApiServiceConfig} from "../../../../../service/api_service/index.js";

type ModuleType = "plugin" | "chat_adapter" | "game_adapter" | "storage";
type ConfigField = {type?: string; options?: unknown[]; options_from?: string; default?: unknown; description?: string; name?: string; sensitive?: boolean; provider?: string; item_template?: Record<string, ConfigField>};
type ConfigTemplate = Record<string, ConfigField>;
const qrSessionOwners = new Map<string, {username: string; expiresAt: number}>();
const SENSITIVE_FILTER_CONFIG_PATH = "service/sensitive_filter/config.json";

interface ConfigDocument {
    id: string;
    relativePath: string;
    name: string;
    description: string;
    template: ConfigTemplate;
    configPath: string;
    singleton: boolean;
}

function clientIp(request: AdminRequest): string {
    return request.ip || request.socket.remoteAddress || "unknown";
}

function audit(request: AdminRequest, action: string, target: string, detail: string, result: "success" | "failed"): void {
    record_audit({actor: request.admin!.username, action, target, detail, ip: clientIp(request), result});
}

function getModules() {
    const root = path_utils.get_project_root_path();
    const configNames = (directory: string, excluded: string[] = []) => {
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory, {withFileTypes: true}).filter(entry => entry.isDirectory() && !excluded.includes(entry.name)).flatMap(entry => {
            try {
                const config = JSON.parse(fs.readFileSync(path.join(directory, entry.name, "config.json"), "utf8"));
                return typeof config.name === "string" ? [config.name] : [];
            } catch { return []; }
        });
    };
    const storageNames = fs.existsSync(path.join(root, "storage"))
        ? fs.readdirSync(path.join(root, "storage"), {withFileTypes: true}).filter(entry => entry.isDirectory() && !["data", "web_api"].includes(entry.name)).map(entry => entry.name)
        : [];
    const plugins = new Map(get_plugin_statuses().map(item => [item.name, {...item, type: "plugin", state: "running"}]));
    for (const category of ["chat_adapter_plugin", "game_adapter_plugin"]) {
        for (const name of configNames(path.join(root, "plugin", category))) plugins.set(name, plugins.get(name) ?? {name, instances: [], adapters: [], type: "plugin", state: "stopped"});
    }
    const chatAdapters = new Map(Array.from(running_chat_adapters.entries()).map(([name, instances]) => [name, {
        type: "chat_adapter", name, state: "running", instances: Array.from((instances as Map<string, any>).entries()).map(([instanceName, instance]) => ({name: instanceName, status: instance?.status ?? "unknown"})),
    }]));
    for (const name of configNames(path.join(root, "chat_adapter"), ["data", "web_api"])) chatAdapters.set(name, chatAdapters.get(name) ?? {type: "chat_adapter", name, state: "stopped", instances: []});
    const gameAdapters = new Map(Array.from(running_game_adapters.entries()).map(([name, instances]) => [name, {
        type: "game_adapter", name, state: "running", instances: Array.from((instances as Map<string, any>).entries()).map(([instanceName, instance]) => ({name: instanceName, status: instance?.status ?? "unknown"})),
    }]));
    for (const name of configNames(path.join(root, "game_adapter"), ["data", "web_api"])) gameAdapters.set(name, gameAdapters.get(name) ?? {type: "game_adapter", name, state: "stopped", instances: []});
    const storages = new Map(get_storage_names().map(name => [name, {type: "storage", name, state: "running"}]));
    for (const name of storageNames) storages.set(name, storages.get(name) ?? {type: "storage", name, state: "stopped"});
    return {
        plugins: Array.from(plugins.values()),
        chat_adapters: Array.from(chatAdapters.values()),
        game_adapters: Array.from(gameAdapters.values()),
        storages: Array.from(storages.values()),
    };
}

function unloadModule(type: ModuleType, name: string): boolean {
    if (type === "plugin") return unload_plugin(name);
    if (type === "chat_adapter") return unload_chat_adapter(name);
    if (type === "game_adapter") return unload_game_adapter(name);
    return unload_storage(name);
}

async function reloadModule(type: ModuleType, name: string): Promise<void> {
    const target = name === "all" ? undefined : name;
    if (type === "plugin") return reload_plugin(target);
    if (type === "chat_adapter") return reload_chat_adapter(target);
    if (type === "game_adapter") return reload_game_adapter(target);
    return reload_storage(target);
}

/** 配置中心保存后，按配置文件所属目录热重载对应模块。 */
async function hotReloadConfigModule(document: ConfigDocument): Promise<string | null> {
    const relativePath = document.relativePath;
    if (relativePath === SENSITIVE_FILTER_CONFIG_PATH) {
        reloadSensitiveFilter();
        return "敏感词过滤服务已热更新";
    }
    if (relativePath === "plugin/config.json") {
        await reload_plugin();
        return "所有插件已热更新";
    }
    if (relativePath.startsWith("plugin/")) {
        await reload_plugin(document.name);
        return `插件 ${document.name} 已热更新`;
    }
    if (relativePath.startsWith("chat_adapter/")) {
        await reload_chat_adapter(document.name);
        return `聊天适配器 ${document.name} 已热更新`;
    }
    if (relativePath.startsWith("game_adapter/")) {
        await reload_game_adapter(document.name);
        return `游戏适配器 ${document.name} 已热更新`;
    }
    if (relativePath === "service/api_service/config.json") {
        return "API 服务配置已热更新";
    }
    return null;
}

function getLauncherConfig(): {webhook_port: number; webhook_path: string; webhook_key: string} {
    const configPath = path.join(path_utils.get_project_root_path(), "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!Number.isInteger(config.webhook_port) || !config.webhook_path || !config.webhook_key) {
        throw new Error("launcher WebHook 配置不完整");
    }
    return config;
}

function isSensitive(name: string, field?: ConfigField): boolean {
    // A suffix keeps fields such as tokenRefreshHours editable while retaining
    // compatibility with common names like token, apiKey, and refresh_token.
    return field?.sensitive === true || field?.type === "qrcode_auth" || /(token|secret|password|passwd|key)$/i.test(name);
}

function getConfigDocuments(): ConfigDocument[] {
    const root = path_utils.get_project_root_path();
    const result = new Map<string, ConfigDocument>();
    const addDocument = (configPath: string, source: Record<string, any>) => {
        if (!source.config_template || typeof source.config_template !== "object") return;
        const relativePath = path.relative(root, configPath).replace(/\\/g, "/");
        result.set(relativePath, {
            id: Buffer.from(relativePath).toString("base64url"),
            relativePath,
            name: String(source.name || path.basename(path.dirname(configPath))),
            description: String(source.description || ""),
            template: source.config_template,
            configPath,
            singleton: !Array.isArray(source.configs),
        });
    };
    const pluginConfigPath = path.join(root, "plugin", "config.json");
    if (fs.existsSync(pluginConfigPath)) {
        try {
            addDocument(pluginConfigPath, JSON.parse(fs.readFileSync(pluginConfigPath, "utf8")));
        } catch {
            // 忽略无效的全局插件配置。
        }
    }
    const visit = (directory: string) => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
                continue;
            }
            if (entry.name !== "config_example.json") continue;
            try {
                const example = JSON.parse(fs.readFileSync(entryPath, "utf8"));
                const configPath = path.join(path.dirname(entryPath), "config.json");
                if (!fs.existsSync(configPath)) continue;
                const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
                addDocument(configPath, config.config_template ? config : example);
            } catch {
                // 配置模板无效时不向管理端暴露该文件。
            }
        }
    };
    visit(root);
    const serviceDirectory = path.join(root, "service");
    if (fs.existsSync(serviceDirectory)) {
        for (const entry of fs.readdirSync(serviceDirectory, {withFileTypes: true})) {
            if (!entry.isDirectory()) continue;
            const configPath = path.join(serviceDirectory, entry.name, "config.json");
            if (!fs.existsSync(configPath)) continue;
            try {
                addDocument(configPath, JSON.parse(fs.readFileSync(configPath, "utf8")));
            } catch {
                // 忽略无效 service 配置。
            }
        }
    }
    return Array.from(result.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function findConfigDocument(id: string | string[] | undefined): ConfigDocument | null {
    const value = Array.isArray(id) ? id[0] : id;
    return getConfigDocuments().find(item => item.id === value) ?? null;
}

function isSensitiveFilterDocument(document: ConfigDocument): boolean {
    return document.relativePath === SENSITIVE_FILTER_CONFIG_PATH;
}

function redactValues(template: ConfigTemplate, values: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {...values};
    for (const [name, field] of Object.entries(template)) {
        if (field.type === "object" && values[name] && typeof values[name] === "object") {
            result[name] = redactValues((field.default || {}) as ConfigTemplate, values[name]);
        } else if (isSensitive(name, field)) {
            result[name] = null;
        }
    }
    return result;
}

function dynamicOptions(field: ConfigField, root: Record<string, any>): unknown[] | null {
    if (!field.options_from) return null;
    let source: any = root;
    for (const part of field.options_from.replace(/\[\]\.name$/, "").split(".")) source = source && typeof source === "object" ? source[part] : undefined;
    if (!Array.isArray(source)) return [];
    return [...new Set(source.map(item => item && typeof item === "object" ? item.name : undefined).filter(item => typeof item === "string" && item.trim()))];
}

function validateAndMerge(template: ConfigTemplate, current: Record<string, any>, incoming: Record<string, any>, root: Record<string, any> = incoming): Record<string, any> {
    const result: Record<string, any> = {...current};
    for (const [name, field] of Object.entries(template)) {
        if (!(name in incoming)) continue;
        const value = incoming[name];
        if (isSensitive(name, field)) {
            // Redacted fields are returned as null and empty password inputs mean
            // "keep the current value". A non-empty replacement must be saved.
            if (field.type === "qrcode_auth" || value === null || value === undefined || value === "") continue;
        }
        if (field.type === "object") {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
            result[name] = validateAndMerge((field.default || {}) as ConfigTemplate, current[name] || {}, value, root);
            continue;
        }
        if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${name} 必须是有效数字`);
        if (field.type === "boolean" && typeof value !== "boolean") throw new Error(`${name} 必须是布尔值`);
        if (field.type === "array" && !Array.isArray(value)) throw new Error(`${name} 必须是数组`);
        if (field.type === "map_list" && (!value || typeof value !== "object" || Array.isArray(value) || !Object.entries(value).every(([key, item]) => /^\d{5,20}$/.test(key) && typeof item === "string"))) throw new Error(`${name} 必须是 QQ 用户 ID 到文本的映射`);
        if (field.type === "string_list" && (!Array.isArray(value) || !value.every(item => typeof item === "string"))) throw new Error(`${name} 必须是文本名单`);
        if (field.type === "json" && (value === null || typeof value !== "object")) throw new Error(`${name} 必须是 JSON 对象或数组`);
        if ((field.type === "text" || field.type === "single_select") && typeof value !== "string") throw new Error(`${name} 必须是文本`);
        if (field.type === "multiple_select" && (!Array.isArray(value) || !value.every(item => typeof item === "string"))) throw new Error(`${name} 必须是文本数组`);
        const options = dynamicOptions(field, root) || (typeof (field as any).value_options_from === "string"
            ? dynamicOptions({options_from: (field as any).value_options_from}, root)
            : null) || field.options;
        if ((field.type === "single_select" || field.type === "multiple_select") && options) {
            const selected = Array.isArray(value) ? value : [value];
            if (!selected.every(item => options.includes(item))) throw new Error(`${name} 包含无效选项`);
        }
        if (field.type === "map_list" && options && !Object.values(value).every(item => options.includes(item))) throw new Error(`${name} 包含无效选项`);
        result[name] = value;
    }
    return result;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
    const temporary = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
}

function validateInstanceName(value: unknown): string {
    if (typeof value !== "string") throw new Error("实例名称无效");
    const name = value.trim();
    if (!/^[\w.-]{1,64}$/.test(name)) throw new Error("实例名称仅支持字母、数字、下划线、短横线和点，长度不超过 64 位");
    return name;
}

function templateDefaults(template: ConfigTemplate): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name, field] of Object.entries(template)) {
        if (field.type === "object") result[name] = templateDefaults((field.default || {}) as ConfigTemplate);
        else if (Array.isArray(field.default)) result[name] = [...field.default];
        else result[name] = field.default ?? (field.type === "boolean" ? false : field.type === "number" ? 0 : "");
    }
    return result;
}

export async function init(app: Express) {
    app.get("/api/admin/system/modules", require_admin, (request: AdminRequest, response: Response) => {
        response.json({success: true, modules: getModules()});
    });

    app.post("/api/admin/system/modules/:type/:name/reload", require_admin, async (request: AdminRequest, response: Response) => {
        const type = request.params.type as ModuleType;
        const name = Array.isArray(request.params.name) ? request.params.name[0] : request.params.name;
        if (!(["plugin", "chat_adapter", "game_adapter", "storage"] as string[]).includes(type) || !name) {
            response.status(400).json({success: false, message: "无效的模块类型或名称"});
            return;
        }
        try {
            await reloadModule(type, name);
            audit(request, "reload_module", `${type}:${name}`, "模块重载完成", "success");
            response.json({success: true, message: "模块重载完成"});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "reload_module", `${type}:${name}`, message, "failed");
            log_utils.logger("web_api", "system", `模块重载失败: ${type}:${name}: ${message}`, "error");
            response.status(500).json({success: false, message: "模块重载失败"});
        }
    });

    app.post("/api/admin/system/modules/:type/:name/unload", require_admin, (request: AdminRequest, response: Response) => {
        const type = request.params.type as ModuleType;
        const name = Array.isArray(request.params.name) ? request.params.name[0] : request.params.name;
        if (!( ["plugin", "chat_adapter", "game_adapter", "storage"] as string[]).includes(type) || !name || name === "all") {
            response.status(400).json({success: false, message: "无效的模块类型或名称"});
            return;
        }
        if (!unloadModule(type, name)) {
            response.status(409).json({success: false, message: "模块未运行或已卸载"});
            return;
        }
        audit(request, "unload_module", `${type}:${name}`, "模块已卸载", "success");
        response.json({success: true, message: "模块已卸载"});
    });

    app.get("/api/admin/system/audits", require_admin, (request: AdminRequest, response: Response) => {
        const page = Number(request.query.page) || 1;
        const pageSize = Number(request.query.page_size) || 30;
        const [total, entries] = query_audits(page, pageSize);
        response.json({success: true, total, entries});
    });

    app.get("/api/admin/system/configs", require_admin, (_request: AdminRequest, response: Response) => {
        const configs = getConfigDocuments().map(item => {
            const content = JSON.parse(fs.readFileSync(item.configPath, "utf8"));
            return {id: item.id, name: item.name, description: item.description, path: item.relativePath, instances: Array.isArray(content.configs) ? content.configs.length : 1};
        });
        response.json({success: true, configs});
    });

    app.get("/api/admin/system/configs/:id", require_admin, (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        if (!document) {
            response.status(404).json({success: false, message: "未找到受管理的配置"});
            return;
        }
        try {
            const content = JSON.parse(fs.readFileSync(document.configPath, "utf8"));
            const canReadSensitiveWords = isSensitiveFilterDocument(document) && request.admin?.role === "owner";
            const configs = Array.isArray(content.configs)
                ? content.configs.map((item: Record<string, any>) => canReadSensitiveWords ? {...item} : redactValues(document.template, item))
                : [{...(canReadSensitiveWords ? content : redactValues(document.template, content)), name: "__global__"}];
            const sensitiveSummary = isSensitiveFilterDocument(document)
                ? {
                    enabled: content.enabled !== false,
                    count: Array.isArray(content.sensitive_words) ? content.sensitive_words.length : 0,
                }
                : undefined;
            const authentication = isKugouConfigPath(document.configPath)
                ? Object.fromEntries(configs.map((item: Record<string, any>) => [item.name, {account: getAccountStatus(item.name)}]))
                : {};
            const kugou = isKugouConfigPath(document.configPath)
                ? Object.fromEntries(configs.map((item: Record<string, any>) => [item.name, kugouCacheSummary(item.name)]))
                : {};
            response.json({success: true, config: {id: document.id, name: document.name, description: document.description, path: document.relativePath, template: document.template, configs, singleton: document.singleton, authentication, kugou, ...(sensitiveSummary ? {sensitive_summary: sensitiveSummary} : {})}});
        } catch {
            response.status(500).json({success: false, message: "读取配置失败"});
        }
    });

    app.post("/api/admin/system/configs/:id/kugou/account", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = request.body?.name;
        if (!document || typeof instanceName !== "string" || !isKugouConfigPath(document.configPath)) {
            response.status(400).json({success: false, message: "不支持的酷狗配置"});
            return;
        }
        try {
            await refreshToken(instanceName);
            const account = await syncAccountInfo(instanceName);
            audit(request, "sync_kugou_account", document.relativePath, `已同步实例 ${instanceName} 的账号信息`, "success");
            response.json({success: true, account});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "sync_kugou_account", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.post("/api/admin/system/configs/:id/kugou/logout", require_admin, (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = request.body?.name;
        if (!document || typeof instanceName !== "string" || !isKugouConfigPath(document.configPath)) {
            response.status(400).json({success: false, message: "不支持的酷狗配置"});
            return;
        }
        try {
            logout(instanceName);
            audit(request, "logout_kugou_account", document.relativePath, `实例 ${instanceName} 已退出酷狗登录`, "success");
            response.json({success: true, message: "已退出酷狗登录"});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "logout_kugou_account", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.post("/api/admin/system/configs/:id/kugou/playlists", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = request.body?.name;
        if (!document || typeof instanceName !== "string" || !isKugouConfigPath(document.configPath)) {
            response.status(400).json({success: false, message: "不支持的酷狗配置"});
            return;
        }
        try {
            const playlists = await syncPlaylists(instanceName);
            audit(request, "sync_kugou_playlists", document.relativePath, `已同步实例 ${instanceName} 的 ${playlists.length} 个歌单`, "success");
            response.json({success: true, playlists});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "sync_kugou_playlists", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.post("/api/admin/system/configs/:id/kugou/playlists/:playlistId/tracks", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = request.body?.name;
        const playlistId = Array.isArray(request.params.playlistId) ? request.params.playlistId[0] : request.params.playlistId;
        if (!document || typeof instanceName !== "string" || !playlistId || !isKugouConfigPath(document.configPath)) {
            response.status(400).json({success: false, message: "不支持的酷狗配置"});
            return;
        }
        try {
            const tracks = await playlistTracks(instanceName, playlistId);
            audit(request, "sync_kugou_playlist_tracks", document.relativePath, `已同步歌单 ${playlistId} 的 ${tracks.length} 首歌曲`, "success");
            response.json({success: true, tracks});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "sync_kugou_playlist_tracks", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.get("/api/admin/system/configs/:id/kugou/playlists/:playlistId/tracks", require_admin, (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = typeof request.query.name === "string" ? request.query.name : "";
        const playlistId = Array.isArray(request.params.playlistId) ? request.params.playlistId[0] : request.params.playlistId;
        if (!document || !instanceName || !playlistId || !isKugouConfigPath(document.configPath)) {
            response.status(400).json({success: false, message: "不支持的酷狗配置"});
            return;
        }
        const allTracks = cachedPlaylistTracks(instanceName, playlistId);
        const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
        const pageSize = Math.min(100, Math.max(10, Math.floor(Number(request.query.page_size) || 30)));
        const totalPages = Math.max(1, Math.ceil(allTracks.length / pageSize));
        const currentPage = Math.min(page, totalPages);
        response.json({success: true, tracks: allTracks.slice((currentPage - 1) * pageSize, currentPage * pageSize), pagination: {page: currentPage, page_size: pageSize, total: allTracks.length, total_pages: totalPages, has_previous: currentPage > 1, has_next: currentPage < totalPages}});
    });

    app.delete("/api/admin/system/configs/:id/kugou/media-cache", require_admin, (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        if (!document || !isKugouConfigPath(document.configPath)) {
            response.status(400).json({success: false, message: "不支持的酷狗配置"});
            return;
        }
        const cleared = clearMediaCache();
        audit(request, "clear_kugou_media_cache", document.relativePath, `已清理 ${cleared.files} 个媒体缓存文件`, "success");
        response.json({success: true, ...cleared});
    });

    app.post("/api/admin/system/configs/:id/auth/:field/start", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const fieldName = Array.isArray(request.params.field) ? request.params.field[0] : request.params.field;
        const instanceName = request.body?.name;
        if (!document || !fieldName || typeof instanceName !== "string" || !isKugouConfigPath(document.configPath) || document.template[fieldName]?.type !== "qrcode_auth" || document.template[fieldName]?.provider !== "kugou") {
            response.status(400).json({success: false, message: "不支持的二维码认证字段"});
            return;
        }
        try {
            const result = await startQrLogin(instanceName);
            qrSessionOwners.set(result.sessionId, {username: request.admin!.username, expiresAt: Date.now() + 5 * 60_000});
            audit(request, "start_config_qr_auth", document.relativePath, `已为实例 ${instanceName} 创建二维码登录会话`, "success");
            response.json({success: true, session_id: result.sessionId, qr: result.qr, expires_in: 300});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "start_config_qr_auth", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.get("/api/admin/system/configs/:id/auth/:field/:sessionId", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const fieldName = Array.isArray(request.params.field) ? request.params.field[0] : request.params.field;
        const instanceName = typeof request.query.name === "string" ? request.query.name : "";
        const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId[0] : request.params.sessionId;
        if (!document || !fieldName || !sessionId || !instanceName || !isKugouConfigPath(document.configPath) || document.template[fieldName]?.type !== "qrcode_auth" || document.template[fieldName]?.provider !== "kugou") {
            response.status(400).json({success: false, message: "不支持的二维码认证字段"});
            return;
        }
        const owner = qrSessionOwners.get(sessionId);
        if (!owner || owner.expiresAt < Date.now() || owner.username !== request.admin!.username) {
            qrSessionOwners.delete(sessionId);
            response.status(404).json({success: false, message: "二维码登录会话不存在或已过期"});
            return;
        }
        try {
            const result = await pollQrLogin(instanceName, sessionId);
            if (result.state !== "waiting") qrSessionOwners.delete(sessionId);
            if (result.state === "confirmed") audit(request, "complete_config_qr_auth", document.relativePath, `实例 ${instanceName} 已完成二维码登录`, "success");
            response.json({success: true, ...result});
        } catch (error) {
            response.status(400).json({success: false, message: error instanceof Error ? error.message : String(error)});
        }
    });

    app.patch("/api/admin/system/configs/:id", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = request.body?.name;
        const requestedName = request.body?.new_name;
        const values = request.body?.values;
        if (!document || typeof instanceName !== "string" || !values || typeof values !== "object" || Array.isArray(values)) {
            response.status(400).json({success: false, message: "配置请求无效"});
            return;
        }
        try {
            const content = JSON.parse(fs.readFileSync(document.configPath, "utf8"));
            if (isSensitiveFilterDocument(document) && request.admin?.role !== "owner") {
                response.status(403).json({success: false, message: "敏感词配置仅所有者可修改"});
                return;
            }
            if (document.singleton) {
                const incoming = {...values};
                delete incoming.name;
                const merged = validateAndMerge(document.template, content, incoming);
                if (document.relativePath === "service/api_service/config.json") validateApiServiceConfig(merged);
                writeJsonAtomic(document.configPath, merged);
                const reloadMessage = await hotReloadConfigModule(document);
                const message = reloadMessage ? `配置已保存，${reloadMessage}` : "配置已保存";
                audit(request, "update_config", document.relativePath, message, "success");
                response.json({success: true, message});
                return;
            }
            if (!Array.isArray(content.configs)) throw new Error("配置实例格式无效");
            const index = content.configs.findIndex((item: Record<string, any>) => item?.name === instanceName);
            if (index < 0) throw new Error("未找到配置实例");
            const newName = requestedName === undefined ? instanceName : validateInstanceName(requestedName);
            if (newName !== instanceName && content.configs.some((item: Record<string, any>) => item?.name === newName)) throw new Error("实例名称已存在");
            const merged = validateAndMerge(document.template, content.configs[index], values);
            if (document.relativePath === "service/api_service/config.json") validateApiServiceConfig({...merged, name: newName});
            content.configs[index] = {...merged, name: newName};
            writeJsonAtomic(document.configPath, content);
            const reloadMessage = await hotReloadConfigModule(document);
            const updateMessage = `已更新实例 ${instanceName}${newName === instanceName ? "" : ` -> ${newName}`}`;
            const message = reloadMessage ? `${updateMessage}，${reloadMessage}` : updateMessage;
            audit(request, "update_config", document.relativePath, message, "success");
            response.json({success: true, message});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "update_config", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.post("/api/admin/system/configs/:id/instances", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        if (!document) {
            response.status(404).json({success: false, message: "未找到受管理的配置"});
            return;
        }
        if (document.singleton) {
            response.status(400).json({success: false, message: "全局配置不支持新增实例"});
            return;
        }
        try {
            const name = validateInstanceName(request.body?.name);
            const content = JSON.parse(fs.readFileSync(document.configPath, "utf8"));
            if (!Array.isArray(content.configs)) throw new Error("配置实例格式无效");
            if (content.configs.some((item: Record<string, any>) => item?.name === name)) throw new Error("实例名称已存在");
            content.configs.push({name, ...templateDefaults(document.template)});
            writeJsonAtomic(document.configPath, content);
            const reloadMessage = await hotReloadConfigModule(document);
            const createMessage = `已新增实例 ${name}`;
            const message = reloadMessage ? `${createMessage}，${reloadMessage}` : createMessage;
            audit(request, "create_config_instance", document.relativePath, message, "success");
            response.json({success: true, message});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "create_config_instance", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.delete("/api/admin/system/configs/:id/instances/:name", require_admin, async (request: AdminRequest, response: Response) => {
        const document = findConfigDocument(request.params.id);
        const instanceName = Array.isArray(request.params.name) ? request.params.name[0] : request.params.name;
        if (!document || !instanceName) {
            response.status(404).json({success: false, message: "未找到受管理的配置实例"});
            return;
        }
        if (document.singleton) {
            response.status(400).json({success: false, message: "全局配置不支持删除实例"});
            return;
        }
        try {
            const content = JSON.parse(fs.readFileSync(document.configPath, "utf8"));
            if (!Array.isArray(content.configs)) throw new Error("配置实例格式无效");
            if (content.configs.length <= 1) throw new Error("至少需要保留一个配置实例");
            const index = content.configs.findIndex((item: Record<string, any>) => item?.name === instanceName);
            if (index < 0) throw new Error("未找到配置实例");
            content.configs.splice(index, 1);
            writeJsonAtomic(document.configPath, content);
            const reloadMessage = await hotReloadConfigModule(document);
            const deleteMessage = `已删除实例 ${instanceName}`;
            const message = reloadMessage ? `${deleteMessage}，${reloadMessage}` : deleteMessage;
            audit(request, "delete_config_instance", document.relativePath, message, "success");
            response.json({success: true, message});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "delete_config_instance", document.relativePath, message, "failed");
            response.status(400).json({success: false, message});
        }
    });

    app.get("/api/admin/system/backups", require_owner, (_request: AdminRequest, response: Response) => {
        response.json({success: true, backups: list_backups()});
    });

    app.post("/api/admin/system/backups", require_owner, (request: AdminRequest, response: Response) => {
        try {
            const backup = create_backup(request.admin!.username);
            audit(request, "create_backup", backup.id, `已备份 ${backup.files} 个文件`, "success");
            response.json({success: true, backup});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "create_backup", "snapshot", message, "failed");
            response.status(500).json({success: false, message: "创建备份失败"});
        }
    });

    app.delete("/api/admin/system/backups/:id", require_owner, (request: AdminRequest, response: Response) => {
        const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
        if (!id || !delete_backup(id)) {
            response.status(404).json({success: false, message: "未找到备份"});
            return;
        }
        audit(request, "delete_backup", id, "已删除备份快照", "success");
        response.json({success: true});
    });

    app.post("/api/admin/system/maintenance/update", require_admin, async (request: AdminRequest, response: Response) => {
        try {
            const config = getLauncherConfig();
            const url = new URL(`http://127.0.0.1:${config.webhook_port}${config.webhook_path}`);
            url.searchParams.set("key", config.webhook_key);
            const result = await fetch(url, {method: "POST"});
            if (!result.ok) throw new Error(`launcher 返回 ${result.status}`);
            audit(request, "check_update", "launcher", "已请求检查并应用更新", "success");
            response.json({success: true, message: "已请求 launcher 检查更新"});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            audit(request, "check_update", "launcher", message, "failed");
            response.status(500).json({success: false, message: "无法请求更新检查"});
        }
    });

    app.post("/api/admin/system/maintenance/restart", require_admin, (request: AdminRequest, response: Response) => {
        audit(request, "restart_service", "application", "已请求由 launcher 重启应用", "success");
        response.json({success: true, message: "应用将在数秒后重启"});
        setTimeout(() => process.exit(0), 250);
    });
}
