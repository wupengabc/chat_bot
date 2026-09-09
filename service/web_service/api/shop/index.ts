import type {Express, Request, Response} from "express"
import {get_storage} from "../../../../storage/index.js"
import {verify_resource_token} from "../user/auth/index.js"
import {get_game_adapter} from "../../../../game_adapter/index.js"
import ExcelJS from "exceljs"

type SellType = "sell" | "buy"

interface CurrentPrice {
    shop: string
    player: string | null
    price: number
    count: string | null
    position: string | null
    create_at: string
    adjusted_price?: number
}

interface AverageResult {
    average: number
    shop_count: number
    prices: CurrentPrice[]
    adjusted: CurrentPrice[]
    outliers: CurrentPrice[]
}

interface PublicAverageResult {
    average: number
    shop_count: number
    shops: string[]
    adjusted_shops: string[]
    adjusted_count: number
    outlier_count: number
    outlier_shops: string[]
}

interface BangxiStorage {
    get_shop_list(): Array<{id: number, shopname: string, create_at: string, new_batch_id: string | null}>
    get_latest_shop_price_info(name: string): {
        shop_name: string
        batch_id: string
        create_at: string
        prices: unknown[]
    } | null
    get_shop_item_price_history(item: string, shop: string): unknown[]
    get_current_item_average(item: string, sell_type: SellType): AverageResult | null
    change_point(game_id: string, action: "add" | "remove", point: number, reason: string, ext?: string | null): {
        success: boolean
        message?: string
        point?: number
        changed_point?: number
    }
    add_shop_price_snapshot(shop_name: string, prices: Array<{item_id: string, player?: string, sell_type: SellType, price: number, count?: string, position?: string}>): {
        success: boolean
        message?: string
        batch_id?: string
    }
    delete_shop_price_batch?(batch_id: string): {success: boolean, message?: string}
}

interface BangxiGameInstance {
    status?: string
    bot?: any
    execute_single_task?(task: () => void | Promise<void>, join_to_queue?: boolean): Promise<boolean>
    send_message?(message: string): boolean
    get_language?(lang: string): Record<string, string>
}

function parseRequiredQuery(value: unknown): string | null {
    if (typeof value !== "string") return null
    const parsed = value.trim()
    return parsed && parsed.length <= 256 ? parsed : null
}

function parseSellType(value: unknown): SellType | null {
    if (value === "sell" || value === "buy") return value
    return null
}

function getBangxiStorage(response: Response): BangxiStorage | null {
    const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined
    if (!storage?.get_shop_list || !storage.get_latest_shop_price_info ||
        !storage.get_shop_item_price_history || !storage.get_current_item_average || !storage.change_point) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"})
        return null
    }
    return storage
}

function getIdentity(request: Request, response: Response): {username: string, role: string} | null {
    const identity = verify_resource_token(request)
    if (!identity) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"})
        return null
    }
    return identity
}

function publicAverage(result: AverageResult | null): PublicAverageResult | null {
    if (!result) return null
    return {
        average: result.average,
        shop_count: result.shop_count,
        shops: result.prices.map(item => item.shop),
        adjusted_shops: result.adjusted.map(item => item.shop),
        adjusted_count: result.adjusted.length,
        outlier_count: result.outliers.length,
        outlier_shops: result.outliers.map(item => item.shop),
    }
}

