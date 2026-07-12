import express from 'express'
import * as readline from 'node:readline'
import {log_utils} from "./utils/log_utils.js";
import {init_chat_adapter, reload_chat_adapter, list_chat_adapter} from "./chat_adapter/index.js";
import {init_game_adapter, reload_game_adapter, list_game_adapter} from "./game_adapter/index.js";
import {init_storage, reload_storage, list_storage} from "./storage/index.js";
import {init_plugin, reload_plugin, list_plugin} from "./plugin/index.js";
export const app = express()

async function main(){
    await init_storage()
    await init_plugin()
    await init_chat_adapter()
    await init_game_adapter()
    init_console()
}

function init_console() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
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
                } else {
                    log_utils.logger("console", "main", `未知操作: ${action || "(空)"}，可用: reload, list`, "warn")
                }
                return
            case '/storage':
                if (action === 'reload') {
                    await reload_storage(arg)
                } else if (action === 'list') {
                    for (const l of list_storage()) {
                        log_utils.logger("console", "storage", l, "info")
                    }
                } else {
                    log_utils.logger("console", "main", `未知操作: ${action || "(空)"}，可用: reload, list`, "warn")
                }
                return
        }

        log_utils.logger("console", "main", `未知命令: ${line}`, "warn")
        log_utils.logger("console", "main", `可用命令: /plugin|/chat|/game|/storage reload|list [name]`, "info")
    })
}

(() => main().then(() => {
    log_utils.logger("main", "main", "ChatBot 成功启动")
}))()
