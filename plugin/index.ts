import {path_utils} from "../utils/path_utils.js";
import path from "node:path";
import fs from "node:fs";
import {log_utils, LoggerType} from "../utils/log_utils.js";
import {pathToFileURL} from "node:url";
import {help} from "./type.js";

export function get_chat_adapter_prefix() {
    const config = fs.readFileSync(path.join(path_utils.get_project_root_path(), "plugin/config.json"), "utf-8")
    return JSON.parse(config).chat_adapter_prefix
}

export function get_game_adapter_prefix() {
    const config = fs.readFileSync(path.join(path_utils.get_project_root_path(), "plugin/config.json"), "utf-8")
    return JSON.parse(config).game_adapter_prefix
}

export function plugin_logger(plugin: string, msg: string, type: LoggerType) {
    log_utils.logger("plugin", plugin, msg, type)
}

interface RunningPlugin {
    instance: any
    adapters: string[]
}

/** plugin_name → config_name → RunningPlugin */
const running_plugins = new Map<string, Map<string, RunningPlugin>>()
export const help_list: help[] = []
export const permission_map = {
    0: "普通用户",
    1: "超级用户",
    2: "Bot管理",
}

/* ===================== 用户插件锁 ===================== */

/** 锁的超时时间（毫秒），2 分钟后自动释放 */
const LOCK_TIMEOUT = 2 * 60 * 1000

/** 释放后的冷却时间（毫秒），期间仍阻止获取，防止同步插件被快速连刷 */
const LOCK_COOLDOWN = 3 * 1000

interface LockEntry {
    acquired_at: number
    timer: ReturnType<typeof setTimeout>
    /** true 表示已被显式释放，正在冷却期，定时器到期后静默删除 */
    released: boolean
}

/**
 * 共享锁 —— 所有插件公用一把锁。
 * key = user_id，value = 锁信息。
 * 同一用户在任何插件上的操作未完成时，其他插件无法为其服务，防止同时触发大量监听器导致卡顿。
 * 释放后进入冷却期（LOCK_COOLDOWN），冷却期内仍阻止获取。
 */
export const user_plugin_locks = new Map<string, LockEntry>()

/**
 * 命名锁 —— 供插件内部独立使用的锁（如 bind 防止重复绑定请求）。
 * key = `${name}:${user_id}`，value = 锁信息。
 */
export const user_named_locks = new Map<string, LockEntry>()

/**
 * 尝试获取共享插件锁。
 * @returns true 表示获取成功；false 表示该用户已有正在进行的插件操作或处于冷却期。
 */
export function acquire_plugin_lock(user_id: string | number): boolean {
    const key = String(user_id)
    if (user_plugin_locks.has(key)) {
        return false
    }
    const entry: LockEntry = { acquired_at: Date.now(), timer: null as any, released: false }
    entry.timer = setTimeout(() => {
        if (!entry.released) {
            plugin_logger("lock", `用户 ${user_id} 的共享插件锁因超时(${LOCK_TIMEOUT / 1000}s)自动释放`, "warn")
        }
        user_plugin_locks.delete(key)
    }, LOCK_TIMEOUT)
    user_plugin_locks.set(key, entry)
    return true
}

/**
 * 释放共享插件锁。
 * @param cooldown_ms 释放后的冷却时间，冷却期内仍阻止获取。默认 LOCK_COOLDOWN（3秒）。传 0 表示立即释放。
 */
export function release_plugin_lock(user_id: string | number, cooldown_ms: number = LOCK_COOLDOWN): void {
    const key = String(user_id)
    const lock = user_plugin_locks.get(key)
    if (!lock) return
    clearTimeout(lock.timer)
    lock.released = true
    if (cooldown_ms > 0) {
        lock.timer = setTimeout(() => {
            user_plugin_locks.delete(key)
        }, cooldown_ms)
    } else {
        user_plugin_locks.delete(key)
    }
}

/** 检查共享插件锁是否被占用 */
export function is_plugin_locked(user_id: string | number): boolean {
    return user_plugin_locks.has(String(user_id))
}

/**
 * 尝试获取命名锁（供插件内部独立使用）。
 * @returns true 表示获取成功；false 表示该锁已被占用或处于冷却期。
 */
