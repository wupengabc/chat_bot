import {get_chat_adapter_prefix} from "../../index.js";
import { help } from "../../type.js";
import {send_message} from "../../../chat_adapter/index.js";
import {Structs} from "node-napcat-ts";
import {get_game_adapter} from "../../../game_adapter/index.js";
import {get_storage} from "../../../storage/index.js";
import {loadAvatarImage} from "../../../service/minecraft_service/index.js";
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const { renderPlayerMoney } = await import(utilsUrl.href)

interface PendingTask {
    game_instance: any
    listener: (data: any) => void
    timer: ReturnType<typeof setTimeout>
}

export class init {
    public help:help = {
        name: "money",
        keyword: "money",
        description: "查询玩家金币数量",
        permission: 0,
        args: ["玩家名"],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword

    /** 所有正在进行的查询任务，用于 on_unload 时统一清理 */
    private pending_tasks: PendingTask[] = []

    constructor() {
    }

    on_unload() {
        for (const task of this.pending_tasks) {
            clearTimeout(task.timer)
            task.game_instance.event.off("message", task.listener)
        }
        this.pending_tasks.length = 0
    }

    event_handler(event: string, data: { adapter_platform: any; raw_message: string; sender: { user_id: any; id: any; }; adapter: any; instance_name: any; receiver: { type: any; }; origin_object: any; }) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.startsWith(this.command_start)) {
                const player_name = data.raw_message.split(" ")[1]
                if (!player_name) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id),Structs.text("请输入玩家名")], data.origin_object)
                    return
                }
                const game_instance_temp = get_game_adapter("mineflayer", "bangxi")
                if (game_instance_temp.status !== "running") {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id),Structs.text("Bot暂未连接至服务器")], data.origin_object)
                    return
                }
                const bot_temp = game_instance_temp.bot

                let settled = false

                const on_message = async (game_data: any) => {
                    if (settled) return
                    if (game_data.position !== "system") return
                    const plain_text: string = game_data.message.plainText
                    if (!plain_text.includes("[邦溪]")) return

                    // 账号不存在: [邦溪] 目标帐号不存在
                    if (plain_text.includes("目标帐号不存在")) {
                        settled = true
                        clearTimeout(timer)
                        game_instance_temp.event.off("message", on_message)
                        remove_pending()
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text(`玩家 ${player_name} 不存在`)], data.origin_object)
                        return
                    }

                    // 余额查询: [邦溪] 查询7728的余额: 902.39 金币
                    const match = plain_text.match(/查询(.+?)的余额:\s*([\d,.]+)\s*金币/)
                    if (match && match[1] === player_name) {
                        settled = true
                        clearTimeout(timer)
                        game_instance_temp.event.off("message", on_message)
                        remove_pending()
                        const amount = match[2].split(",").join("")
                        const storage = get_storage("bangxi_server_storage")
                        if (storage) {
                            storage.insert_money_history(player_name, amount)
                        }
                        const avatar_buffer = await loadAvatarImage(player_name)
                        const image_buffer = renderPlayerMoney({
                            avatar: avatar_buffer,
                            username: player_name,
                            amount: amount
                        })
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.image(image_buffer)], data.origin_object)
                    }
                }

                const timer = setTimeout(() => {
                    if (settled) return
                    settled = true
                    game_instance_temp.event.off("message", on_message)
                    remove_pending()
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("查询超时，请稍后重试")], data.origin_object)
                }, 5000)

                const task: PendingTask = { game_instance: game_instance_temp, listener: on_message, timer }
                this.pending_tasks.push(task)

                const remove_pending = () => {
                    const idx = this.pending_tasks.indexOf(task)
                    if (idx >= 0) this.pending_tasks.splice(idx, 1)
                }

                game_instance_temp.event.on("message", on_message)
                bot_temp.chat(`/money ${player_name}`)
            }
        }
    }
}
