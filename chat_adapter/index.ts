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

export async function init_chat_adapter() {
    try {
        const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "chat_adapter"))
        const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
        for (const item of filtered_dir) {
            try {
                const config_path = path.join(item, "config.json")
                const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
                if (!config.name) {
                    chat_adapter_logger("main", `chat_adapter ${item} 的 config.json 没有name 字段`, "error")
                    continue
                }
                running_chat_adapters.set(config.name, new Map())
                const start_configs = config.configs
                if (!start_configs) {
                    chat_adapter_logger("main", `chat_adapter ${config.name} 的 config.json 没有 configs 字段，跳过初始化`, "info")
                    continue
                }
                const {init} = await import(pathToFileURL(path.join(item, "index.js")).href)
                if (!init) {
                    chat_adapter_logger("main", `chat_adapter ${item} 没有 init function`, "error")
                    continue
                }
                for (const start_config of start_configs) {
                    if (!start_config.name) {
                        chat_adapter_logger("main", `chat_adapter ${path.basename(item)} configs name is empty`, "error")
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
                chat_adapter_logger("main", error.message | error.stack, "error")
            }
        }
    } catch (error:any) {
        chat_adapter_logger("main", error.message | error.stack, "error")
    }
}

export function send_message(adapter: string, instance_name: string, type: "group" | "private", user_id: number, message: any, event:any) {
    const adapter_temp = running_chat_adapters.get(adapter).get(instance_name)
    if (!adapter_temp) {
        chat_adapter_logger("main", `chat_adapter ${adapter} 实例 ${instance_name} 不存在`, "error")
        return
    }
    adapter_temp.send(type, user_id, message, event)
}