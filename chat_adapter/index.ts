import {path_utils} from "../utils/path_utils.js";
import path from "node:path";
import fs from "node:fs";
import {log_utils, LoggerType} from "../utils/log_utils.js";
import {pathToFileURL} from "node:url";
import {EventEmitter} from "node:events";
import {ChatAdapterMessage} from "./type.js";
import {plugin_handle_adapter_event} from "../plugin/index.js";
import {event_emitter} from "../utils/event_emitter.js";
import {storage_handle_adapter_event} from "../storage/index.js";

export const running_chat_adapters = new Map<string, any>()
export const chat_adapter_event = new event_emitter()

const exclude_dirs = ["data", "web_api"]
export function chat_adapter_logger(plugin: string, msg: any, type: LoggerType) {
    log_utils.logger("chat_adapter",plugin, msg, type)
}
chat_adapter_event.onAny((event, data) => {
    if (event === "message") {
        const log_message = `[${data.receiver.type}][${data.receiver.channel_name.trimEnd()}][${data.sender.name}] ${data.raw_message}`
        chat_adapter_logger(data.adapter, log_message, "info")
    }
    plugin_handle_adapter_event("chat_adapter", event, data)
    storage_handle_adapter_event("chat_adapter", event, data)
})

/** 加载单个 chat_adapter 目录 */
async function load_chat_adapter_from_dir(dir_path: string) {
    try {
        const config_path = path.join(dir_path, "config.json")
        const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
        if (!config.name) {
            chat_adapter_logger("main", `chat_adapter ${dir_path} 的 config.json 没有name 字段`, "error")
            return
        }
        running_chat_adapters.set(config.name, new Map())
        const start_configs = config.configs
        if (!start_configs) {
            chat_adapter_logger("main", `chat_adapter ${config.name} 的 config.json 没有 configs 字段，跳过初始化`, "info")
            return
        }
        const module_url = pathToFileURL(path.join(dir_path, "index.js")).href + `?t=${Date.now()}`
        const {init} = await import(module_url)
        if (!init) {
            chat_adapter_logger("main", `chat_adapter ${dir_path} 没有 init function`, "error")
            return
        }
        for (const start_config of start_configs) {
            if (!start_config.name) {
                chat_adapter_logger("main", `chat_adapter ${path.basename(dir_path)} configs name is empty`, "error")
                continue
            }
            try {
                const result = new init(start_config)
                result.event.onAny((event: string, data: any) => {
                    chat_adapter_event.emit(event, data)
                })
                running_chat_adapters.get(config.name).set(start_config.name, result)
            } catch (error:any) {
                chat_adapter_logger("main", `chat_adapter ${config.name} 初始化 ${start_config.name} 失败`, "error")
                chat_adapter_logger("main", error.message | error.stack, "error")
            }
        }
    } catch (error:any) {
        chat_adapter_logger("main", String(error.message | error.stack), "error")
    }
}

/** 根据适配器名查找其目录路径 */
function find_chat_adapter_dir(adapter_name: string): string | null {
    const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "chat_adapter"))
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

export async function init_chat_adapter() {
    try {
        const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "chat_adapter"))
        const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
        for (const item of filtered_dir) {
            await load_chat_adapter_from_dir(item)
        }
    } catch (error:any) {
        chat_adapter_logger("main", String(error.message | error.stack), "error")
    }
}

/** 列出正在运行的 chat_adapter */
export function list_chat_adapter(): string[] {
    const lines: string[] = []
    if (running_chat_adapters.size === 0) {
        lines.push("当前没有正在运行的 chat_adapter")
        return lines
    }
    let total = 0
    const detail_lines: string[] = []
    for (const [adapter_name, config_map] of running_chat_adapters) {
        const instance_names = Array.from(config_map.keys())
        const statuses = Array.from(config_map.values()).map((inst: any) => inst.status || "unknown")
        total += instance_names.length
        detail_lines.push(`  - ${adapter_name}（实例: ${instance_names.join(", ")}，状态: ${statuses.join(", ")}）`)
    }
    lines.push(`正在运行的 chat_adapter（共 ${running_chat_adapters.size} 个适配器，${total} 个实例）:`)
    lines.push(...detail_lines)
    return lines
}

/**
 * 重载 chat_adapter。
 * 不带参数时重载全部，带参数时只重载指定名称的适配器。
 */
export async function reload_chat_adapter(adapter_name?: string) {
    if (!adapter_name) {
        // 重载全部
        for (const config_map of running_chat_adapters.values()) {
            for (const instance of config_map.values()) {
                instance.stop?.()
            }
        }
        running_chat_adapters.clear()

        chat_adapter_logger("main", "正在重新加载全部 chat_adapter...", "info")
        await init_chat_adapter()
        chat_adapter_logger("main", "chat_adapter 重载完成", "info")
        return
    }

    // 重载指定适配器
    const dir_path = find_chat_adapter_dir(adapter_name)
    if (!dir_path) {
        chat_adapter_logger("main", `未找到 chat_adapter: ${adapter_name}`, "warn")
        return
    }

    // 卸载旧实例
    const old_config_map = running_chat_adapters.get(adapter_name)
    if (old_config_map) {
        for (const instance of old_config_map.values()) {
            instance.stop?.()
        }
        running_chat_adapters.delete(adapter_name)
    }

    chat_adapter_logger("main", `正在重新加载 chat_adapter ${adapter_name}...`, "info")
    await load_chat_adapter_from_dir(dir_path)
    chat_adapter_logger("main", `chat_adapter ${adapter_name} 重载完成`, "info")
}

export function send_message(adapter: string, instance_name: string, type: "group" | "private", user_id: number, message: any, event:any) {
    const adapter_temp = running_chat_adapters.get(adapter).get(instance_name)
    if (!adapter_temp) {
        chat_adapter_logger("main", `chat_adapter ${adapter} 实例 ${instance_name} 不存在`, "error")
        return
    }
    adapter_temp.send(type, user_id, message, event)
}