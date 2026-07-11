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
    1: "vip用户",
    2: "管理员",
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
                instance.event_handler?.(event, { adapter_platform: adapter, ...data })
            }
        }
    }
}

/** 获取已注册的插件实例 */
export function get_plugin(plugin_name: string, config_name: string): any {
    return running_plugins.get(plugin_name)?.get(config_name)?.instance
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
            const plugin_name = path.basename(sub_dir)
            try {
                const config_path = path.join(sub_dir, "config.json")
                const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
                if (!config.name) {
                    plugin_logger(plugin_name, "config.json 没有 name 字段", "error")
                    continue
                }
                running_plugins.set(config.name, new Map())
                const start_configs = config.configs
                if (!start_configs) {
                    plugin_logger(plugin_name, "config.json 没有 configs 字段，跳过初始化", "info")
                    continue
                }
                const module_url = pathToFileURL(path.join(sub_dir, "index.js")).href + `?t=${Date.now()}`
                const { init } = await import(module_url)
                if (!init) {
                    plugin_logger(plugin_name, "没有 init 导出", "error")
                    continue
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
                        if (instance.help) {
                            help_list.push(instance.help)
                        }
                        running_plugins.get(config.name)!.set(start_config.name, { instance, adapters })
                        plugin_logger(config.name, `成功启动 ${start_config.name}（分发器: ${adapters.join(", ")}）`, "info")
                    } catch (error: any) {
                        plugin_logger(config.name, `初始化 ${start_config.name} 失败: ${error.message || error}`, "error")
                    }
                }
            } catch (error: any) {
                plugin_logger(plugin_name, `启动失败: ${error.message || error}`, "error")
            }
        }
    }
}

export async function reload_all_plugin() {
    // 清理旧插件
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
}
