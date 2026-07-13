import { help } from "../../type.js";
import {get_chat_adapter_prefix, plugin_logger, acquire_plugin_lock, release_plugin_lock} from "../../index.js";
import {get_game_adapter} from "../../../game_adapter/index.js";
import {Structs} from "node-napcat-ts";
import {send_message} from "../../../chat_adapter/index.js";
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const { renderPlayerList } = await import(utilsUrl.href)

export class init {
    public help: help = {
        name: "player_list",
        keyword: "player",
        description: "显示在线玩家列表",
        permission: 0,
        args: [],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword
    constructor() {}
    event_handler(event: any, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.split(" ")[0] === this.command_start) {
                const user_id = data.sender.user_id.toString()
                if (!acquire_plugin_lock(user_id)) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("请等待当前操作完成后再试")], data.origin_object)
                    return
                }
                try {
                    const bot_instance = get_game_adapter("mineflayer", "bangxi")
                    if (bot_instance.status !== "running") {
                        const message = [Structs.at(data.sender.user_id), Structs.text("Bot 暂未连接至服务器")]
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, message, data.origin_object)
                    } else {
                        try {
                            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id), Structs.text("正在开始获取玩家列表...")], data.origin_object)
                            // @ts-ignore
                            const player_list = Object.values(bot_instance.bot.players).map(player => {
                                return {
                                    // @ts-ignore
                                    name: player.displayName.toString(),
                                    // @ts-ignore
                                    ping: player.ping.toString(),
                                }
                            })
                            const message = [Structs.at(data.sender.user_id), Structs.image(renderPlayerList(player_list))]
                            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, message, data.origin_object)
                        } catch (error:any) {
                            plugin_logger("player_list", error.message || error.toString(), "error")
                            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id), Structs.text("获取玩家列表失败")], data.origin_object)
                        }
                    }
                } finally {
                    release_plugin_lock(user_id)
                }
            }
        }
    }
}