import {Structs} from "node-napcat-ts"
import {send_message} from "../../../chat_adapter/index.js"
import {get_game_adapter} from "../../../game_adapter/index.js"
import {get_storage} from "../../../storage/index.js"
import {acquire_plugin_lock, get_chat_adapter_prefix, plugin_logger, release_plugin_lock} from "../../index.js"
import {help} from "../../type.js"

type Landmark = {name: string, description: string, owner: string, visits: number, price: string, item_id: string}
type LandmarkRow = Landmark & {updated_at?: string}

export class init {
    public help: help = {
        name: "pw", keyword: "pw", description: "同步和查询服务器地标", permission: 0,
        args: [
            {key: "update", description: "全量更新地标数据", permission: 2, args: [{key: "--dry-run", description: "只读取并预览，不写入数据表", permission: 2, args: []}]},
            {key: "list", description: "分页列出地标", permission: 0, args: [{key: "页码", description: "可选，默认 1", permission: 0, args: []}]},
            {key: "search", description: "按名称或介绍搜索地标", permission: 0, args: [{key: "关键词", description: "搜索关键词", permission: 0, args: []}]},
            {key: "owner", description: "查询指定主人的地标", permission: 0, args: [{key: "玩家名", description: "地标主人", permission: 0, args: []}]},
            {key: "get", description: "查看同名地标详情", permission: 0, args: [{key: "地标名称", description: "完整地标名称", permission: 0, args: []}]},
            {key: "top", description: "按访问人数排行", permission: 0, args: [{key: "数量", description: "可选，默认 10", permission: 0, args: []}]},
            {key: "stats", description: "查看地标数据统计", permission: 0, args: []},
        ], platform: "chat_adapter"
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
            plugin_logger("pw", error?.stack || String(error), "error")
            this.reply(data, `地标操作失败: ${error?.message || error}`)
        } finally {
            release_plugin_lock(user_id)
        }
    }

    private async handle_command(data: any, args: string[], user_id: string) {
        const action = args[1]?.toLowerCase()
        const storage = get_storage("bangxi_server_storage")
        const permission_storage = get_storage("chat_permission_storage")
        if (!storage || !permission_storage) return this.reply(data, "地标系统未初始化")
        if (!action) return this.reply(data, "用法：pw update/list/search/owner/get/top/stats ...")
        if (action === "update") return this.update(data, args, user_id, storage, permission_storage)
        if (action === "list") return this.list(data, args, storage)
        if (action === "search") return this.search(data, args, storage)
        if (action === "owner") return this.owner(data, args, storage)
        if (action === "get") return this.get(data, args, storage)
        if (action === "top") return this.top(data, args, storage)
        if (action === "stats") return this.stats(data, args, storage)
        return this.reply(data, "操作无效，可用操作：update / list / search / owner / get / top / stats")
    }

    private async update(data: any, args: string[], user_id: string, storage: any, permission_storage: any) {
        const flags = args.slice(2)
        if (flags.some(flag => flag !== "--dry-run")) return this.reply(data, "用法：pw update [--dry-run]")
        const game_id = permission_storage.get_user_info(user_id)?.game_id || ""
        if (!game_id) return this.reply(data, "你暂未绑定游戏账号")
        const user = storage.get_user_info(game_id)
        const permission = user ? storage.user_permission_map[user.role as keyof typeof storage.user_permission_map] ?? 0 : 0
        if (permission < 2) return this.reply(data, "权限不足，只有权限等级 2 的用户可以执行地标更新")
        const instance = get_game_adapter("mineflayer", "bangxi")
        if (!instance || instance.status !== "running") return this.reply(data, "Bot暂未连接至服务器")
        let started = false
        const accepted = await instance.execute_single_task(async () => {
            started = true
            this.reply(data, `正在${flags.includes("--dry-run") ? "预览" : "更新"}全部地标，最多等待 90 秒……`)
            const landmarks = await this.get_all_landmarks(instance.bot)
            if (flags.includes("--dry-run")) return this.reply(data, `地标预览完成：共读取 ${landmarks.length} 条有效地标，未写入数据表`)
            const result = storage.sync_landmarks(landmarks)
            if (!result.success) throw new Error(result.message)
            this.reply(data, `地标更新完成\n共 ${result.total} 条；新增 ${result.inserted} 条；更新 ${result.updated} 条；删除 ${result.deleted} 条`)
        }, false)
        if (!accepted && !started) this.reply(data, "已有游戏任务正在运行，请稍后再试")
    }

    private list(data: any, args: string[], storage: any) {
        if (args.length > 3) return this.reply(data, "用法：pw list [页码]")
        const page = this.parse_positive(args[2], 1, 9999)
        if (page === null) return this.reply(data, "页码必须是正整数")
        const result = storage.get_landmarks_page(page, 10)
        if (!result.total) return this.reply(data, "暂无地标数据，请管理员先执行 pw update")
        if (!result.rows.length) return this.reply(data, "该页没有地标")
        this.reply(data, `地标列表（第 ${result.page}/${Math.ceil(result.total / result.page_size)} 页，共 ${result.total} 条）\n${this.format_rows(result.rows, false)}`)
    }

    private search(data: any, args: string[], storage: any) {
        const keyword = args.slice(2).join(" ").trim()
        if (!keyword || keyword.length > 64) return this.reply(data, "用法：pw search <关键词>（最多 64 字符）")
        const rows = storage.search_landmarks(keyword, 20)
        this.reply(data, rows.length ? `搜索“${keyword}”结果：\n${this.format_rows(rows, true)}` : "未找到匹配地标")
    }

    private owner(data: any, args: string[], storage: any) {
        const owner = args.slice(2).join(" ").trim()
        if (!owner || owner.length > 64) return this.reply(data, "用法：pw owner <玩家名>")
        const rows = storage.get_landmarks_by_owner(owner, 30)
        this.reply(data, rows.length ? `玩家 ${owner} 的地标：\n${this.format_rows(rows, false)}` : "未找到该玩家的地标")
    }

    private get(data: any, args: string[], storage: any) {
        const name = args.slice(2).join(" ").trim()
        if (!name || name.length > 128) return this.reply(data, "用法：pw get <地标名称>")
        const rows = storage.get_landmarks_by_name(name, 20)
        this.reply(data, rows.length ? `地标“${name}”详情：\n${this.format_rows(rows, true)}` : "未找到该地标")
    }

    private top(data: any, args: string[], storage: any) {
        if (args.length > 3) return this.reply(data, "用法：pw top [数量]")
        const limit = this.parse_positive(args[2], 10, 30)
        if (limit === null) return this.reply(data, "数量必须是 1 到 30 的整数")
        const rows = storage.get_top_landmarks(limit)
        if (!rows.length) return this.reply(data, "暂无地标数据，请管理员先执行 pw update")
        this.reply(data, `地标访问排行：\n${rows.map((row: any, index: number) => `${index + 1}. ${row.name}（${row.owner}）- ${row.visits} 人`).join("\n")}`)
    }

    private stats(data: any, args: string[], storage: any) {
        if (args.length > 2) return this.reply(data, "用法：pw stats")
        const result = storage.get_landmark_stats()
        this.reply(data, `地标统计\n地标总数：${result.total}\n地标主人：${result.owners}\n累计访问：${result.visits}\n最近同步：${result.updated_at || "暂无"}`)
    }

    private get_all_landmarks(bot: any): Promise<Landmark[]> {
        return new Promise((resolve, reject) => {
            const landmarks: Landmark[] = []
            let is_first_page = true
            let finished = false
            let page_timer: NodeJS.Timeout | undefined
            const total_timer = setTimeout(() => finish(new Error("获取地标信息超时")), 90_000)
            const cleanup = () => {
                clearTimeout(total_timer)
                if (page_timer) clearTimeout(page_timer)
                bot.removeListener("windowOpen", handle_window_open)
                bot.removeListener("end", handle_end)
                if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
            }
            const finish = (error?: Error) => {
                if (finished) return
                finished = true
                cleanup()
                if (error) reject(error)
                else if (!landmarks.length) reject(new Error("没有读取到有效地标"))
                else resolve(landmarks)
            }
            const handle_end = () => finish(new Error("Bot 已断开连接"))
            const handle_window_open = (window: any) => {
                if (finished) return
                if (page_timer) clearTimeout(page_timer)

                // 按原有流程：每次打开窗口都先解析、重置 5 秒等待计时，
                // 首页进入列表，之后窗口一律继续点击槽位 50 右键翻页。
                landmarks.push(...this.parse_landmark_nbt(window))
                page_timer = setTimeout(() => finish(), 5_000)

                if (is_first_page) {
                    is_first_page = false
                    setTimeout(() => bot.clickWindow(47, 0, 0)
                        .catch(() => finish(new Error("进入地标列表失败"))), 500)
                } else {
                    setTimeout(() => bot.clickWindow(50, 1, 0)
                        // 翻页失败时不立即结束，等待 5 秒未出现新窗口后正常收尾。
                        .catch(() => {}), 500)
                }
            }
            bot.on("windowOpen", handle_window_open)
            bot.on("end", handle_end)
            bot.chat("/pw")
        })
    }

    private parse_landmark_nbt(window_data: any): Landmark[] {
        const landmarks: Landmark[] = []
        for (const slot of window_data?.slots || []) {
            try {
                const display = slot?.nbt?.value?.display?.value
                if (!display?.Name?.value || !display?.Lore?.value?.value) continue
                const name = this.extract_text(JSON.parse(display.Name.value)).trim()
                const lore = display.Lore.value.value as string[]
                let description = "None", owner = "", visits = 0, price = "None", collecting = false
                for (const line of lore) {
                    const text = this.extract_text(JSON.parse(line)).trim()
                    if (text.includes("[地标介绍]")) {
                        description = text.replace(/^.*\[地标介绍\]\s*/, "") || "None"; collecting = true
                    } else if (collecting && text.includes("[地标主人]")) collecting = false
                    else if (collecting && text.includes("[访问人数]")) collecting = false
                    else if (collecting && text.includes("[传送价格]")) collecting = false
                    else if (collecting && text) description += `${description === "None" ? "" : " "}${text}`
                    if (text.includes("[地标主人]")) owner = text.replace(/^.*\[地标主人\]\s*/, "").trim()
                    if (text.includes("[访问人数]")) visits = Number(text.match(/\[访问人数\]\s*(\d+)/)?.[1] || 0)
                    if (text.includes("[传送价格]")) price = text.replace(/^.*\[传送价格\]\s*/, "") || "None"
                }
                if (name && owner) landmarks.push({name, description, owner, visits, price, item_id: slot.nbt.value.PublicBukkitValues?.value?.["playerwarps:itemtag_item"]?.value || ""})
            } catch { /* 忽略非地标物品或无效 NBT */ }
        }
        return landmarks
    }

    private extract_text(json: any): string {
        return `${json?.text || ""}${Array.isArray(json?.extra) ? json.extra.map((item: any) => this.extract_text(item)).join("") : ""}`
    }

    private format_rows(rows: LandmarkRow[], detail: boolean): string {
        return rows.map((row, index) => detail
            ? `${index + 1}. ${row.name}\n主人：${row.owner}\n访问：${row.visits}\n价格：${row.price}\n介绍：${row.description}`
            : `${index + 1}. ${row.name}（${row.owner}，${row.visits} 人，${row.price}）`).join("\n")
    }

    private parse_positive(value: string | undefined, fallback: number, max: number): number | null {
        if (value === undefined) return fallback
        if (!/^\d+$/.test(value)) return null
        const number = Number(value)
        return number >= 1 && number <= max ? number : null
    }

    private reply(data: any, message: string) {
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n${message}`)], data.origin_object)
    }
}
