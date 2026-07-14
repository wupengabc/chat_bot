import express from 'express'
import * as readline from 'node:readline'
import {log_utils} from "./utils/log_utils.js";
import {init_chat_adapter, reload_chat_adapter, list_chat_adapter, running_chat_adapters} from "./chat_adapter/index.js";
import {init_game_adapter, reload_game_adapter, list_game_adapter, exec_game_adapter_command, list_game_adapter_commands, running_game_adapters} from "./game_adapter/index.js";
import {init_storage, reload_storage, list_storage, exec_storage_command, list_storage_commands, get_storage_names, get_storage_command_names} from "./storage/index.js";
import {init_plugin, reload_plugin, list_plugin, get_plugin_names} from "./plugin/index.js";
export const app = express()

async function main(){
    await init_storage()
    await init_plugin()
    await init_chat_adapter()
    await init_game_adapter()
    init_console()
}

function consoleCompleter(line: string): [string[], string] {
    const trailingSpace = /\s$/.test(line)
    const parts = line.trimStart().split(/\s+/)
    if (line.trim().length === 0) parts.length = 0
    if (trailingSpace) parts.push("")
    const fragment = parts[parts.length - 1] ?? ""
    const position = parts.length - 1
    const module = parts[0]
    const action = parts[1]
    let candidates: string[] = []

    if (position === 0) {
        candidates = ["/plugin", "/chat", "/game", "/storage"]
    } else if (position === 1) {
        candidates = module === "/plugin" || module === "/chat"
            ? ["reload", "list"]
            : module === "/game" || module === "/storage"
                ? ["reload", "list", "select"]
                : []
    } else if (module === "/plugin" && action === "reload" && position === 2) {
        candidates = get_plugin_names()
    } else if (module === "/chat" && action === "reload" && position === 2) {
        candidates = Array.from(running_chat_adapters.keys())
    } else if (module === "/game") {
        const adapterNames = Array.from(running_game_adapters.keys()) as string[]
        if ((action === "reload" || action === "select") && position === 2) {
            candidates = adapterNames
        } else if (action === "select" && position === 3) {
            candidates = ["config"]
        } else if (action === "select" && position === 4) {
            candidates = Array.from(running_game_adapters.get(parts[2])?.keys() ?? []) as string[]
        } else if (action === "select" && position === 5) {
            const instance = running_game_adapters.get(parts[2])?.get(parts[4])
            candidates = instance?.console_commands ? Object.keys(instance.console_commands) : []
        }
    } else if (module === "/storage") {
        if ((action === "reload" || action === "select") && position === 2) {
            candidates = get_storage_names()
        } else if (action === "select" && position === 3) {
            candidates = get_storage_command_names(parts[2])
        } else if (action === "select" && parts[3] === "change_permission" && position === 5) {
            candidates = ["member", "admin", "owner"]
        }
    }

    const hits = candidates.filter(candidate => candidate.startsWith(fragment)).sort()
    return [hits.length > 0 ? hits : candidates.sort(), fragment]
}

function init_console() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: consoleCompleter,
    })

    log_utils.bindReadline(rl)

    rl.on('line', async (input: string) => {
        const line = input.trim()
        if (!line) return

        const parts = line.split(/\s+/)
        const module = parts[0]   // /plugin /chat /game /storage
        const action = parts[1]   // reload list
        const arg = parts[2]      // 可选名称

        switch (module) {
            case '/plugin':
                if (action === 'reload') {
                    await reload_plugin(arg)
                } else if (action === 'list') {
                    for (const l of list_plugin()) {
                        log_utils.logger("console", "plugin", l, "info")
                    }
                } else {
                    log_utils.logger("console", "main", `未知操作: ${action || "(空)"}，可用: reload, list`, "warn")
                }
                return
            case '/chat':
                if (action === 'reload') {
                    await reload_chat_adapter(arg)
                } else if (action === 'list') {
                    for (const l of list_chat_adapter()) {
                        log_utils.logger("console", "chat_adapter", l, "info")
                    }
                } else {
                    log_utils.logger("console", "main", `未知操作: ${action || "(空)"}，可用: reload, list`, "warn")
                }
                return
            case '/game':
                if (action === 'reload') {
                    await reload_game_adapter(arg)
                } else if (action === 'list') {
                    for (const l of list_game_adapter()) {
                        log_utils.logger("console", "game_adapter", l, "info")
                    }
                } else if (action === 'select') {
                    // /game select <adapter_name> config <config_name> <command> [args...]
                    const adapter_name = arg
                    const config_keyword = parts[3]
                    const config_name = parts[4]
                    const command = parts[5]
                    const command_args = parts.slice(6)
                    
                    if (!adapter_name) {
                        log_utils.logger("console", "main", `请指定 game_adapter 名称`, "warn")
                        return
                    }
                    
                    if (config_keyword !== "config") {
                        log_utils.logger("console", "main", `用法: /game select <adapter> config <instance> [command] [args]`, "warn")
                        return
                    }
                    
                    if (!config_name) {
                        log_utils.logger("console", "main", `请指定配置实例名称`, "warn")
                        return
                    }
                    
                    if (!command) {
                        // 列出该实例的可用命令
                        for (const l of list_game_adapter_commands(adapter_name, config_name)) {
                            log_utils.logger("console", "game_adapter", l, "info")
                        }
                        return
                    }
                    
                    const result = exec_game_adapter_command(adapter_name, config_name, command, command_args)
                    log_utils.logger("console", "game_adapter", result, "info")
                } else {
                    log_utils.logger("console", "main", `未知操作: ${action || "(空)"}，可用: reload, list, select`, "warn")
                }
                return
            case '/storage':
                if (action === 'reload') {
                    await reload_storage(arg)
                } else if (action === 'list') {
                    for (const l of list_storage()) {
                        log_utils.logger("console", "storage", l, "info")
                    }
                } else if (action === 'select') {
                    // /storage select <storage_name> <command> [args...]
                    const storage_name = arg
                    const command = parts[3]
                    const command_args = parts.slice(4)
                    
                    if (!storage_name) {
                        log_utils.logger("console", "main", `请指定 storage 名称`, "warn")
                        return
                    }
                    
                    if (!command) {
                        // 列出该 storage 的可用命令
                        for (const l of list_storage_commands(storage_name)) {
                            log_utils.logger("console", "storage", l, "info")
                        }
                        return
                    }
                    
                    const result = exec_storage_command(storage_name, command, command_args)
                    log_utils.logger("console", "storage", result, "info")
                } else {
                    log_utils.logger("console", "main", `未知操作: ${action || "(空)"}，可用: reload, list, select`, "warn")
                }
                return
        }

        log_utils.logger("console", "main", `未知命令: ${line}`, "warn")
        log_utils.logger("console", "main", `可用命令: /plugin|/chat|/game|/storage reload|list|select [name]`, "info")
    })
}

(() => main().then(() => {
    log_utils.logger("main", "main", "ChatBot 成功启动")
}))()

process.on("uncaughtException", (error)=>{
    console.log(error)
} )

process.on("unhandledRejection", (reason, promise)=>{
    console.log(reason, promise)
} )
