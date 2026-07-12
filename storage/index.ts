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
        storage.event_handler(event, {adapter_platform: adapter, ...data})
    }
}

/** 加载单个 storage 目录 */
async function load_storage_from_dir(dir_path: string) {
    const dir_name = path.basename(dir_path)
    try {
        const module_url = pathToFileURL(path.join(dir_path, "index.js")).href + `?t=${Date.now()}`
        const {init} = await import(module_url)
        const storage = new init()
        storage_logger(dir_name, `成功启动 ${dir_path} storage`, "info")
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
