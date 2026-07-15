import {Structs} from "node-napcat-ts"
import {send_message} from "../../../chat_adapter/index.js"
import {get_game_adapter} from "../../../game_adapter/index.js"
import {get_storage} from "../../../storage/index.js"
import {acquire_plugin_lock, get_chat_adapter_prefix, plugin_logger, release_plugin_lock} from "../../index.js"
import {help} from "../../type.js"

type SellType = "sell" | "buy"
type ParsedPrice = {item_id: string, sell_type: SellType, price: number, count: string, position: string}
type PriceRow = {shop: string, price: number, count: string | null, position: string | null, create_at: string}

export class init {
    public help: help = {
        name: "price", keyword: "price", description: "查询和更新商店价格", permission: 0,
        args: [
            "update <商店名>（消耗100积分）",
            "avg <物品名> <出售|收购>",
            "get <物品名> <出售|收购>（权限等级2）",
            "delete <商店名>（权限等级2）"
        ],
        platform: "chat_adapter"
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword

    async event_handler(_event: string, data: any) {
        if (data.adapter_platform !== "chat_adapter") return
        const args = data.raw_message.trim().split(/\s+/)
        if (args[0] !== this.command_start) return
        const user_id = data.sender.user_id.toString()
        if (!acquire_plugin_lock(user_id)) return this.reply(data, "请等待当前操作完成后再试")
        try {
            await this.handle_command(data, args, user_id)
        } catch (error: any) {
            plugin_logger("price", error?.stack || String(error), "error")
            this.reply(data, `价格操作失败: ${error?.message || error}`)
        } finally {
            release_plugin_lock(user_id)
        }
    }

    private async handle_command(data: any, args: string[], user_id: string) {
        const action = args[1]?.toLowerCase()
        const storage = get_storage("bangxi_server_storage")
        const permission_storage = get_storage("chat_permission_storage")
        if (!storage || !permission_storage) return this.reply(data, "价格系统未初始化")
        if (!action) return this.reply(data, "用法：price update/avg/get/delete ...")

        const game_id = permission_storage.get_user_info(user_id)?.game_id || ""
        if (action === "update") return this.update_shop(data, args, game_id, storage)
        if (action === "avg") return this.show_average(data, args, storage)
        if (action !== "get" && action !== "delete") return this.reply(data, "操作无效，可用操作：update / avg / get / delete")
        if (!game_id) return this.reply(data, "你暂未绑定游戏账号")
        if (this.get_permission(storage, game_id) < 2) return this.reply(data, "权限不足，只有权限等级2的用户可以执行该操作")
        if (action === "get") return this.show_prices(data, args, storage)
        return this.delete_shop(data, args, storage)
    }

    private async update_shop(data: any, args: string[], game_id: string, storage: any) {
        const shop_name = args.slice(2).join(" ").trim()
        if (!shop_name) return this.reply(data, "用法：price update <商店名>")
        if (!game_id) return this.reply(data, "你暂未绑定游戏账号，无法支付更新所需积分")
        const balance = storage.get_point_balance(game_id)
        if (!balance.success || balance.point < 100) return this.reply(data, "积分不足，更新商店价格需要100积分")
        const instance = get_game_adapter("mineflayer", "bangxi")
        if (!instance || instance.status !== "running") return this.reply(data, "Bot暂未连接至服务器")

        let task_started = false
        const accepted = await instance.execute_single_task(async () => {
            task_started = true
            const controller = new AbortController()
            const task_timeout = setTimeout(() => controller.abort(), 45_000)
            try {
                this.reply(data, `正在更新商店 ${shop_name} 的价格，成功后将扣除100积分（最多等待45秒）……`)
                const prices = await this.scan_shop(instance, shop_name, controller.signal)
                if (controller.signal.aborted) throw new Error("更新商店价格超时")
                const saved = storage.add_shop_price_snapshot(shop_name, prices)
                if (!saved.success) throw new Error(saved.message)
                const charged = storage.change_point(game_id, "remove", 100, `更新商店价格：${shop_name}`, `price_update:${saved.batch_id}`)
                if (!charged.success) {
                    storage.delete_shop_price_batch?.(saved.batch_id)
                    throw new Error(`扣除积分失败：${charged.message}`)
                }
                const sell_count = prices.filter(item => item.sell_type === "sell").length
                const buy_count = prices.length - sell_count
                this.reply(data, `商店 ${shop_name} 更新完成，出售 ${sell_count} 条，收购 ${buy_count} 条，共写入 ${prices.length} 条；已扣除100积分`)
            } finally {
                clearTimeout(task_timeout)
            }
        }, false)
        if (!accepted && !task_started) this.reply(data, "已有商店价格更新任务正在运行，请稍后再试")
    }

    private show_average(data: any, args: string[], storage: any) {
        const parsed = this.parse_item_command(args)
        if (!parsed) return this.reply(data, "用法：price avg <物品名> <出售|收购>")
        const prices = storage.get_current_shop_prices(parsed.item_name, parsed.sell_type) as PriceRow[]
        if (!prices.length) return this.reply(data, `没有找到 ${parsed.item_name} 的${parsed.label}价格`)
        const {valid, outliers} = this.remove_outliers(prices)
        const average = valid.reduce((sum, item) => sum + Number(item.price), 0) / valid.length
        let message = `${parsed.item_name} 的平均${parsed.label}价格是 ${average.toFixed(2)}\n数据来自: ${valid.map(item => item.shop).join(" ")}`
        if (outliers.length) message += `\n\n⚠️ 以下商店价格异常，未计入平均值：${outliers.map(item => `\n${item.shop}: ${Number(item.price).toFixed(2)}`).join("")}`
        this.reply(data, message)
    }

    private show_prices(data: any, args: string[], storage: any) {
        const parsed = this.parse_item_command(args)
        if (!parsed) return this.reply(data, "用法：price get <物品名> <出售|收购>")
        const prices = storage.get_current_shop_prices(parsed.item_name, parsed.sell_type) as PriceRow[]
        if (!prices.length) return this.reply(data, `没有找到 ${parsed.item_name} 的${parsed.label}价格`)
        const limit = 50
        let message = `${parsed.item_name} 的${parsed.label}价格：\n` + prices.slice(0, limit).map(item => `${item.shop}: ${Number(item.price).toFixed(2)}${item.count ? `（${item.count}）` : ""}`).join("\n")
        if (prices.length > limit) message += `\n仅显示前${limit}条，共${prices.length}条`
        this.reply(data, message)
    }

    private delete_shop(data: any, args: string[], storage: any) {
        const shop_name = args.slice(2).join(" ").trim()
        if (!shop_name) return this.reply(data, "用法：price delete <商店名>")
        const result = storage.delete_shop_prices(shop_name)
        this.reply(data, result.success ? `已删除商店 ${shop_name} 的全部价格历史，共 ${result.deleted} 条` : result.message)
    }

    private async scan_shop(instance: any, shop_name: string, signal: AbortSignal): Promise<ParsedPrice[]> {
        const bot = instance.bot
        let message_listener: ((message: string) => void) | undefined
        let end_listener: ((reason: string) => void) | undefined
        let abort_listener: (() => void) | undefined
        try {
            const before_teleport = bot.entity?.position?.clone?.()
            await new Promise<void>((resolve, reject) => {
                let settled = false
                const finish = (error?: Error) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timeout)
                    bot.off("messagestr", message_listener)
                    bot.off("end", end_listener)
                    if (abort_listener) signal.removeEventListener("abort", abort_listener)
                    error ? reject(error) : resolve()
                }
                const timeout = setTimeout(() => finish(new Error("等待地标传送超时")), 10_000)
                message_listener = (message: string) => {
                    if (message.includes("地标不存在")) finish(new Error("这个地标不存在"))
                    else if (message.includes("已将你传送")) finish()
                }
                end_listener = (reason: string) => finish(new Error(`Bot掉线: ${reason}`))
                abort_listener = () => finish(new Error("更新商店价格超时"))
                if (signal.aborted) return abort_listener()
                signal.addEventListener("abort", abort_listener, {once: true})
                bot.on("messagestr", message_listener)
                bot.once("end", end_listener)
                bot.chat(`/pw ${shop_name}`)
            })
            await this.wait_for_position_change(bot, before_teleport, signal)
            await this.wait_for_chunks(bot, signal)
            if (signal.aborted) throw new Error("更新商店价格超时")
            const position = bot.entity?.position
            if (!position) throw new Error("未获取到Bot位置")
            plugin_logger("price", `商店 ${shop_name} 扫描中心：${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}`, "info")
            const blocks: any[] = []
            const seen_positions = new Set<string>()
            let block_entity_count = 0
            const radius = 128
            const chunk_radius = Math.ceil(radius / 16)
            const center_x = Math.floor(position.x / 16)
            const center_z = Math.floor(position.z / 16)
            for (let cx = center_x - chunk_radius; cx <= center_x + chunk_radius; cx++) {
                for (let cz = center_z - chunk_radius; cz <= center_z + chunk_radius; cz++) {
                    const column = bot.world.getColumn(cx, cz)
                    if (!column?.blockEntities) continue
                    for (const key of Object.keys(column.blockEntities)) {
                        block_entity_count++
                        const [raw_x, y, raw_z] = key.split(",").map(Number)
                        if (![raw_x, y, raw_z].every(Number.isFinite)) continue
                        // prismarine-chunk 使用区块内坐标；同时兼容部分协议实现返回世界坐标。
                        const world_x = raw_x >= 0 && raw_x < 16 ? cx * 16 + raw_x : raw_x
                        const world_z = raw_z >= 0 && raw_z < 16 ? cz * 16 + raw_z : raw_z
                        const dx = world_x - position.x, dz = world_z - position.z
                        if (dx * dx + dz * dz > radius * radius) continue
                        const pos = position.offset(world_x - position.x, y - position.y, world_z - position.z)
                        const block = bot.blockAt(pos)
                        if (typeof block?.getSignText !== "function" && !block?.name?.includes("sign")) continue
                        const position_key = `${world_x},${y},${world_z}`
                        if (!seen_positions.has(position_key)) {
                            seen_positions.add(position_key)
                            blocks.push(pos)
                        }
                    }
                }
            }
            const en = instance.get_language("en_us") as Record<string, string>
            const zh = instance.get_language("zh_cn") as Record<string, string>
            const reverse = Object.fromEntries(Object.entries(en).map(([key, value]) => [value, key]))
            const prices: ParsedPrice[] = []
            const seen_prices = new Set<string>()
            let sign_side_count = 0
            let printed_sign_count = 0
            for (const pos of blocks) {
                try {
                    const block = bot.blockAt(pos)
                    const sides = block?.getSignText?.()
                    if (!Array.isArray(sides)) continue
                    for (let side_index = 0; side_index < sides.length; side_index++) {
                        const raw_text = sides[side_index]
                        if (typeof raw_text !== "string" || !raw_text.trim()) continue
                        sign_side_count++
                        const cleaned_text = this.clean_sign_text(raw_text)
                        if (printed_sign_count < 10) {
                            printed_sign_count++
                            const lines = cleaned_text.split("\n")
                            plugin_logger("price", `告示牌 ${printed_sign_count}/10：坐标=${pos.x},${pos.y},${pos.z} 方块=${block?.name || "unknown"} 面=${side_index === 0 ? "正面" : "背面"} 行数=${lines.length}`, "info")
                            lines.forEach((line, line_index) => {
                                plugin_logger("price", `告示牌 ${printed_sign_count}/10 第${line_index + 1}行：${JSON.stringify(line)}`, "info")
                            })
                        }
                        const parsed = this.parse_sign(raw_text, reverse, zh)
                        if (!parsed) continue
                        const price_key = `${pos.x},${pos.y},${pos.z}:${parsed.item_id}:${parsed.sell_type}:${parsed.price}`
                        if (seen_prices.has(price_key)) continue
                        seen_prices.add(price_key)
                        prices.push({...parsed, position: `${pos.x} ${pos.y} ${pos.z}`})
                    }
                } catch {/* 跳过无法读取的告示牌 */}
            }
            plugin_logger("price", `商店 ${shop_name} 扫描统计：方块实体 ${block_entity_count}，告示牌 ${blocks.length}，有效告示牌面 ${sign_side_count}，价格 ${prices.length}`, "info")
            if (!prices.length) {
                throw new Error(`没有读取到有效商店价格（方块实体 ${block_entity_count}，告示牌 ${blocks.length}，有效告示牌面 ${sign_side_count}）`)
            }
            return prices
        } finally {
            if (message_listener) bot.off("messagestr", message_listener)
            if (end_listener) bot.off("end", end_listener)
            if (abort_listener) signal.removeEventListener("abort", abort_listener)
            if (instance.status === "running") bot.chat("/home home")
        }
    }

    private async wait_for_position_change(bot: any, before: any, signal: AbortSignal) {
        if (!before) return
        const deadline = Date.now() + 5_000
        while (Date.now() < deadline) {
            if (signal.aborted) throw new Error("更新商店价格超时")
            const current = bot.entity?.position
            if (current && (Math.abs(current.x - before.x) > 1 || Math.abs(current.y - before.y) > 1 || Math.abs(current.z - before.z) > 1)) return
            await this.abortable_delay(100, signal)
        }
        // 某些服务器会把玩家传送回相同坐标；继续扫描，但保留短暂加载时间。
    }

    private async wait_for_chunks(bot: any, signal: AbortSignal) {
        await new Promise<void>((resolve, reject) => {
            const loaded = new Set<string>()
            let settled = false
            const finish = (error?: Error) => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                bot._client.removeListener("map_chunk", on_chunk)
                signal.removeEventListener("abort", on_abort)
                error ? reject(error) : resolve()
            }
            const on_abort = () => finish(new Error("更新商店价格超时"))
            const on_chunk = (packet: any) => {
                const pos = bot.entity?.position
                if (!pos || Math.abs(packet.x - Math.floor(pos.x / 16)) > 8 || Math.abs(packet.z - Math.floor(pos.z / 16)) > 8) return
                loaded.add(`${packet.x},${packet.z}`)
                if (loaded.size >= 16) finish()
            }
            const timeout = setTimeout(() => finish(), 20_000)
            if (signal.aborted) return on_abort()
            signal.addEventListener("abort", on_abort, {once: true})
            bot._client.on("map_chunk", on_chunk)
        })
        await this.abortable_delay(2_000, signal)
    }

    private abortable_delay(ms: number, signal: AbortSignal) {
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                signal.removeEventListener("abort", on_abort)
                resolve()
            }, ms)
            const on_abort = () => {
                clearTimeout(timeout)
                reject(new Error("更新商店价格超时"))
            }
            if (signal.aborted) return on_abort()
            signal.addEventListener("abort", on_abort, {once: true})
        })
    }

    private clean_sign_text(text: string): string {
        return text
            .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
            .replace(/§[0-9A-FK-ORX]/gi, "")
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
            .replace(/[\u00a0\u3000]/g, " ")
            .replace(/[：﹕︰]/g, ":")
            .replace(/[，]/g, ",")
            .replace(/\r/g, "")
            .trim()
    }

    private parse_sign(text: string, reverse: Record<string, string>, zh: Record<string, string>): Omit<ParsedPrice, "position"> | null {
        const normalized = this.clean_sign_text(text)
        const lines = normalized.split("\n").map(line => line.trim()).filter(Boolean)
        const state_index = lines.findIndex(line => /出售|收购|缺货|空间不足|购买|售卖/.test(line))
        if (state_index < 0) return null
        const state = lines[state_index]
        let sell_type: SellType
        if (/缺货|出售|售卖/.test(state)) sell_type = "sell"
        else if (/空间不足|收购|购买/.test(state)) sell_type = "buy"
        else return null

        const price_match = normalized.match(/(?:单价|价格)?\s*:?\s*([\d,.]+)\s*(?:金币|金|元)/)
        if (!price_match) return null
        const price = Number(price_match[1].replace(/,/g, ""))
        if (!Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-8) return null

        const price_index = lines.findIndex(line => line.includes(price_match[0]))
        const candidates = price_index > state_index
            ? lines.slice(state_index + 1, price_index)
            : lines.filter((_, index) => index !== state_index && index !== price_index)
        const item_line = candidates.find(line => !/(?:单价|价格|金币|出售|收购|缺货|空间不足|购买|售卖)/.test(line) && !/^\d+(?:[,.]\d+)*$/.test(line))
        if (!item_line) return null
        const key = reverse[item_line]
        const item_id = key ? (zh[key] || item_line) : item_line
        let count = state.split(/\s+/)[1] || "未知数量"
        if (state.includes("缺货")) count = "已售空"
        if (state.includes("空间不足")) count = "收购已满"
        return {item_id, sell_type, price, count}
    }

    private parse_item_command(args: string[]): {item_name: string, sell_type: SellType, label: string} | null {
        if (args.length < 4) return null
        const label = args[args.length - 1]
        if (label !== "出售" && label !== "收购") return null
        const item_name = args.slice(2, -1).join(" ").trim()
        return item_name ? {item_name, sell_type: label === "出售" ? "sell" : "buy", label} : null
    }

    private remove_outliers(prices: PriceRow[]): {valid: PriceRow[], outliers: PriceRow[]} {
        if (prices.length <= 5) return {valid: prices, outliers: []}
        const sorted = prices.map(item => Number(item.price)).sort((a, b) => a - b)
        const q1 = sorted[Math.floor(sorted.length * 0.25)]
        const q3 = sorted[Math.floor(sorted.length * 0.75)]
        const iqr = q3 - q1
        const lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr
        const valid = prices.filter(item => Number(item.price) >= lower && Number(item.price) <= upper)
        const outliers = prices.filter(item => Number(item.price) < lower || Number(item.price) > upper)
        return valid.length ? {valid, outliers} : {valid: prices, outliers: []}
    }

    private get_permission(storage: any, game_id: string): number {
        const user = storage.get_user_info(game_id)
        return user ? storage.user_permission_map[user.role] ?? 0 : 0
    }

    private reply(data: any, message: string) {
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n${message}`)], data.origin_object)
    }
}