export async function init(app: Express) {
    app.get("/api/shop/list", (request: Request, response: Response) => {
        const identity = getIdentity(request, response)
        if (!identity) return
        const storage = getBangxiStorage(response)
        if (!storage) return
        response.json({success: true, shops: storage.get_shop_list()})
    })

    app.get("/api/shop/info", (request: Request, response: Response) => {
        const identity = getIdentity(request, response)
        if (!identity) return
        const name = parseRequiredQuery(request.query.name)
        if (!name) {
            response.status(400).json({success: false, message: "name 必须是非空字符串"})
            return
        }
        const storage = getBangxiStorage(response)
        if (!storage) return
        const shop = storage.get_latest_shop_price_info(name)
        if (!shop) {
            response.status(404).json({success: false, message: "没有找到该商店的价格信息"})
            return
        }
        response.json({success: true, shop})
    })

    app.get("/api/shop/item_history", (request: Request, response: Response) => {
        const identity = getIdentity(request, response)
        if (!identity) return
        const item = parseRequiredQuery(request.query.item)
        const shop = parseRequiredQuery(request.query.shop)
        if (!item || !shop) {
            response.status(400).json({success: false, message: "item 和 shop 必须是非空字符串"})
            return
        }
        const storage = getBangxiStorage(response)
        if (!storage) return
        response.json({success: true, item, shop, history: storage.get_shop_item_price_history(item, shop)})
    })

    app.get("/api/shop/avg", (request: Request, response: Response) => {
        const identity = getIdentity(request, response)
        if (!identity) return
        const item = parseRequiredQuery(request.query.item)
        const sellType = parseSellType(request.query.type) || "sell"
        if (!item) {
            response.status(400).json({success: false, message: "item 必须是非空字符串"})
            return
        }
        const storage = getBangxiStorage(response)
        if (!storage) return

        const result = storage.get_current_item_average(item, sellType)
        if (!result) {
            response.status(404).json({success: false, message: `没有找到该物品的最新${sellType === "sell" ? "出售" : "收购"}价格`})
            return
        }

        const charge = storage.change_point(
            identity.username,
            "remove",
            10,
            `查询物品${sellType === "sell" ? "出售" : "收购"}均价：${item.slice(0, 180)}`,
            `web_shop_avg:${item.toLowerCase()}:${sellType}`,
        )
        if (!charge.success) {
            response.status(402).json({success: false, message: charge.message || "扣除积分失败"})
            return
        }

        response.json({
            success: true,
            item,
            sell_type: sellType,
            charged_point: charge.changed_point,
            point: charge.point,
            average: publicAverage(result),
        })
    })

    app.post("/api/shop/update", async (request: Request, response: Response) => {
        const identity = getIdentity(request, response)
        if (!identity) return
        const shopName = typeof request.body?.shop_name === "string" ? request.body.shop_name.trim() : ""
        if (!shopName || shopName.length > 256) {
            response.status(400).json({success: false, message: "shop_name 必须是非空字符串"})
            return
        }
        const storage = getBangxiStorage(response)
        if (!storage) return

        const instance = get_game_adapter("mineflayer", "bangxi") as BangxiGameInstance | undefined
        if (!instance || instance.status !== "running") {
            response.status(503).json({success: false, message: "Bot 尚未连接至服务器，暂时无法更新商店"})
            return
        }

        const en = instance.get_language?.("en_us") as Record<string, string> || {}
        const zh = instance.get_language?.("zh_cn") as Record<string, string> || {}
        const reverse = Object.fromEntries(Object.entries(en).map(([key, value]) => [value, key]))

        function safeFileName(value: string): string {
            return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 64) || "商店"
        }

        function extractChatText(value: any): string {
            if (value === null || value === undefined) return ""
            if (typeof value === "object" && !Array.isArray(value) && "type" in value && "value" in value) {
                return extractChatText(value.value)
            }
            if (typeof value === "string") {
                const trimmed = value.trim()
                if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
                    try { return extractChatText(JSON.parse(trimmed)) } catch { return value }
                }
                return value
            }
            if (Array.isArray(value)) return value.map(item => extractChatText(item)).join("")
            if (typeof value === "object") {
                return extractChatText(value.text) + (extractChatText(value.text) ? "" : extractChatText(value.translate)) + extractChatText(value.with) + extractChatText(value.extra)
            }
            return String(value)
        }

        function cleanSignText(text: string): string {
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

        function getSignSides(block: any): string[] {
            const sides = block?.getSignText?.()
            if (!Array.isArray(sides)) return []
            return sides.map(side => {
                if (typeof side === "string" && !side.includes("[object Object]")) return side
                const sideName = sides.indexOf(side) === 0 ? "front_text" : "back_text"
                const messages = block?.entity?.value?.[sideName]?.value?.messages?.value?.value
                if (!Array.isArray(messages)) return typeof side === "string" ? side : ""
                return messages.map((message: any) => extractChatText(message)).join("\n")
            })
        }

        function parseSign(text: string): {player: string, item_id: string, sell_type: SellType, price: number, count: string} | null {
            const normalized = cleanSignText(text)
            const lines = normalized.split("\n").map(line => line.trim()).filter(Boolean)
            const stateIndex = lines.findIndex(line => /出售|收购|缺货|空间不足|购买|售卖/.test(line))
            if (stateIndex < 0) return null
            const state = lines[stateIndex]
            let sellType: SellType
            if (/缺货|出售|售卖/.test(state)) sellType = "sell"
            else if (/空间不足|收购|购买/.test(state)) sellType = "buy"
            else return null

            const priceMatch = normalized.match(/(?:单价|价格)?\s*:?\s*([\d,.]+)\s*(?:金币|金|元)/)
            if (!priceMatch) return null
            const price = Number(priceMatch[1].replace(/,/g, ""))
            if (!Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-8) return null

            const priceIndex = lines.findIndex(line => line.includes(priceMatch[0]))
            const candidates = priceIndex > stateIndex
                ? lines.slice(stateIndex + 1, priceIndex)
                : lines.filter((_, index) => index !== stateIndex && index !== priceIndex)
            const itemLine = candidates.find(line => !/(?:单价|价格|金币|出售|收购|缺货|空间不足|购买|售卖)/.test(line) && !/^\d+(?:[,.]\d+)*$/.test(line))
            if (!itemLine) return null
            const key = reverse[itemLine]
            const itemId = zh[itemLine] || (key ? (zh[key] || itemLine) : itemLine)
            let count = state.split(/\s+/)[1] || "未知数量"
            if (state.includes("缺货")) count = "已售空"
            if (state.includes("空间不足")) count = "收购已满"
            const player = lines[0] || "未知店主"
            return {player, item_id: itemId, sell_type: sellType, price, count}
        }

        async function abortableDelay(ms: number, signal: AbortSignal) {
            return new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    signal.removeEventListener("abort", onAbort)
                    resolve()
                }, ms)
                const onAbort = () => {
                    clearTimeout(timeout)
                    reject(new Error("更新商店价格超时"))
                }
                if (signal.aborted) return onAbort()
                signal.addEventListener("abort", onAbort, {once: true})
            })
        }

        async function returnHome(instance: any) {
            const bot = instance?.bot
            if (!bot) return
            await new Promise<void>((resolve) => {
                let settled = false
                let homeMessageListener: ((message: string) => void) | undefined
                let homeEndListener: ((reason: string) => void) | undefined
                const finish = () => {
                    if (settled) return
                    settled = true
                    clearTimeout(timeout)
                    if (homeMessageListener) bot.off("messagestr", homeMessageListener)
                    if (homeEndListener) bot.off("end", homeEndListener)
                    resolve()
                }
                const timeout = setTimeout(finish, 15_000)
                homeMessageListener = (message: string) => {
                    if (message.includes("你将在") && message.includes("秒后被传送")) return
                    if (message.includes("已将你传送") || message.includes("回到家") || message.includes("欢迎回家")) finish()
                }
                homeEndListener = () => finish()
                bot.on("messagestr", homeMessageListener)
                bot.once("end", homeEndListener)
                try { if (!instance.send_message("/home home")) finish() } catch { finish() }
            })
        }

        async function scanShop(instance: any, signal: AbortSignal): Promise<Array<{player: string, item_id: string, sell_type: SellType, price: number, count: string, position: string}>> {
            const bot = instance.bot
            const beforeTeleport = bot.entity?.position?.clone?.()
            await new Promise<void>((resolve, reject) => {
                let settled = false
                const finish = (error?: Error) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timeout)
                    bot.off("messagestr", messageListener)
                    bot.off("end", endListener)
                    if (abortListener) signal.removeEventListener("abort", abortListener)
                    error ? reject(error) : resolve()
                }
                const timeout = setTimeout(() => finish(new Error("等待地标传送超时")), 10_000)
                const messageListener = (message: string) => {
                    if (message.includes("地标不存在")) finish(new Error("这个地标不存在"))
                    else if (message.includes("已将你传送")) finish()
                }
                const endListener = (reason: string) => finish(new Error(`Bot掉线: ${reason}`))
                const abortListener = () => finish(new Error("更新商店价格超时"))
                if (signal.aborted) return abortListener()
                signal.addEventListener("abort", abortListener, {once: true})
                bot.on("messagestr", messageListener)
                bot.once("end", endListener)
                if (!instance.send_message(`/pw ${shopName}`)) finish(new Error("Bot 未连接"))
            })

            if (beforeTeleport) {
                const deadline = Date.now() + 5_000
                while (Date.now() < deadline) {
                    if (signal.aborted) throw new Error("更新商店价格超时")
                    const current = bot.entity?.position
                    if (current && (Math.abs(current.x - beforeTeleport.x) > 1 || Math.abs(current.y - beforeTeleport.y) > 1 || Math.abs(current.z - beforeTeleport.z) > 1)) break
                    await abortableDelay(100, signal)
                }
            }

            await new Promise<void>((resolve, reject) => {
                const loaded = new Set<string>()
                let settled = false
                const finish = (error?: Error) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timeout)
                    bot._client.removeListener("map_chunk", onChunk)
                    signal.removeEventListener("abort", onAbort)
                    error ? reject(error) : resolve()
                }
                const onAbort = () => finish(new Error("更新商店价格超时"))
                const onChunk = (packet: any) => {
                    const pos = bot.entity?.position
                    if (!pos || Math.abs(packet.x - Math.floor(pos.x / 16)) > 8 || Math.abs(packet.z - Math.floor(pos.z / 16)) > 8) return
                    loaded.add(`${packet.x},${packet.z}`)
                    if (loaded.size >= 16) finish()
                }
                const timeout = setTimeout(() => finish(), 20_000)
                if (signal.aborted) return onAbort()
                signal.addEventListener("abort", onAbort, {once: true})
                bot._client.on("map_chunk", onChunk)
            })
            await abortableDelay(2_000, signal)

            if (signal.aborted) throw new Error("更新商店价格超时")
            const position = bot.entity?.position
            if (!position) throw new Error("未获取到Bot位置")

            const blocks: any[] = []
            const seenPositions = new Set<string>()
            const radius = 128
            const chunkRadius = Math.ceil(radius / 16)
            const centerX = Math.floor(position.x / 16)
            const centerZ = Math.floor(position.z / 16)
            for (let cx = centerX - chunkRadius; cx <= centerX + chunkRadius; cx++) {
                for (let cz = centerZ - chunkRadius; cz <= centerZ + chunkRadius; cz++) {
                    const column = bot.world.getColumn(cx, cz)
                    if (!column?.blockEntities) continue
                    for (const key of Object.keys(column.blockEntities)) {
                        const [rawX, y, rawZ] = key.split(",").map(Number)
                        if (![rawX, y, rawZ].every(Number.isFinite)) continue
                        const worldX = rawX >= 0 && rawX < 16 ? cx * 16 + rawX : rawX
                        const worldZ = rawZ >= 0 && rawZ < 16 ? cz * 16 + rawZ : rawZ
                        const dx = worldX - position.x, dz = worldZ - position.z
                        if (dx * dx + dz * dz > radius * radius) continue
                        const pos = position.offset(worldX - position.x, y - position.y, worldZ - position.z)
                        const block = bot.blockAt(pos)
                        if (typeof block?.getSignText !== "function" && !block?.name?.includes("sign")) continue
                        const positionKey = `${worldX},${y},${worldZ}`
                        if (!seenPositions.has(positionKey)) {
                            seenPositions.add(positionKey)
                            blocks.push(pos)
                        }
                    }
                }
            }

            const prices: Array<{player: string, item_id: string, sell_type: SellType, price: number, count: string, position: string}> = []
            const seenPrices = new Set<string>()
            for (const pos of blocks) {
                try {
                    const block = bot.blockAt(pos)
                    const sides = getSignSides(block)
                    if (!sides.length) continue
                    for (let sideIndex = 0; sideIndex < sides.length; sideIndex++) {
                        const rawText = typeof sides[sideIndex] === "string" ? sides[sideIndex] : ""
                        const cleanedText = cleanSignText(rawText)
                        const parsed = cleanedText ? parseSign(rawText) : null
                        if (!parsed) continue
                        const priceKey = `${pos.x},${pos.y},${pos.z}:${parsed.item_id}:${parsed.sell_type}:${parsed.price}`
                        if (seenPrices.has(priceKey)) continue
                        seenPrices.add(priceKey)
                        prices.push({...parsed, position: `${pos.x} ${pos.y} ${pos.z}`})
                    }
                } catch {}
            }
            if (!prices.length) throw new Error("没有读取到有效商店价格")
            return prices
        }

        async function createPriceExcel(shopName: string, prices: Array<{player: string, item_id: string, sell_type: SellType, price: number, count: string, position: string}>): Promise<Buffer> {
            const workbook = new ExcelJS.Workbook()
            workbook.creator = "ChatBot price plugin"
            workbook.created = new Date()
            const sheet = workbook.addWorksheet("商店数据")
            sheet.columns = [
                {header: "商店名称", key: "shop", width: 20},
                {header: "商店老板", key: "player", width: 20},
                {header: "商店类型", key: "sell_type", width: 12},
                {header: "商品数量", key: "count", width: 15},
                {header: "物品名称", key: "item_id", width: 30},
                {header: "价格(金币)", key: "price", width: 16},
                {header: "坐标", key: "position", width: 22},
            ]
            sheet.addRows(prices.map(item => ({
                shop: shopName,
                player: item.player,
                sell_type: item.sell_type === "sell" ? "出售" : "收购",
                count: item.count,
                item_id: item.item_id,
                price: item.price,
                position: item.position,
            })))
            sheet.getRow(1).font = {bold: true}
            sheet.getColumn("price").numFmt = "0.00"
            sheet.autoFilter = {from: "A1", to: "G1"}
            sheet.views = [{state: "frozen", ySplit: 1}]
            const buffer = await workbook.xlsx.writeBuffer()
            return Buffer.from(buffer)
        }

        let taskStarted = false
        let scannedPrices: Array<{player: string, item_id: string, sell_type: SellType, price: number, count: string, position: string}> = []
        let accepted: boolean | undefined
        try {
            accepted = await instance.execute_single_task?.(async () => {
                taskStarted = true
                const controller = new AbortController()
                const taskTimeout = setTimeout(() => controller.abort(), 90_000)
                try {
                    scannedPrices = await scanShop(instance, controller.signal)
                    if (controller.signal.aborted) throw new Error("更新商店价格超时")
                    const saved = storage.add_shop_price_snapshot(shopName, scannedPrices)
                    if (!saved.success) throw new Error(saved.message || "保存快照失败")
                    const charged = storage.change_point(
                        identity.username,
                        "remove",
                        100,
                        `更新商店价格：${shopName}`,
                        `web_shop_update:${saved.batch_id}`,
                    )
                    if (!charged.success) {
                        storage.delete_shop_price_batch?.(saved.batch_id || "")
                        throw new Error(`扣除积分失败：${charged.message}`)
                    }
                } finally {
                    clearTimeout(taskTimeout)
                    await returnHome(instance)
                }
            }, false)
        } catch (error) {
            response.status(502).json({success: false, message: error instanceof Error ? error.message : "更新商店价格失败"})
            return
        }

        if (!accepted && !taskStarted) {
            response.status(503).json({success: false, message: "已有商店更新任务正在运行，请稍后再试"})
            return
        }

        if (!scannedPrices.length) {
            response.status(500).json({success: false, message: "未读取到任何价格数据"})
            return
        }

        try {
            const excelBuffer = await createPriceExcel(shopName, scannedPrices)
            const fileName = encodeURIComponent(`${safeFileName(shopName)}_商店价格.xlsx`)
            response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${fileName}`)
            response.end(excelBuffer)
        } catch (excelError) {
            response.status(500).json({success: false, message: "生成 Excel 文件失败"})
        }
    })
}
