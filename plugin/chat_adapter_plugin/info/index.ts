import {get_chat_adapter_prefix, acquire_plugin_lock, release_plugin_lock} from "../../index.js";
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
const { renderPlayerCardPng } = await import(utilsUrl.href)

interface PendingTask {
    game_instance: any
    listener: (data: any) => void
    timer: ReturnType<typeof setTimeout>
    user_id: string
}

export class init {
    public help: help = {
        name: "info",
        keyword: "info",
        description: "获取玩家详细信息",
        permission: 0,
        args: ["玩家名(可选, 默认查询自己)"],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword

    private pending_tasks: PendingTask[] = []

    constructor() {}

    on_unload() {
        for (const task of this.pending_tasks) {
            clearTimeout(task.timer)
            task.game_instance.event.off("message", task.listener)
            release_plugin_lock(task.user_id, 0)
        }
        this.pending_tasks.length = 0
    }

    event_handler(event: string, data: { adapter_platform: any; raw_message: string; sender: { user_id: any; id: any; }; adapter: any; instance_name: any; receiver: { type: any; }; origin_object: any; }) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.split(" ")[0] === this.command_start) {
                const user_id = data.sender.user_id.toString()
                if (!acquire_plugin_lock(user_id)) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("请等待当前操作完成后再试")], data.origin_object)
                    return
                }

                // 获取绑定游戏ID
                const user_storage = get_storage("chat_permission_storage")
                const bound_game_id = user_storage?.get_user_info(user_id)?.game_id || ""

                let player_name = data.raw_message.split(" ")[1]
                if (!player_name) {
                    if (!user_storage) {
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text("请输入玩家名")], data.origin_object)
                        release_plugin_lock(user_id)
                        return
                    }
                    player_name = bound_game_id
                    if (!player_name) {
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text("你暂未绑定游戏id, 查询信息请输入玩家名")], data.origin_object)
                        release_plugin_lock(user_id)
                        return
                    }
                }

                // 判断查自己还是查别人，计算费用
                const is_self = bound_game_id && player_name.toLowerCase() === bound_game_id.toLowerCase()
                const cost = is_self ? 50 : 100

                // 积分检查
                const storage = get_storage("bangxi_server_storage")
                if (storage && bound_game_id) {
                    const point_check = storage.check_point(bound_game_id, cost)
                    if (!point_check.status) {
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text(`积分不足，查询${is_self ? "自己" : "他人"}需要${cost}积分，当前余额: ${point_check.point.toFixed(2)}`)], data.origin_object)
                        release_plugin_lock(user_id)
                        return
                    }
                } else if (!bound_game_id) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("你暂未绑定游戏id，无法扣除积分，请先绑定")], data.origin_object)
                    release_plugin_lock(user_id)
                    return
                }

                send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                    [Structs.at(data.sender.user_id), Structs.text(`正在查询玩家信息...（本次消耗${cost}积分）`)], data.origin_object)

                const game_instance = get_game_adapter("mineflayer", "bangxi")

                if (game_instance.status === "running") {
                    this.query_realtime(data, player_name, user_id, game_instance, storage, bound_game_id, cost)
                } else {
                    this.query_history(data, player_name, user_id, storage, bound_game_id, cost)
                }
            }
        }
    }

    /** Bot 在线：通过 /money 命令实时获取 */
    private query_realtime(data: any, player_name: string, user_id: string, game_instance: any, storage: any, billing_username: string, cost: number) {
        let settled = false

        const on_message = async (game_data: any) => {
            if (settled) return
            if (game_data.position !== "system") return
            const plain_text: string = game_data.message.plainText
            if (!plain_text.includes("[邦溪]")) return

            // 账号不存在
            if (plain_text.includes("目标帐号不存在")) {
                settled = true
                clearTimeout(timer)
                game_instance.event.off("message", on_message)
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
                game_instance.event.off("message", on_message)
                remove_pending()

                const amount = match[2].split(",").join("")

                // 插入 money_history
                if (storage) {
                    storage.insert_money_history(player_name, amount)
                }

                // 获取用户信息
                const user_info = storage?.get_user_info(player_name) || null

                console.log("[info] 实时查询数据:", {
                    username: player_name,
                    money: amount,
                    user_info,
                })

                // 判断是否在线
                const is_online = this.check_player_online(game_instance, player_name)

                // 扣除积分
                if (storage && billing_username) {
                    storage.del_point(billing_username, cost)
                }

                await this.render_and_send(data, player_name, amount, "realtime", undefined, user_info, is_online, billing_username, cost, storage)
            }
        }

        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            game_instance.event.off("message", on_message)
            remove_pending()
            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("查询超时，请稍后重试")], data.origin_object)
        }, 5000)

        const task: PendingTask = { game_instance, listener: on_message, timer, user_id }
        this.pending_tasks.push(task)

        const remove_pending = () => {
            const idx = this.pending_tasks.indexOf(task)
            if (idx >= 0) this.pending_tasks.splice(idx, 1)
            release_plugin_lock(user_id)
        }

        game_instance.event.on("message", on_message)
        game_instance.send_message(`/money ${player_name}`)
    }

    /** Bot 离线：从 money_history 获取最新记录 */
    private query_history(data: any, player_name: string, user_id: string, storage: any, billing_username: string, cost: number) {
        if (!storage) {
            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("存储服务不可用")], data.origin_object)
            release_plugin_lock(user_id)
            return
        }

        const user_info = storage.get_user_info(player_name)
        if (!user_info) {
            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`玩家 ${player_name} 不存在`)], data.origin_object)
            release_plugin_lock(user_id)
            return
        }

        const money_history = user_info.money_history as { money: unknown, timestamp: string }[]
        if (!money_history || money_history.length === 0) {
            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`玩家 ${player_name} 暂无金币历史记录`)], data.origin_object)
            release_plugin_lock(user_id)
            return
        }

        const latest = money_history[money_history.length - 1]
        const amount = String(latest.money).split(",").join("")

        console.log("[info] 历史查询数据:", {
            username: player_name,
            money: amount,
            money_time: latest.timestamp,
            user_info,
        })

        // 扣除积分
        if (storage && billing_username) {
            storage.del_point(billing_username, cost)
        }

        release_plugin_lock(user_id)

        this.render_and_send(data, player_name, amount, "history", latest.timestamp, user_info, null, billing_username, cost, storage)
    }

    /** 通过 bot.players 判断玩家是否在线（大小写不敏感） */
    private check_player_online(game_instance: any, player_name: string): boolean {
        try {
            if (!game_instance?.bot?.players) return false
            const players = game_instance.bot.players
            const lower_name = player_name.toLowerCase()
            return Object.keys(players).some(key => key.toLowerCase() === lower_name)
        } catch {
            return false
        }
    }

    /** 渲染图片并发送 */
    private async render_and_send(data: any, player_name: string, amount: string, source: "realtime" | "history", money_time: string | undefined, user_info: any, is_online: boolean | null, billing_username: string, cost: number, storage: any) {
        const avatar_buffer = await loadAvatarImage(player_name)

        const recent_messages = storage?.get_recent_messages(player_name, 3) ?? []

        const info_data = {
            avatar: avatar_buffer,
            username: player_name,
            money: amount,
            point: user_info?.point ?? 0,
            message_count: user_info?.message_count ?? 0,
            online_time: user_info?.online_time ?? 0,
            role: user_info?.role ?? "member",
            first_record_time: user_info?.first_record_time ?? user_info?.create_time ?? new Date().toISOString(),
            address_list: user_info?.address_list ?? [],
            last_join_time: user_info?.last_join_time ?? null,
            last_leave_time: user_info?.last_leave_time ?? null,
            recent_messages,
            money_history: user_info?.money_history ?? [],
            money_source: source,
            money_time,
            is_online,
        }

        const image_buffer = renderPlayerCardPng(info_data)
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.image(image_buffer)], data.origin_object)

        // 发送扣分提示
        if (storage && billing_username) {
            const remaining = storage.check_point(billing_username, 0)
            send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`已扣除${cost}积分，剩余: ${remaining.point.toFixed(2)}`)], data.origin_object)
        }
    }
}
