import express from 'express'
import * as readline from 'node:readline'
import {log_utils} from "./utils/log_utils.js";
import {init_chat_adapter} from "./chat_adapter/index.js";
import {init_game_adapter} from "./game_adapter/index.js";
import {init_storage} from "./storage/index.js";
import {init_plugin, reload_all_plugin} from "./plugin/index.js";
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

        if (line === '/reload_plugins') {
            await reload_all_plugin()
            return
        }

        log_utils.logger("console", "main", `未知命令: ${line}`, "warn")
    })
}

(() => main().then(() => {
    log_utils.logger("main", "main", "ChatBot 成功启动")
}))()

