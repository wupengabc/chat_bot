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

export async function init_game_adapter() {
    try {
        const dir = path_utils.get_path_dir_list(path.join(path_utils.get_project_root_path(), "game_adapter"))
        const filtered_dir = dir.filter(item => !exclude_dirs.includes(path.basename(item)))
        for (const item of filtered_dir) {
            try {
                const config_path = path.join(item, "config.json")
                const config = JSON.parse(fs.readFileSync(config_path, "utf-8"))
                if (!config.name) {
                    game_adapter_logger("main", `game_adapter ${item} 的 config.json 没有name 字段`, "error")
                    continue
                }
                running_game_adapters.set(config.name, new Map())
                const start_configs = config.configs
                if (!start_configs) {
                    game_adapter_logger("main", `game_adapter ${config.name} 的 config.json 没有 configs 字段，跳过初始化`, "info")
                    continue
                }
                const {init} = await import(pathToFileURL(path.join(item, "index.js")).href)
                if (!init) {
                    game_adapter_logger("main", `game_adapter ${item} 没有 init function`, "error")
                    continue
                }
                for (const start_config of start_configs) {
                    if (!start_config.name) {
                        game_adapter_logger("main", `game_adapter ${path.basename(item)} configs name is empty`, "error")
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
    } catch (error:any) {
        game_adapter_logger("main", String(error.message | error.stack), "error")
    }
}

export function get_game_adapter(adapter_name: string, config_name: string) {
    return running_game_adapters.get(adapter_name)?.get(config_name)
}