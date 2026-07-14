import {acquire_plugin_lock, get_chat_adapter_prefix, release_plugin_lock} from "../../index.js"
import {help} from "../../type.js"
import {send_message} from "../../../chat_adapter/index.js"
import {get_storage} from "../../../storage/index.js"
import {Structs} from "node-napcat-ts"

interface SignReward {
    point: number
    probability: number
}

interface PointConfig {
    name: string
    sign_rewards: SignReward[]
}

export class init {
    public help: help = {
        name: "point",
        keyword: "point",
        description: "查询、管理积分及每日签到",
        permission: 0,
        args: ["get | sign [get] | add <game_id> <num> <reason> | delete <game_id> <num> <reason>"],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword
    private sign_rewards: SignReward[]

    constructor(config: PointConfig) {
        this.sign_rewards = config.sign_rewards
        this.validate_sign_rewards()
    }

    event_handler(_event: string, data: any) {
        if (data.adapter_platform !== "chat_adapter") return
        const args = data.raw_message.trim().split(/\s+/)
        if (args[0] !== this.command_start) return

        const user_id = data.sender.user_id.toString()
        if (!acquire_plugin_lock(user_id)) {
            this.reply(data, "请等待当前操作完成后再试")
            return
        }

        try {
            this.handle_command(data, args, user_id)
        } catch (error: any) {
            this.reply(data, `积分操作失败: ${error.message || error}`)
        } finally {
            release_plugin_lock(user_id)
        }
    }

    private handle_command(data: any, args: string[], user_id: string) {
        const action = args[1]?.toLowerCase()
        if (!action) {
            this.reply(data, "用法: point get | point sign [get] | point add/delete <game_id> <num> <reason>")
            return
        }

        const point_storage = get_storage("bangxi_server_storage")
        const permission_storage = get_storage("chat_permission_storage")
        if (!point_storage || !permission_storage) {
            this.reply(data, "积分系统未初始化")
            return
        }

        if (action === "get") {
            const game_id = this.get_bound_game_id(permission_storage, user_id)
            if (!game_id) return this.reply(data, "你暂未绑定游戏id，请先绑定")
            const result = point_storage.get_point_balance(game_id)
            if (!result.success) return this.reply(data, result.message)
            return this.reply(data, `玩家 ${result.game_id} 当前拥有 ${this.format_point(result.point)} point`)
        }

        if (action === "sign") {
            if (args[2]?.toLowerCase() === "get") return this.reply(data, this.format_probability_table())
            if (args.length > 2) return this.reply(data, "用法: point sign 或 point sign get")
            const game_id = this.get_bound_game_id(permission_storage, user_id)
            if (!game_id) return this.reply(data, "你暂未绑定游戏id，请先绑定")
            const reward = this.draw_reward()
            const result = point_storage.sign_point(game_id, reward, this.get_shanghai_date())
            if (!result.success) return this.reply(data, result.message)
            return this.reply(data, `签到成功，获得 ${this.format_point(result.reward_point)} point\n当前余额：${this.format_point(result.point)} point`)
        }

        if (action !== "add" && action !== "delete") {
            this.reply(data, "未知操作，可用操作: get / sign / add / delete")
            return
        }

        const operator_game_id = this.get_bound_game_id(permission_storage, user_id)
        if (!operator_game_id) return this.reply(data, "你暂未绑定游戏id，无法执行管理操作")
        const operator = point_storage.get_user_info(operator_game_id)
        const permission = operator ? point_storage.user_permission_map[operator.role as keyof typeof point_storage.user_permission_map] : 0
        if (permission < 3) return this.reply(data, "权限不足，只有 permission 3 用户可以执行该操作")

        const game_id = args[2]
        const point_text = args[3]
        const reason = args.slice(4).join(" ").trim()
        if (!game_id || !point_text || !reason) {
            return this.reply(data, `用法: point ${action} <game_id> <num> <reason>`)
        }
        if (!/^[a-zA-Z0-9_]{3,16}$/.test(game_id)) return this.reply(data, "无效的 game_id 格式")
        if (reason.length > 200) return this.reply(data, "reason 最多 200 个字符")
        const point = this.parse_point(point_text)
        if (point === null) return this.reply(data, "num 必须是大于 0 且最多两位小数的数字")

        const result = point_storage.change_point(game_id, action === "add" ? "add" : "remove", point, reason)
        if (!result.success) {
            const balance = result.point === undefined ? "" : `，当前余额：${this.format_point(result.point)} point`
            return this.reply(data, `${result.message}${balance}`)
        }
        this.reply(data, `已为 ${result.game_id} ${action === "add" ? "添加" : "删除"} ${this.format_point(result.changed_point)} point\n原因：${reason}\n当前余额：${this.format_point(result.point)} point`)
    }

    private validate_sign_rewards() {
        if (!Array.isArray(this.sign_rewards) || this.sign_rewards.length === 0) {
            throw new Error("sign_rewards 必须是非空数组")
        }
        const seen = new Set<number>()
        let total = 0
        for (const reward of this.sign_rewards) {
            if (!Number.isFinite(reward.point) || reward.point < 0 || Math.round(reward.point * 100) !== reward.point * 100) {
                throw new Error("签到 point 必须大于等于 0 且最多两位小数")
            }
            if (!Number.isFinite(reward.probability) || reward.probability <= 0 || reward.probability > 1) {
                throw new Error("签到 probability 必须大于 0 且不超过 1")
            }
            if (seen.has(reward.point)) throw new Error(`签到奖励 ${reward.point} 重复配置`)
            seen.add(reward.point)
            total += reward.probability
        }
        if (Math.abs(total - 1) > 1e-10) {
            throw new Error(`签到概率总和必须等于 1，当前为 ${total}`)
        }
    }

    private get_bound_game_id(storage: any, user_id: string): string {
        return storage.get_user_info(user_id)?.game_id || ""
    }

    private parse_point(value: string): number | null {
        if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(value)) return null
        const point = Number(value)
        return Number.isFinite(point) && point > 0 ? point : null
    }

    private draw_reward(): number {
        const random = Math.random()
        let cumulative = 0
        for (const reward of this.sign_rewards) {
            cumulative += reward.probability
            if (random < cumulative) return reward.point
        }
        return this.sign_rewards[this.sign_rewards.length - 1].point
    }

    private get_shanghai_date(): string {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date())
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
        return `${values.year}-${values.month}-${values.day}`
    }

    private format_probability_table(): string {
        const rows = this.sign_rewards.map(reward =>
            `${this.format_point(reward.point)} point：${(reward.probability * 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`
        )
        return `每日签到积分概率：\n${rows.join("\n")}\n概率合计：100%`
    }

    private format_point(point: number): string {
        return point.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")
    }

    private reply(data: any, message: string) {
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n${message}`)], data.origin_object)
    }
}
