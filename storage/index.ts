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
        storage.event_handler(event, {adapter, ...data})
    }
}

export async function init_storage() {
    const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "storage"))
    const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
    for (const item of filtered_dir) {
        try {
            const {init} = await import(pathToFileURL(path.join(item, "index.js")).href)
            const storage = new init()
            storage_logger(path.basename(item), `成功启动 ${item} storage`, "info")
            running_storage.set(path.basename(item), storage)
        } catch (error) {
            storage_logger(path.basename(item), `失败启动 ${item} storage: ${error}`, "error")
        }
    }
}
