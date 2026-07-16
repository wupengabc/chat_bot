import {get_chat_adapter_prefix, acquire_plugin_lock, release_plugin_lock} from "../../index.js";
import { help } from "../../type.js";
import {get_game_adapter} from "../../../game_adapter/index.js";
import {send_message} from "../../../chat_adapter/index.js";
import {Structs} from "node-napcat-ts";
import {get_storage} from "../../../storage/index.js";
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const { renderServerMoneyRanking } = await import(utilsUrl.href)

interface PendingTask {
    cleanup: () => void
    user_id: string
}

export class init {
    public help:help = {
        name: "baltop",
        keyword: "baltop",
        description: "查询服务器金币排行榜",
        permission: 0,
        args: [{ key: "页码", description: "可选，默认 1", permission: 0, args: [] }],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword

    /** 所有正在进行的查询任务，用于 on_unload 时统一清理 */
    private pending_tasks: PendingTask[] = []

    constructor() {
    }

    on_unload() {
        for (const task of this.pending_tasks) {
            task.cleanup()
            release_plugin_lock(task.user_id, 0)
        }
        this.pending_tasks.length = 0
    }

    event_handler(event: string, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.split(" ")[0] === this.command_start) {
                const user_id = data.sender.user_id.toString()
                if (!acquire_plugin_lock(user_id)) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("请等待当前操作完成后再试")], data.origin_object)
                    return
                }
                const page_str = data.raw_message.split(" ")[1] || "1"
                const page = parseInt(page_str)
                if (isNaN(page) || page < 1 || page > 2) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("页码无效，请输入1或2")], data.origin_object)
                    release_plugin_lock(user_id)
                    return
                }
                const game_instance = get_game_adapter("mineflayer", "bangxi")
                if (game_instance.status !== "running") {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("Bot暂未连接至服务器")], data.origin_object)
                    release_plugin_lock(user_id)
                    return
                }

                send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                    [Structs.at(data.sender.user_id), Structs.text("正在开始查询金币排行榜，请稍候...")], data.origin_object)

                let settled = false
                const collected_lines: string[] = []
                let timer: ReturnType<typeof setTimeout>

                const task: PendingTask = { cleanup: () => {}, user_id }
                this.pending_tasks.push(task)

                const remove_pending = () => {
                    const idx = this.pending_tasks.indexOf(task)
                    if (idx >= 0) this.pending_tasks.splice(idx, 1)
                    release_plugin_lock(user_id)
                }

                const cleanup = () => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    game_instance.event.off("message", on_message)
                    remove_pending()
                }

                task.cleanup = cleanup

                const finish = () => {
                    if (settled) return
                    cleanup()

                    // 解析收集到的消息行
                    let header = ""
                    let total_amount = ""
                    const players: { rank: number; name: string; amount: string }[] = []

                    for (const line of collected_lines) {
                        // 页头: ========= 金币排行榜 <第 1/2 页> =========
                        const header_match = line.match(/={3,}\s*金币排行榜.*<第\s*(\d+)\/(\d+)\s*页>\s*={3,}/)
                        if (header_match) {
                            header = line
                            continue
                        }
                        // 总金额: 服务器总金额 - 244,088,059.89 金币
                        const total_match = line.match(/服务器总金额\s*-\s*([\d,.]+)\s*金币/)
                        if (total_match) {
                            total_amount = total_match[1]
                            continue
                        }
                        // 玩家行: 1. [ALiQvQ] -> 5,020,393.27 金币
                        const player_match = line.match(/(\d+)\.\s*\[([^\]]+)\]\s*->\s*([\d,.]+)\s*金币/)
                        if (player_match) {
                            players.push({
                                rank: parseInt(player_match[1]),
                                name: player_match[2],
                                amount: player_match[3]
                            })
                        }
                    }

                    if (players.length === 0) {
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text("未获取到排行榜数据，请稍后重试")], data.origin_object)
                        return
                    }

                    // 将每个玩家的金币数据插入 money_history
                    const storage = get_storage("bangxi_server_storage")
                    if (storage) {
                        for (const player of players) {
                            const amount = player.amount.split(",").join("")
                            storage.insert_money_history(player.name, amount)
                        }
                    }
                    try {
                        const image_buffer = renderServerMoneyRanking(total_amount, players)
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.image(image_buffer)], data.origin_object)
                    } catch (e) {
                        console.error(e)
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text("查询失败，请稍后重试")], data.origin_object)
                    }
                }

                const on_message = (game_data: any) => {
                    if (settled) return
                    if (game_data.position !== "system") return
                    const plain_text: string = game_data.message.plainText

                    // 判断是否为 baltop 相关消息
                    const is_header = plain_text.includes("金币排行榜")
                    const is_total = plain_text.includes("服务器总金额")
                    const is_player = /\d+\.\s*\[.+?\]\s*->\s*[\d,.]+\s*金币/.test(plain_text)

                    if (!is_header && !is_total && !is_player) return

                    collected_lines.push(plain_text)

                    // 重置防抖定时器：收到最后一条匹配消息后 1.5 秒无新消息则处理
                    clearTimeout(timer)
                    timer = setTimeout(finish, 1500)
                }

                // 整体超时：10 秒内未收到任何匹配消息则超时
                timer = setTimeout(() => {
                    if (settled) return
                    cleanup()
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("查询超时，请稍后重试")], data.origin_object)
                }, 10000)

                game_instance.event.on("message", on_message)
                game_instance.send_message("/baltop " + page)
            }
        }
    }
}
