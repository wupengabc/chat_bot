import {path_utils} from "../utils/path_utils.js";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {log_utils, LoggerType} from "../utils/log_utils.js";

const running_storage = new Map<string, any>()
const exclude_dirs = ["web_api", "data"]

export function storage_logger(plugin: string, msg: string, type: LoggerType) {
    log_utils.logger("storage",plugin, msg, type)
}

export function storage_handle_adapter_event(adapter: string, event: string, data: any) {
    for (const [plugin, storage] of running_storage) {
        try {
            storage.event_handler(event, {adapter_platform: adapter, ...data})
        } catch (error) {
            storage_logger(plugin, `storage ${plugin} 处理事件 ${event} 时出错: ${error}`, "error")
        }
    }
}

/** 加载单个 storage 目录 */
async function load_storage_from_dir(dir_path: string) {
    const dir_name = path.basename(dir_path)
    try {
        const module_url = pathToFileURL(path.join(dir_path, "index.js")).href + `?t=${Date.now()}`
        const {init} = await import(module_url)
        const storage = new init()
        storage_logger(dir_name, `成功启动 ${path.basename(dir_path)} storage`, "info")
        running_storage.set(dir_name, storage)
    } catch (error) {
        storage_logger(dir_name, `失败启动 ${dir_path} storage: ${error}`, "error")
    }
}

/** 根据 storage 名查找其目录路径 */
function find_storage_dir(storage_name: string): string | null {
    const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "storage"))
    const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
    for (const item of filtered_dir) {
        if (path.basename(item) === storage_name) {
            return item
        }
    }
    return null
}

export async function init_storage() {
    const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "storage"))
    const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
    for (const item of filtered_dir) {
        await load_storage_from_dir(item)
    }
}

/** 列出正在运行的 storage */
export function list_storage(): string[] {
    const lines: string[] = []
    if (running_storage.size === 0) {
        lines.push("当前没有正在运行的 storage")
        return lines
    }
    lines.push(`正在运行的 storage（共 ${running_storage.size} 个）:`)
    for (const name of running_storage.keys()) {
        lines.push(`  - ${name}`)
    }
    return lines
}

/**
 * 重载 storage。
 * 不带参数时重载全部，带参数时只重载指定名称的 storage。
 */
export async function reload_storage(storage_name?: string) {
    if (!storage_name) {
        // 重载全部
        for (const [name, storage] of running_storage) {
            storage.on_unload?.()
            storage_logger(name, `已卸载 storage`, "info")
        }
        running_storage.clear()

        storage_logger("main", "正在重新加载全部 storage...", "info")
        await init_storage()
        storage_logger("main", "storage 重载完成", "info")
        return
    }

    // 重载指定 storage
    const dir_path = find_storage_dir(storage_name)
    if (!dir_path) {
        storage_logger("main", `未找到 storage: ${storage_name}`, "warn")
        return
    }

    // 卸载旧实例
    const old_storage = running_storage.get(storage_name)
    if (old_storage) {
        old_storage.on_unload?.()
        running_storage.delete(storage_name)
    }

    storage_logger(storage_name, `正在重新加载 storage ${storage_name}...`, "info")
    await load_storage_from_dir(dir_path)
    storage_logger(storage_name, `storage ${storage_name} 重载完成`, "info")
}

export function get_storage(plugin: string) {
    return running_storage.get(plugin)
}

/**
 * 执行 storage 的控制台命令
 * @param storage_name storage 名称
 * @param command_name 命令名称
 * @param args 命令参数
 */
export function exec_storage_command(storage_name: string, command_name: string, args: string[]): string {
    const storage = running_storage.get(storage_name)
    if (!storage) {
        return `未找到 storage: ${storage_name}`
    }
    
    if (!storage.console_commands) {
        return `storage ${storage_name} 没有注册任何控制台命令`
    }
    
    const command = storage.console_commands[command_name]
    if (!command) {
        const available = Object.keys(storage.console_commands).join(", ")
        return `storage ${storage_name} 没有命令 ${command_name}。可用命令: ${available}`
    }
    
    try {
        return command.handler(args)
    } catch (error: any) {
        return `执行命令失败: ${error.message}`
    }
}

/**
 * 列出 storage 的可用控制台命令
 */
export function list_storage_commands(storage_name: string): string[] {
    const storage = running_storage.get(storage_name)
    if (!storage) {
        return [`未找到 storage: ${storage_name}`]
    }
    
    if (!storage.console_commands) {
        return [`storage ${storage_name} 没有注册任何控制台命令`]
    }
    
    const lines: string[] = []
    lines.push(`storage ${storage_name} 的可用命令:`)
    for (const [cmd_name, cmd] of Object.entries(storage.console_commands)) {
        const cmd_obj = cmd as any
        lines.push(`  - ${cmd_name} ${cmd_obj.args?.join(" ") || ""} - ${cmd_obj.description || "无描述"}`)
    }
    return lines
}