export function acquire_named_lock(name: string, user_id: string | number): boolean {
    const key = `${name}:${user_id}`
    if (user_named_locks.has(key)) {
        return false
    }
    const entry: LockEntry = { acquired_at: Date.now(), timer: null as any, released: false }
    entry.timer = setTimeout(() => {
        if (!entry.released) {
            plugin_logger(name, `用户 ${user_id} 的命名锁 ${name} 因超时(${LOCK_TIMEOUT / 1000}s)自动释放`, "warn")
        }
        user_named_locks.delete(key)
    }, LOCK_TIMEOUT)
    user_named_locks.set(key, entry)
    return true
}

/**
 * 释放命名锁。
 * @param cooldown_ms 释放后的冷却时间，冷却期内仍阻止获取。默认 LOCK_COOLDOWN（3秒）。传 0 表示立即释放。
 */
export function release_named_lock(name: string, user_id: string | number, cooldown_ms: number = LOCK_COOLDOWN): void {
    const key = `${name}:${user_id}`
    const lock = user_named_locks.get(key)
    if (!lock) return
    clearTimeout(lock.timer)
    lock.released = true
    if (cooldown_ms > 0) {
        lock.timer = setTimeout(() => {
            user_named_locks.delete(key)
        }, cooldown_ms)
    } else {
        user_named_locks.delete(key)
    }
}

/** 检查命名锁是否被占用 */
export function is_named_locked(name: string, user_id: string | number): boolean {
    return user_named_locks.has(`${name}:${user_id}`)
}

/** 目录名 → 默认订阅的分发器 */
const plugin_dirs: Record<string, string[]> = {
    "chat_adapter_plugin": ["chat_adapter"],
    "game_adapter_plugin": ["game_adapter"],
}

/**
 * 分发适配器事件到已注册的插件。
 * 仅分发给订阅了对应 adapter 的插件。
 */
export function plugin_handle_adapter_event(adapter: string, event: string, data: any) {
    for (const config_map of running_plugins.values()) {
        for (const { instance, adapters } of config_map.values()) {
            if (adapters.includes(adapter)) {
                try {
                    instance.event_handler?.(event, { adapter_platform: adapter, ...data })
                } catch (error) {
                    plugin_logger(instance.config.name, `插件 ${instance.config.name} 处理事件 ${event} 时出错: ${error}`, "error")
                }
            }
        }
    }
}

/** 获取已注册插件名称，供控制台补全使用 */
export function get_plugin_names(): string[] {
    return Array.from(running_plugins.keys())
}

/** 获取已注册的插件实例 */
export function get_plugin(plugin_name: string, config_name: string): any {
    return running_plugins.get(plugin_name)?.get(config_name)?.instance
}

/** 从 running_plugins 重建 help_list */
function rebuild_help_list() {
    help_list.length = 0
    for (const config_map of running_plugins.values()) {
        for (const { instance } of config_map.values()) {
            if (instance.help) {
                help_list.push(instance.help)
            }
        }
    }
}

/** 加载单个插件目录 */
async function load_plugin_from_dir(sub_dir: string, default_adapters: string[]) {
    const plugin_name = path.basename(sub_dir)
    try {
        const config_path = path.join(sub_dir, "config.json")
        const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
        if (!config.name) {
            plugin_logger(plugin_name, "config.json 没有 name 字段", "error")
            return
        }
        running_plugins.set(config.name, new Map())
        const start_configs = config.configs
        if (!start_configs) {
            plugin_logger(plugin_name, "config.json 没有 configs 字段，跳过初始化", "info")
            return
        }
        const module_url = pathToFileURL(path.join(sub_dir, "index.js")).href + `?t=${Date.now()}`
        const { init } = await import(module_url)
        if (!init) {
            plugin_logger(plugin_name, "没有 init 导出", "error")
            return
        }
        for (const start_config of start_configs) {
            if (!start_config.name) {
                plugin_logger(plugin_name, "configs name 为空", "error")
                continue
            }
            try {
                const instance = new init(start_config)
                const adapters = Array.isArray(instance.adapters)
                    ? instance.adapters
                    : default_adapters
                running_plugins.get(config.name)!.set(start_config.name, { instance, adapters })
                plugin_logger(config.name, `成功启动 [${plugin_name}] [${start_config.name}]（分发器: ${adapters.join(", ")}）`, "info")
            } catch (error: any) {
                plugin_logger(config.name, `初始化 ${start_config.name} 失败: ${error.message || error}`, "error")
            }
        }
    } catch (error: any) {
        plugin_logger(plugin_name, `启动失败: ${error.message || error}`, "error")
    }
}

