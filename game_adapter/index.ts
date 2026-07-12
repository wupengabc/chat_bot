import {log_utils, LoggerType} from "../utils/log_utils.js";
import {event_emitter} from "../utils/event_emitter.js";
import {path_utils} from "../utils/path_utils.js";
import path from "node:path";
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {plugin_handle_adapter_event} from "../plugin/index.js";
import {storage_handle_adapter_event} from "../storage/index.js";

export function game_adapter_logger(plugin_name: string, message: string, level: LoggerType) {
    log_utils.logger("game_adapter", plugin_name, message, level)
}

export const game_adapter_event = new event_emitter()
const exclude_dirs = ["data", "web_api"]
export const running_game_adapters = new Map()

game_adapter_event.onAny((event, data) => {
    plugin_handle_adapter_event("game_adapter", event, data)
    storage_handle_adapter_event("game_adapter", event, data)
})

/** 加载单个 game_adapter 目录 */
async function load_game_adapter_from_dir(dir_path: string) {
    try {
        const config_path = path.join(dir_path, "config.json")
        const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
        if (!config.name) {
            game_adapter_logger("main", `game_adapter ${dir_path} 的 config.json 没有name 字段`, "error")
            return
        }
        running_game_adapters.set(config.name, new Map())
        const start_configs = config.configs
        if (!start_configs) {
            game_adapter_logger("main", `game_adapter ${config.name} 的 config.json 没有 configs 字段，跳过初始化`, "info")
            return
        }
        const module_url = pathToFileURL(path.join(dir_path, "index.js")).href + `?t=${Date.now()}`
        const {init} = await import(module_url)
        if (!init) {
            game_adapter_logger("main", `game_adapter ${dir_path} 没有 init function`, "error")
            return
        }
        for (const start_config of start_configs) {
            if (!start_config.name) {
                game_adapter_logger("main", `game_adapter ${path.basename(dir_path)} configs name is empty`, "error")
                continue
            }
            try {
                const result = new init(start_config)
                result.event.onAny((event: string, data: any) => {
                    game_adapter_event.emit(event, data)
                })
                running_game_adapters.get(config.name).set(start_config.name, result)
            } catch (error:any) {
                game_adapter_logger("main", `game_adapter ${config.name} 初始化 ${start_config.name} 失败`, "error")
                game_adapter_logger("main", String(error.message | error.stack), "error")
            }
        }
    } catch (error:any) {
        game_adapter_logger("main", String(error.message | error.stack), "error")
    }
}

/** 根据适配器名查找其目录路径 */
function find_game_adapter_dir(adapter_name: string): string | null {
    const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "game_adapter"))
    const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
    for (const item of filtered_dir) {
        try {
            const config_path = path.join(item, "config.json")
            const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
            if (config.name === adapter_name) {
                return item
            }
        } catch {
            // 忽略读取失败的目录
        }
    }
    return null
}

export async function init_game_adapter() {
    try {
        const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "game_adapter"))
        const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
        for (const item of filtered_dir) {
            await load_game_adapter_from_dir(item)
        }
    } catch (error:any) {
        game_adapter_logger("main", String(error.message | error.stack), "error")
    }
}

/** 列出正在运行的 game_adapter */
export function list_game_adapter(): string[] {
    const lines: string[] = []
    if (running_game_adapters.size === 0) {
        lines.push("当前没有正在运行的 game_adapter")
        return lines
    }
    let total = 0
    const detail_lines: string[] = []
    for (const [adapter_name, config_map] of running_game_adapters) {
        const instance_names = Array.from(config_map.keys())
        const statuses = Array.from(config_map.values()).map((inst: any) => inst.status || "unknown")
        total += instance_names.length
        detail_lines.push(`  - ${adapter_name}（实例: ${instance_names.join(", ")}，状态: ${statuses.join(", ")}）`)
    }
    lines.push(`正在运行的 game_adapter（共 ${running_game_adapters.size} 个适配器，${total} 个实例）:`)
    lines.push(...detail_lines)
    return lines
}

/**
 * 重载 game_adapter。
 * 不带参数时重载全部，带参数时只重载指定名称的适配器。
 */
export async function reload_game_adapter(adapter_name?: string) {
    if (!adapter_name) {
        // 重载全部
        for (const config_map of running_game_adapters.values()) {
            for (const instance of config_map.values()) {
                instance.stop?.()
            }
        }
        running_game_adapters.clear()

        game_adapter_logger("main", "正在重新加载全部 game_adapter...", "info")
        await init_game_adapter()
        game_adapter_logger("main", "game_adapter 重载完成", "info")
        return
    }

    // 重载指定适配器
    const dir_path = find_game_adapter_dir(adapter_name)
    if (!dir_path) {
        game_adapter_logger("main", `未找到 game_adapter: ${adapter_name}`, "warn")
        return
    }

    // 卸载旧实例
    const old_config_map = running_game_adapters.get(adapter_name)
    if (old_config_map) {
        for (const instance of old_config_map.values()) {
            instance.stop?.()
        }
        running_game_adapters.delete(adapter_name)
    }

    game_adapter_logger("main", `正在重新加载 game_adapter ${adapter_name}...`, "info")
    await load_game_adapter_from_dir(dir_path)
    game_adapter_logger("main", `game_adapter ${adapter_name} 重载完成`, "info")
}

export function get_game_adapter(adapter_name: string, config_name: string) {
    return running_game_adapters.get(adapter_name)?.get(config_name)
}