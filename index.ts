import express from 'express'
import {log_utils} from "./utils/log_utils.js";
import {init_chat_adapter} from "./chat_adapter/index.js";
import {init_game_adapter} from "./game_adapter/index.js";
import {init_storage} from "./storage/index.js";
import {init_plugin} from "./plugin/index.js";
export const app = express()

async function main(){
    await init_storage()
    await init_plugin()
    await init_chat_adapter()
    await init_game_adapter()
}

(() => main().then(() => {
    log_utils.logger("main", "main", "ChatBot 成功启动")
}))()