/** 根据插件名查找其目录路径和默认适配器 */
async function find_plugin_dir(plugin_name: string): Promise<{ sub_dir: string; default_adapters: string[] } | null> {
    const plugin_base_path = path.join(path_utils.get_project_root_path(), "plugin")
    for (const [dir_name, default_adapters] of Object.entries(plugin_dirs)) {
        const dir_path = path.join(plugin_base_path, dir_name)
        if (!fs.existsSync(dir_path)) continue
        const sub_dirs = path_utils.get_path_dir_list(dir_path)
        for (const sub_dir of sub_dirs) {
            try {
                const config_path = path.join(sub_dir, "config.json")
                const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
                if (config.name === plugin_name) {
                    return { sub_dir, default_adapters }
                }
            } catch {
                // 忽略读取失败的目录
            }
        }
    }
    return null
}

/**
 * 初始化所有插件。
 * 每个插件目录需包含 config.json，结构为：
 *   { name, description, config_template, configs: [{ name, ... }] }
 * 每个 configs 条目实例化一次，按所在目录决定默认订阅的分发器，
 * 插件也可通过实例属性 adapters 覆盖：
 *   chat_adapter_plugin/ → ["chat_adapter"]
 *   game_adapter_plugin/ → ["game_adapter"]
 *   both_adapter_plugin/ → ["chat_adapter", "game_adapter"]
 */
export async function init_plugin() {
    const plugin_base_path = path.join(path_utils.get_project_root_path(), "plugin")
    for (const [dir_name, default_adapters] of Object.entries(plugin_dirs)) {
        const dir_path = path.join(plugin_base_path, dir_name)
        if (!fs.existsSync(dir_path)) continue

        const sub_dirs = path_utils.get_path_dir_list(dir_path)
        for (const sub_dir of sub_dirs) {
            await load_plugin_from_dir(sub_dir, default_adapters)
        }
    }
    rebuild_help_list()
}

/** 列出正在运行的插件 */
export function list_plugin(): string[] {
    const lines: string[] = []
    if (running_plugins.size === 0) {
        lines.push("当前没有正在运行的插件")
        return lines
    }
    lines.push(`正在运行的插件（共 ${running_plugins.size} 个）:`)
    for (const [plugin_name, config_map] of running_plugins) {
        const config_names = Array.from(config_map.keys()).join(", ")
        const adapters = Array.from(config_map.values()).map(v => v.adapters.join("/")).join(", ")
        lines.push(`  - ${plugin_name}（实例: ${config_names}，分发器: ${adapters}）`)
    }
    return lines
}

/**
 * 重载插件。
 * 不带参数时重载全部插件，带参数时只重载指定名称的插件。
 */
export async function reload_plugin(plugin_name?: string) {
    if (!plugin_name) {
        // 重载全部
        for (const config_map of running_plugins.values()) {
            for (const { instance } of config_map.values()) {
                instance.on_unload?.()
            }
        }
        running_plugins.clear()
        help_list.length = 0

        plugin_logger("main", "正在重新加载全部插件...", "info")
        await init_plugin()
        plugin_logger("main", "插件重载完成", "info")
        return
    }

    // 重载指定插件
    const found = await find_plugin_dir(plugin_name)
    if (!found) {
        plugin_logger("main", `未找到插件: ${plugin_name}`, "warn")
        return
    }

    // 卸载旧实例
    const old_config_map = running_plugins.get(plugin_name)
    if (old_config_map) {
        for (const { instance } of old_config_map.values()) {
            instance.on_unload?.()
        }
        running_plugins.delete(plugin_name)
    }

    plugin_logger(plugin_name, `正在重新加载插件 ${plugin_name}...`, "info")
    await load_plugin_from_dir(found.sub_dir, found.default_adapters)
    rebuild_help_list()
    plugin_logger(plugin_name, `插件 ${plugin_name} 重载完成`, "info")
}
