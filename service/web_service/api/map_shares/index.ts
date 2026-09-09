import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import type {Express, Request, Response} from "express"
import {get_game_adapter} from "../../../../game_adapter/index.js"
import {get_storage} from "../../../../storage/index.js"
import {path_utils} from "../../../../utils/path_utils.js"
import {verify_resource_token} from "../user/auth/index.js"

type MapIcon = {type?: number, x?: number, z?: number, direction?: number, displayName?: string}
type ScannedMap = {key: string, map_id: number, pixels: Buffer, icons: MapIcon[], frame: {x: number, y: number, z: number, facing: string | null}}
type StoredScan = {username: string, source_pw: string, maps: Array<{key: string, map_id: number, pixels_base64: string, icons: MapIcon[], frame: ScannedMap["frame"]}>}

interface Storage {
    get_map_artwork_by_artwork_hash(hash: string): any
    get_existing_map_artwork_content_hashes(hashes: string[]): Set<string>
    create_map_artwork_group(group: any, rows: any[]): {success: boolean, ids?: number[], message?: string}
    search_map_artwork_groups(page: number, limit: number, filters: any, username?: string, canManage?: boolean): {groups: any[], total: number}
    get_map_artwork_group_record(groupId: string, username?: string, canManage?: boolean): any
    get_map_artwork(id: number): any
    get_map_artwork_group(groupId: string): any[]
    update_map_artwork_group(groupId: string, updates: any, username: string, canManage?: boolean, note?: string): {success: boolean, message?: string}
    update_map_artwork_layout(groupId: string, tiles: Array<{id: number, x: number, y: number, rotation: number, mirror: boolean}>, username: string, canManage?: boolean): {success: boolean, message?: string}
    delete_map_artwork_group(groupId: string, username: string, canManage?: boolean): {success: boolean, message?: string, group?: any, tiles?: any[]}
    toggle_map_artwork_favorite(groupId: string, username: string, enabled: boolean): {success: boolean, like_count: number}
    increment_map_artwork_views(groupId: string): void
    list_map_artwork_versions(groupId: string): any[]
    restore_map_artwork_version(groupId: string, revision: number, username: string, canManage?: boolean): {success: boolean, message?: string}
    create_map_artwork_report(groupId: string, username: string, reason: string): void
    moderate_map_artwork_group(groupId: string, status: string, reason: string, username: string): {success: boolean, message?: string}
    change_point(gameId: string, action: "add" | "remove", point: number, reason: string, ext?: string | null): {success: boolean, point?: number, message?: string}
}

const MAP_BYTES = 128 * 128
const DUPLICATE_PIXEL_RATIO = 0.99
const MAP_PACKET_IDLE_MS = 5_000
const artworkDirectory = path.join(path_utils.get_project_root_path(), "storage", "bangxi_server_storage", "data", "map_artworks")
const scanDirectory = path.join(artworkDirectory, "temp", "scans")
const mapPacketCache = new Map<number, {pixels: Buffer, icons: MapIcon[]}>()

function scanPath(scanId: string) {
    return path.join(scanDirectory, `${scanId}.json`)
}

function authors(value: unknown) {
    if (typeof value !== "string") return ""
    return [...new Map(value.split(",").map(id => id.trim()).filter(id => id.length > 0 && id.length <= 64).map(id => [id.toLocaleLowerCase(), id])).values()].join(", ")
}

function writeScan(scanId: string, username: string, source_pw: string, maps: ScannedMap[]) {
    const scan: StoredScan = {
        username,
        source_pw,
        maps: maps.map(map => ({key: map.key, map_id: map.map_id, pixels_base64: map.pixels.toString("base64"), icons: map.icons, frame: map.frame})),
    }
    fs.mkdirSync(scanDirectory, {recursive: true})
    fs.writeFileSync(scanPath(scanId), JSON.stringify(scan), "utf8")
}

function readScan(scanId: string): {username: string, source_pw: string, maps: ScannedMap[]} | null {
    if (!/^[0-9a-f-]{36}$/i.test(scanId)) return null
    try {
        const scan = JSON.parse(fs.readFileSync(scanPath(scanId), "utf8")) as StoredScan
        if (!scan || typeof scan.username !== "string" || typeof scan.source_pw !== "string" || !Array.isArray(scan.maps)) return null
        const maps = scan.maps.map(map => ({...map, pixels: Buffer.from(map.pixels_base64, "base64")}))
        if (maps.some(map => map.pixels.length !== MAP_BYTES)) return null
        return {username: scan.username, source_pw: scan.source_pw, maps}
    } catch {
        return null
    }
}

function latestCachedScan(username: string, sourcePw: string) {
    try {
        if (!fs.existsSync(scanDirectory)) return null
        const candidates = fs.readdirSync(scanDirectory, {withFileTypes: true})
            .filter(entry => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
            .map(entry => ({scan_id: entry.name.slice(0, -5), modified: fs.statSync(path.join(scanDirectory, entry.name)).mtimeMs}))
            .sort((left, right) => right.modified - left.modified)
        for (const candidate of candidates) {
            const scan = readScan(candidate.scan_id)
            if (scan && scan.maps.length && scan.username.toLocaleLowerCase() === username.toLocaleLowerCase() && scan.source_pw === sourcePw) return {scan_id: candidate.scan_id, ...scan}
        }
    } catch {}
    return null
}

function mergeScannedMaps(freshMaps: ScannedMap[], cachedMaps: ScannedMap[]) {
    const freshCoordinates = new Set(freshMaps.map(map => `${map.frame.x},${map.frame.y},${map.frame.z}`))
    const freshMapIds = new Set(freshMaps.map(map => map.map_id))
    const candidates = [...freshMaps, ...cachedMaps.filter(map => !freshCoordinates.has(`${map.frame.x},${map.frame.y},${map.frame.z}`) && !freshMapIds.has(map.map_id))]
    const merged: ScannedMap[] = []
    for (const map of candidates) {
        if (merged.some(existing => pixelMatchRatio(existing.pixels, map.pixels) >= DUPLICATE_PIXEL_RATIO)) continue
        merged.push(map)
    }
    return sortMapsByProximity(merged)
}

function text(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null
    const result = value.trim()
    return result && result.length <= maxLength ? result : null
}

function integer(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null
}

function tags(value: unknown) {
    if (!Array.isArray(value) || value.length > 10) return null
    const unique = [...new Set(value.map(item => typeof item === "string" ? item.trim() : "").filter(item => item && item.length <= 24))]
    return unique.length === value.length ? unique : null
}

function isManager(user: {role: string}) { return user.role === "admin" || user.role === "owner" }

function canReadGroup(group: any, username: string, canManage: boolean) {
    const author = group?.author?.split(",").some((item: string) => item.trim().toLocaleLowerCase() === username.toLocaleLowerCase())
    return !!group && (canManage || group.creator_username.toLocaleLowerCase() === username.toLocaleLowerCase() || author || (group.status === "published" && group.visibility === "public"))
}

function canEditGroup(group: any, username: string, canManage: boolean) {
    const author = group?.author?.split(",").some((item: string) => item.trim().toLocaleLowerCase() === username.toLocaleLowerCase())
    return !!group && (canManage || group.creator_username.toLocaleLowerCase() === username.toLocaleLowerCase() || author)
}

function identity(request: Request, response: Response) {
    const user = verify_resource_token(request)
    if (!user) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"})
        return null
    }
    return user
}

function storage(response: Response): Storage | null {
    const value = get_storage("bangxi_server_storage") as Storage | undefined
    if (!value?.create_map_artwork_group || !value.search_map_artwork_groups || !value.change_point) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"})
        return null
    }
    return value
}

function delay(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function pixelMatchRatio(left: Buffer, right: Buffer) {
    if (left.length !== MAP_BYTES || right.length !== MAP_BYTES) return 0
    let mismatches = 0
    const maximumMismatches = Math.floor(MAP_BYTES * (1 - DUPLICATE_PIXEL_RATIO))
    for (let index = 0; index < MAP_BYTES; index++) {
        if (left[index] === right[index]) continue
        mismatches++
        // Different artworks almost always exceed the threshold early. Avoid comparing every
        // pixel for every pair while Mineflayer is processing a large gallery.
        if (mismatches > maximumMismatches) return 0
    }
    return 1 - mismatches / MAP_BYTES
}

function sortMapsByProximity(maps: ScannedMap[]) {
    const remaining = [...maps].sort((left, right) => left.frame.x - right.frame.x || left.frame.y - right.frame.y || left.frame.z - right.frame.z || left.map_id - right.map_id)
    const ordered: ScannedMap[] = []
    let current = remaining.shift()
    while (current) {
        ordered.push(current)
        if (!remaining.length) break
        let nearestIndex = 0
        let nearestDistance = Number.POSITIVE_INFINITY
        for (let index = 0; index < remaining.length; index++) {
            const candidate = remaining[index]!
            const dx = current.frame.x - candidate.frame.x
            const dy = current.frame.y - candidate.frame.y
            const dz = current.frame.z - candidate.frame.z
            const distance = dx * dx + dy * dy + dz * dz
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestIndex = index
            }
        }
        current = remaining.splice(nearestIndex, 1)[0]
    }
    return ordered
}

function mapIdFromItem(item: any): number | null {
    const value = item?.nbt?.value?.map?.value ?? item?.nbt?.map?.value ?? item?.nbt?.map
    if (typeof value === "number" && Number.isInteger(value)) return value
    const mapComponent = item?.components?.find?.((component: any) => component?.type === "map_id")
    return typeof mapComponent?.data === "number" && Number.isInteger(mapComponent.data) ? mapComponent.data : null
}

function itemFromFrame(entity: any): any {
    const metadata = entity?.metadata
    if (Array.isArray(metadata)) {
        for (const entry of metadata) {
            const value = entry?.value ?? entry
            if (value?.name === "filled_map" || value?.nbt?.value?.map || value?.nbt?.map) return value
        }
    }
    return entity?.item ?? entity?.heldItem ?? null
}

function itemStackFromMetadata(metadata: any[]) {
    for (const entry of metadata || []) {
        const value = entry?.value ?? entry
        if (value?.components || value?.nbt?.value?.map || value?.nbt?.map) return value
    }
    return null
}

function existingFrames(bot: any) {
    return Object.values(bot.entities || {}).flatMap((entity: any) => {
        const name = String(entity?.name || entity?.displayName || "")
        if (!/(item_frame|glow_item_frame|item frame)/i.test(name) || !entity?.position) return []
        const map_id = mapIdFromItem(itemFromFrame(entity))
        if (map_id === null) return []
        return [{map_id, frame: {x: Math.floor(entity.position.x), y: Math.floor(entity.position.y), z: Math.floor(entity.position.z), facing: entity.yaw === undefined ? null : String(entity.yaw)}}]
    })
}

async function waitForTeleport(instance: any, pw: string) {
    const bot = instance.bot
    const previous = bot.entity?.position?.clone?.()
    await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            bot.off("messagestr", onMessage)
            bot.off("end", onEnd)
            error ? reject(error) : resolve()
        }
        const timeout = setTimeout(() => finish(new Error("等待地标传送超时")), 10_000)
        const onMessage = (message: string) => {
            if (message.includes("地标不存在")) finish(new Error("这个地标不存在"))
            else if (message.includes("已将你传送")) finish()
        }
        const onEnd = () => finish(new Error("Bot 已断开连接"))
        bot.on("messagestr", onMessage)
        bot.once("end", onEnd)
        if (!instance.send_message(`/pw ${pw}`)) finish(new Error("Bot 未连接"))
    })
    if (!previous) return
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
        const current = bot.entity?.position
        if (current && (Math.abs(current.x - previous.x) > 1 || Math.abs(current.y - previous.y) > 1 || Math.abs(current.z - previous.z) > 1)) return
        await delay(100)
    }
    throw new Error("地标传送后未检测到位置变化")
}

async function waitForTeleportRequest(instance: any) {
    const bot = instance.bot
    const previous = bot.entity?.position?.clone?.()
    const requester = await new Promise<string>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error, player?: string) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            bot.off("message", onMessage)
            bot.off("end", onEnd)
            error ? reject(error) : resolve(player!)
        }
        const timeout = setTimeout(() => finish(new Error("等待玩家传送请求超时（20 秒内未收到请求）")), 20_000)
        const onMessage = (message: any, position: any) => {
            // This Mineflayer fork can reclassify systemChat packets containing a
            // player selector as "chat", including Bangxi's clickable TP prompt.
            if (!["system", "public", "chat"].includes(String(position))) return
            const plainText = String(message?.toString?.() || message?.getText?.() || "").replace(/\u00a0/g, " ")
            const match = plainText.match(/\[邦溪\]\s*玩家\s+(\S+)\s+请求你传送到他的位置/)
            if (!match?.[1]) return
            if (!instance.send_message("/tpaccept")) return
            finish(undefined, match[1])
        }
        const onEnd = () => finish(new Error("Bot 已断开连接"))
        bot.on("message", onMessage)
        bot.once("end", onEnd)
    })
    if (!previous) return requester
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
        const current = bot.entity?.position
        if (current && (Math.abs(current.x - previous.x) > 1 || Math.abs(current.y - previous.y) > 1 || Math.abs(current.z - previous.z) > 1)) return requester
        await delay(100)
    }
    throw new Error("接受传送请求后未检测到位置变化")
}

async function waitForChunks(bot: any) {
    if (!bot.entity?.position) throw new Error("无法读取 Bot 传送后的位置")
    const loaded = await new Promise<boolean>(resolve => {
        let settled = false
        let pollTimer: ReturnType<typeof setInterval> | undefined
        const finish = (ready: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            if (pollTimer) clearInterval(pollTimer)
            bot.off("chunkColumnLoad", onChunkLoad)
            resolve(ready)
        }
        const hasCurrentColumn = () => {
            const position = bot.entity?.position
            if (!position) return false
            return Boolean(bot.world?.getColumnAt?.(position) || bot.world?.getColumn?.(Math.floor(position.x / 16), Math.floor(position.z / 16)))
        }
        const onChunkLoad = () => {
            if (hasCurrentColumn()) finish(true)
        }
        const timeout = setTimeout(() => finish(false), 22_000)
        bot.on("chunkColumnLoad", onChunkLoad)
        pollTimer = setInterval(() => {
            if (hasCurrentColumn()) finish(true)
        }, 100)
        if (hasCurrentColumn()) finish(true)
    })
    // Entity spawn and metadata packets follow chunk data; do not inspect frames before they settle.
    await delay(loaded ? 1_500 : 2_500)
}

async function waitForMapPacketsToSettle(lastDistinctMapAt: () => number, isProcessing: () => boolean) {
    while (isProcessing() || Date.now() - lastDistinctMapAt() < MAP_PACKET_IDLE_MS) {
        await delay(100)
    }
}

async function returnHome(instance: any) {
    const bot = instance?.bot
    try {
        instance.send_message("/home home")
        await delay(1_500)
    } catch {}
}

async function scanMaps(instance: any, source_pw: string, mode: "pw" | "teleport" = "pw"): Promise<{maps: ScannedMap[], source_pw: string}> {
    const bot = instance.bot
    const requested = new Map<number, {pixels: Buffer, received: Uint8Array, icons: MapIcon[], complete: boolean}>()
    const frames = new Map<number, {map_id: number | null, frame: {x: number, y: number, z: number, facing: string | null}}>()
    const distinctPixels: Buffer[] = []
    const classifiedMapIds = new Set<number>()
    const pendingMapIds: number[] = []
    let pixelQueueRunning = false
    let lastDistinctMapAt = 0
    const processPixelQueue = async () => {
        if (pixelQueueRunning) return
        pixelQueueRunning = true
        try {
            while (pendingMapIds.length) {
                const mapId = pendingMapIds.shift()!
                const entry = requested.get(mapId)
                if (entry && !distinctPixels.some(pixels => pixelMatchRatio(pixels, entry.pixels) >= DUPLICATE_PIXEL_RATIO)) {
                    distinctPixels.push(Buffer.from(entry.pixels))
                    lastDistinctMapAt = Date.now()
                }
                // Let Mineflayer decode network traffic and answer keepalive packets between
                // expensive map comparisons.
                await new Promise<void>(resolve => setImmediate(resolve))
            }
        } finally {
            pixelQueueRunning = false
            if (pendingMapIds.length) void processPixelQueue()
        }
    }
    const isItemFrame = (entityId: number, type?: number) => {
        // The captured target server protocol identifies item frames as spawn entity type 60.
        if (type === 60) return true
        const entity = bot.entities?.[entityId]
        const entityName = String(entity?.name || entity?.displayName || bot.registry?.entitiesById?.[type ?? -1]?.name || "")
        return /item_frame|glow_item_frame|item frame/i.test(entityName)
    }
    const spawnListener = (packet: any) => {
        if (!isItemFrame(packet?.entityId, packet?.type)) return
        frames.set(packet.entityId, {
            map_id: null,
            frame: {x: Math.floor(packet.x), y: Math.floor(packet.y), z: Math.floor(packet.z), facing: packet.yaw === undefined ? null : String(packet.yaw)},
        })
    }
    const metadataListener = (packet: any) => {
        const frame = frames.get(packet?.entityId)
        if (!frame) return
        const map_id = mapIdFromItem(itemStackFromMetadata(packet.metadata))
        if (map_id !== null) frame.map_id = map_id
        const direction = packet.metadata?.find((entry: any) => entry?.type === "direction")?.value
        if (direction !== undefined) frame.frame.facing = String(direction)
    }
    const mapListener = (packet: any) => {
        const mapId = packet?.itemDamage
        if (!Number.isInteger(mapId)) return
        let entry = requested.get(mapId)
        if (!entry) {
            entry = {pixels: Buffer.alloc(MAP_BYTES), received: new Uint8Array(MAP_BYTES), icons: [], complete: false}
            requested.set(mapId, entry)
        }
        const data = packet?.data
        if (!data?.length) return
        const bytes = Buffer.from(data)
        if (bytes.length === MAP_BYTES) {
            bytes.copy(entry.pixels)
            entry.received.fill(1)
            entry.complete = true
        } else {
            const x = Number(packet.x ?? 0), y = Number(packet.y ?? 0)
            const columns = Number(packet.columns ?? packet.width ?? 0), rows = Number(packet.rows ?? packet.height ?? 0)
            if (columns > 0 && rows > 0 && bytes.length >= columns * rows) {
                for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
                    const target = (y + row) * 128 + x + column
                    if (target >= 0 && target < MAP_BYTES) { entry.pixels[target] = bytes[row * columns + column]; entry.received[target] = 1 }
                }
            }
            entry.complete = !entry.received.some(value => value === 0)
        }
        if (Array.isArray(packet.icons)) entry.icons = packet.icons
        if (!classifiedMapIds.has(mapId) && entry.complete) {
            mapPacketCache.set(mapId, {pixels: Buffer.from(entry.pixels), icons: entry.icons})
            classifiedMapIds.add(mapId)
            pendingMapIds.push(mapId)
            void processPixelQueue()
        }
    }
    bot._client.on("map", mapListener)
    bot._client.on("spawn_entity", spawnListener)
    bot._client.on("entity_metadata", metadataListener)
    try {
        if (mode === "teleport") source_pw = `传送:${await waitForTeleportRequest(instance)}`
        else await waitForTeleport(instance, source_pw)
        lastDistinctMapAt = Date.now()
        await waitForChunks(bot)
        // Only a non-duplicate complete map resets the idle window. Repeated packet variants
        // from the same artwork do not extend the scan duration.
        await waitForMapPacketsToSettle(() => lastDistinctMapAt, () => pixelQueueRunning || pendingMapIds.length > 0)
        const unique = new Map<string, {map_id: number, frame: {x: number, y: number, z: number, facing: string | null}}>()
        for (const frame of [...frames.values(), ...existingFrames(bot).map(frame => ({map_id: frame.map_id, frame: frame.frame}))]) {
            if (frame.map_id === null) continue
            const key = `${frame.frame.x},${frame.frame.y},${frame.frame.z}`
            // The server can expose multiple map IDs for one frame position. They represent
            // one displayed artwork, so keep only its first captured map reference.
            if (!unique.has(key)) unique.set(key, {map_id: frame.map_id, frame: frame.frame})
        }
        for (const frame of unique.values()) {
            const mapId = frame.map_id
            if (!requested.has(mapId)) {
                const cached = mapPacketCache.get(mapId)
                requested.set(mapId, cached
                    ? {pixels: Buffer.from(cached.pixels), received: new Uint8Array(MAP_BYTES).fill(1), icons: cached.icons, complete: true}
                    : {pixels: Buffer.alloc(MAP_BYTES), received: new Uint8Array(MAP_BYTES), icons: [], complete: false})
            }
        }
        for (const [mapId, entry] of requested) if (entry.complete && !classifiedMapIds.has(mapId)) {
            classifiedMapIds.add(mapId)
            pendingMapIds.push(mapId)
        }
        if (pendingMapIds.length) await processPixelQueue()
        const maps = [...unique.values()].flatMap(frame => {
            const entry = requested.get(frame.map_id)!
            if (!entry.complete) return []
            return [{key: crypto.randomUUID(), map_id: frame.map_id, pixels: entry.pixels, icons: entry.icons, frame: frame.frame}]
        })
        const distinct: ScannedMap[] = []
        for (const map of maps) {
            if (distinct.some(existing => pixelMatchRatio(existing.pixels, map.pixels) >= DUPLICATE_PIXEL_RATIO)) continue
            distinct.push(map)
        }
        // Order by actual three-dimensional proximity rather than a single-axis sort.
        return {maps: sortMapsByProximity(distinct), source_pw}
    } finally {
        await returnHome(instance)
        bot._client.removeListener("map", mapListener)
        bot._client.removeListener("spawn_entity", spawnListener)
        bot._client.removeListener("entity_metadata", metadataListener)
    }
}

function readArtworkFiles(artwork: any) {
    const raw = path.join(artworkDirectory, "raw", artwork.dat_name)
    const icons = path.join(artworkDirectory, "icons", artwork.icons_file)
    if (!fs.existsSync(raw)) return null
    return {pixels_base64: fs.readFileSync(raw).toString("base64"), icons: fs.existsSync(icons) ? JSON.parse(fs.readFileSync(icons, "utf8")) : []}
}

function layoutTiles(value: unknown) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 256) return null
    const positions = new Set<string>()
    const result: Array<{id: number, x: number, y: number, rotation: number, mirror: boolean}> = []
    for (const tile of value) {
        const id = integer(tile?.id), x = integer(tile?.x), y = integer(tile?.y), rotation = integer(tile?.rotation)
        const mirror = tile?.mirror
        if (id === null || x === null || y === null || rotation === null || typeof mirror !== "boolean" || !Number.isSafeInteger(id) || Math.abs(x) > 64 || Math.abs(y) > 64 || ![0, 90, 180, 270].includes(rotation) || positions.has(`${x},${y}`)) return null
        positions.add(`${x},${y}`); result.push({id, x, y, rotation, mirror})
    }
    return result
}

async function saveLayoutPreview(group: any, pngBase64: unknown) {
    if (typeof pngBase64 !== "string") return {success: false as const, message: "排版预览无效"}
    const encoded = pngBase64.replace(/^data:image\/png;base64,/, "")
    if (!encoded || encoded.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return {success: false as const, message: "排版预览无效或过大"}
    const preview = Buffer.from(encoded, "base64")
    try {
        const metadata = await sharp(preview).metadata()
        if (metadata.format !== "png" || !metadata.width || !metadata.height || metadata.width > 16_384 || metadata.height > 16_384) return {success: false as const, message: "排版预览尺寸无效"}
    } catch { return {success: false as const, message: "无法解析排版预览"} }
    const file = String(group.preview_file || "")
    if (!/^group_[0-9a-f-]{36}\.png$/i.test(file)) return {success: false as const, message: "预览文件无效"}
    const target = path.join(artworkDirectory, "preview", file)
    if (!fs.existsSync(target)) return {success: false as const, message: "原始预览文件不存在"}
    return {success: true as const, target, previous: fs.readFileSync(target), preview}
}

export async function init(app: Express) {
    app.get("/api/map-shares-preview/:file", (request, response) => {
        const user = identity(request, response), db = storage(response)
        if (!user || !db) return
        const file = request.params.file
        if (!/^group_[0-9a-f-]{36}\.png$/i.test(file)) { response.status(400).end(); return }
        const groupId = file.slice("group_".length, -".png".length)
        if (!db.get_map_artwork_group_record(groupId, user.username, isManager(user))) { response.status(404).end(); return }
        const target = path.join(artworkDirectory, "preview", file)
        if (!fs.existsSync(target)) { response.status(404).end(); return }
        response.type("png").sendFile(target)
    })

    app.post("/api/map-shares/scan", async (request, response) => {
        const user = identity(request, response), db = storage(response)
        const mode = request.body?.mode === "teleport" ? "teleport" : "pw"
        const pw = text(request.body?.pw, 128)
        if (!user || !db || (mode === "pw" && !pw)) { if (user && db) response.status(400).json({success: false, message: "PW 地址无效"}); return }
        let sourcePw = pw || ""
        let cached = mode === "pw" ? latestCachedScan(user.username, sourcePw) : null
        const instance = get_game_adapter("mineflayer", "bangxi") as any
        if (!instance?.bot || instance.status !== "running" || !instance.execute_single_task) { response.status(503).json({success: false, message: "Bot 暂未连接至服务器"}); return }
        let maps: ScannedMap[] = []
        let chargeFailure = ""
        try {
            const accepted = await instance.execute_single_task(async () => {
                const charge = db.change_point(user.username, "remove", 100, "读取地图画", "map_share_scan")
                if (!charge.success) { chargeFailure = charge.message || "扣除 100 积分失败"; return }
                const scanned = await scanMaps(instance, sourcePw, mode)
                maps = scanned.maps
                sourcePw = scanned.source_pw
                if (mode === "teleport") cached = latestCachedScan(user.username, sourcePw)
            })
            if (!accepted) { response.status(409).json({success: false, message: "Bot 正在执行其他任务，请稍后重试"}); return }
            if (chargeFailure) { response.status(402).json({success: false, message: chargeFailure}); return }
        } catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "地图画扫描失败"}); return }
        const fresh_count = maps.length
        maps = mergeScannedMaps(maps, cached?.maps || [])
        const scan_id = crypto.randomUUID()
        try { writeScan(scan_id, user.username, sourcePw, maps) } catch (error) { response.status(500).json({success: false, message: error instanceof Error ? error.message : "扫描缓存写入失败"}); return }
        const hashes = maps.map(map => crypto.createHash("sha256").update(map.pixels).digest("hex"))
        const existing = db.get_existing_map_artwork_content_hashes(hashes)
        response.json({success: true, scan_id, source_pw: sourcePw, cache_merged: !!cached, fresh_count, maps: maps.map((map, index) => ({key: map.key, map_id: map.map_id, icons: map.icons, frame: map.frame, pixels_base64: map.pixels.toString("base64"), exists: existing.has(hashes[index]!)}))})
    })

    app.post("/api/map-shares", (request, response) => {
        const user = identity(request, response), db = storage(response)
        const scan_id = text(request.body?.scan_id, 64), name = text(request.body?.name, 128), price = text(request.body?.price, 64), author = authors(request.body?.author)
        const description = typeof request.body?.description === "string" && request.body.description.trim().length <= 1000 ? request.body.description.trim() : null
        const category = text(request.body?.category || "other", 32), visibility = text(request.body?.visibility || "public", 16), artworkTags = tags(request.body?.tags || [])
        const selected = Array.isArray(request.body?.maps) ? request.body.maps : null
        if (!user || !db || !scan_id || !name || !price || !author || description === null || !category || !artworkTags || !["public", "unlisted", "private"].includes(visibility || "") || !selected?.length) { if (user && db) response.status(400).json({success: false, message: "地图画提交参数无效"}); return }
        const scan = readScan(scan_id)
        if (!scan || scan.username !== user.username) { response.status(404).json({success: false, message: "未找到对应的扫描缓存"}); return }
        const mapByKey = new Map(scan.maps.map(map => [map.key, map]))
        const positions = new Set<string>(), selectedMaps: Array<{map: ScannedMap, x: number, y: number, rotation: number, mirror: boolean}> = []
        for (const value of selected) {
            const key = text(value?.key, 64), x = integer(value?.x), y = integer(value?.y), rotation = integer(value?.rotation), mirror = typeof value?.mirror === "boolean" ? value.mirror : false, map = key ? mapByKey.get(key) : undefined
            if (!map || x === null || y === null || rotation === null || ![0, 90, 180, 270].includes(rotation) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || positions.has(`${x},${y}`)) { response.status(400).json({success: false, message: "地图选择、旋转或拼图坐标无效"}); return }
            positions.add(`${x},${y}`); selectedMaps.push({map, x, y, rotation, mirror})
        }
        const preview = typeof request.body?.preview_png_base64 === "string" ? request.body.preview_png_base64.replace(/^data:image\/png;base64,/, "") : ""
        if (!preview || !/^[A-Za-z0-9+/=]+$/.test(preview)) { response.status(400).json({success: false, message: "PNG 预览无效"}); return }
        const previewBuffer = Buffer.from(preview, "base64")
        const artwork_hash = crypto.createHash("sha256").update(previewBuffer).digest("hex")
        const existingArtwork = db.get_map_artwork_by_artwork_hash(artwork_hash)
        if (existingArtwork) {
            const existingGroup = db.get_map_artwork_group_record(existingArtwork.group_id, user.username, isManager(user))
            response.status(409).json({success: false, duplicate: true, existing_id: existingArtwork.id, existing_group_id: existingGroup?.group_id || null, message: "完整地图画已存在，不能重复添加"})
            return
        }
        const group_id = crypto.randomUUID()
        fs.mkdirSync(path.join(artworkDirectory, "raw"), {recursive: true}); fs.mkdirSync(path.join(artworkDirectory, "icons"), {recursive: true}); fs.mkdirSync(path.join(artworkDirectory, "preview"), {recursive: true})
        const preview_file = `group_${group_id}.png`
        fs.writeFileSync(path.join(artworkDirectory, "preview", preview_file), previewBuffer)
        const rows = selectedMaps.map(({map, x, y, rotation, mirror}, index) => {
            const content_hash = crypto.createHash("sha256").update(map.pixels).digest("hex"), dat_name = `map_${group_id}_${x}_${y}.dat`, icons_file = `map_${group_id}_${x}_${y}.json`
            fs.writeFileSync(path.join(artworkDirectory, "raw", dat_name), map.pixels, {flag: "wx"})
            fs.writeFileSync(path.join(artworkDirectory, "icons", icons_file), JSON.stringify(map.icons), {flag: "wx"})
            return {dat_name, content_hash, artwork_hash: index === 0 ? artwork_hash : null, name, price, source_pw: scan.source_pw, author, creator_username: user.username, group_id, group_position_x: x, group_position_y: y, rotation, mirror: mirror ? 1 : 0, map_id: map.map_id, frame_x: map.frame.x, frame_y: map.frame.y, frame_z: map.frame.z, frame_facing: map.frame.facing, icons_file, preview_file}
        })
        const result = db.create_map_artwork_group({group_id, name, price, source_pw: scan.source_pw, author, description, category, tags: artworkTags, creator_username: user.username, preview_file, artwork_hash, visibility, status: "published"}, rows)
        if (!result.success) { response.status(409).json({success: false, message: result.message || "地图画保存失败"}); return }
        response.status(201).json({success: true, ids: result.ids, group_id, remaining: Math.max(0, scan.maps.length - selectedMaps.length)})
    })

    app.get("/api/map-shares", (request, response) => {
        if (!identity(request, response)) return
        const db = storage(response); if (!db) return
        const page = Math.max(1, Number(request.query.page) || 1), limit = Math.min(30, Math.max(1, Number(request.query.limit) || 12))
        const user = identity(request, response); if (!user) return
        const scope = text(request.query.scope, 16)
        const filters = {name: text(request.query.name, 128) || undefined, author: text(request.query.author, 256) || undefined, description: text(request.query.description, 128) || undefined, tags: text(request.query.tags, 128) || undefined, source_pw: text(request.query.source_pw, 128) || undefined, category: text(request.query.category, 32) || undefined, visibility: text(request.query.visibility, 16) || undefined, status: text(request.query.status, 16) || undefined, scope: ["favorites", "added", "created"].includes(scope || "") ? scope : undefined, sort: text(request.query.sort, 16) || undefined}
        const result = db.search_map_artwork_groups(page, limit, filters, user.username, isManager(user))
        response.json({success: true, artworks: result.groups, pagination: {page, limit, total: result.total, total_pages: Math.max(1, Math.ceil(result.total / limit))}})
    })

    app.get("/api/map-shares/groups/:groupId", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64)
        if (!user || !db || !groupId) { if (user && db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const group = db.get_map_artwork_group_record(groupId, user.username, isManager(user))
        if (!group) { response.status(404).json({success: false, message: "地图画不存在或无权访问"}); return }
        db.increment_map_artwork_views(groupId)
        const author = group.author?.split(",").some((item: string) => item.trim().toLocaleLowerCase() === user.username.toLocaleLowerCase())
        response.json({success: true, artwork: {...group, view_count: group.view_count + 1}, tiles: db.get_map_artwork_group(groupId), versions: (group.creator_username === user.username || author || isManager(user)) ? db.list_map_artwork_versions(groupId) : []})
    })

    app.patch("/api/map-shares/groups/:groupId", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64)
        const updates: any = {}
        const fields: Array<[string, number]> = [["name", 128], ["price", 64], ["source_pw", 128], ["author", 256], ["description", 1000], ["category", 32], ["visibility", 16], ["status", 16]]
        for (const [field, max] of fields) if (request.body?.[field] !== undefined) { const value = field === "author" ? authors(request.body[field]) : text(request.body[field], max); if (!value && field !== "description") { response.status(400).json({success: false, message: `${field} 无效`}); return } updates[field] = value || "" }
        if (request.body?.tags !== undefined) { const value = tags(request.body.tags); if (!value) { response.status(400).json({success: false, message: "标签无效"}); return } updates.tags = value }
        if (!user || !db || !groupId || (updates.visibility && !["public", "unlisted", "private"].includes(updates.visibility)) || (updates.status && !["draft", "pending", "published"].includes(updates.status))) { if (user && db) response.status(400).json({success: false, message: "作品信息无效"}); return }
        const result = db.update_map_artwork_group(groupId, updates, user.username, isManager(user))
        if (!result.success) { response.status(403).json(result); return }
        response.json({success: true})
    })

    app.get("/api/map-shares/groups/:groupId/layout", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64)
        if (!user || !db || !groupId) { if (user && db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const group = db.get_map_artwork_group_record(groupId, user.username, isManager(user))
        if (!canEditGroup(group, user.username, isManager(user))) { response.status(403).json({success: false, message: "无权重新设计该地图画"}); return }
        const tiles = db.get_map_artwork_group(groupId).map((tile: any) => ({...tile, ...readArtworkFiles(tile)}))
        if (tiles.some((tile: any) => !tile.pixels_base64)) { response.status(409).json({success: false, message: "部分原始图块缺失"}); return }
        response.json({success: true, tiles})
    })

    app.patch("/api/map-shares/groups/:groupId/layout", async (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64), layout = layoutTiles(request.body?.tiles)
        if (!user || !db || !groupId || !layout) { if (user && db) response.status(400).json({success: false, message: "图块排版参数无效"}); return }
        const group = db.get_map_artwork_group_record(groupId, user.username, isManager(user))
        if (!canEditGroup(group, user.username, isManager(user))) { response.status(403).json({success: false, message: "无权重新设计该地图画"}); return }
        const preview = await saveLayoutPreview(group, request.body?.preview_png_base64)
        if (!preview.success) { response.status(400).json(preview); return }
        try {
            fs.writeFileSync(preview.target, preview.preview)
            const result = db.update_map_artwork_layout(groupId, layout, user.username, isManager(user))
            if (!result.success) { fs.writeFileSync(preview.target, preview.previous); response.status(403).json(result); return }
            response.json({success: true})
        } catch (error) {
            try { fs.writeFileSync(preview.target, preview.previous) } catch {}
            response.status(500).json({success: false, message: error instanceof Error ? error.message : "图块排版保存失败"})
        }
    })

    app.delete("/api/map-shares/groups/:groupId", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64)
        if (!user || !db || !groupId) { if (user && db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const result = db.delete_map_artwork_group(groupId, user.username, isManager(user))
        if (!result.success) { response.status(403).json(result); return }
        try { for (const tile of result.tiles || []) { fs.rmSync(path.join(artworkDirectory, "raw", tile.dat_name), {force: true}); fs.rmSync(path.join(artworkDirectory, "icons", tile.icons_file), {force: true}) }; if (result.group?.preview_file) fs.rmSync(path.join(artworkDirectory, "preview", result.group.preview_file), {force: true}) } catch {}
        response.json({success: true})
    })

    app.put("/api/map-shares/groups/:groupId/favorite", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64)
        if (!user || !db || !groupId || typeof request.body?.enabled !== "boolean") { if (user && db) response.status(400).json({success: false, message: "收藏参数无效"}); return }
        const group = db.get_map_artwork_group_record(groupId, user.username, isManager(user)); if (!group) { response.status(404).json({success: false, message: "地图画不存在"}); return }
        response.json(db.toggle_map_artwork_favorite(groupId, user.username, request.body.enabled))
    })

    app.post("/api/map-shares/groups/:groupId/reports", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64), reason = text(request.body?.reason, 300)
        if (!user || !db || !groupId || !reason) { if (user && db) response.status(400).json({success: false, message: "举报原因无效"}); return }
        if (!db.get_map_artwork_group_record(groupId, user.username, isManager(user))) { response.status(404).json({success: false, message: "地图画不存在"}); return }
        db.create_map_artwork_report(groupId, user.username, reason); response.status(201).json({success: true})
    })

    app.post("/api/map-shares/groups/:groupId/versions/:revision/restore", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64), revision = Number(request.params.revision)
        if (!user || !db || !groupId || !Number.isSafeInteger(revision) || revision < 1) { if (user && db) response.status(400).json({success: false, message: "版本参数无效"}); return }
        const result = db.restore_map_artwork_version(groupId, revision, user.username, isManager(user))
        if (!result.success) { response.status(403).json(result); return }
        response.json({success: true})
    })

    app.get("/api/map-shares/groups/:groupId/export", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64)
        if (!user || !db || !groupId) { if (user && db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const group = db.get_map_artwork_group_record(groupId, user.username, isManager(user)); if (!group) { response.status(404).json({success: false, message: "地图画不存在或无权访问"}); return }
        const tiles = db.get_map_artwork_group(groupId).map((tile: any) => ({...tile, ...readArtworkFiles(tile)}))
        response.setHeader("Content-Disposition", `attachment; filename=map-artwork-${groupId}.json`)
        const preview = fs.readFileSync(path.join(artworkDirectory, "preview", group.preview_file)).toString("base64")
        response.type("application/json").send(JSON.stringify({artwork: group, preview_png_base64: preview, tiles}, null, 2))
    })

    app.patch("/api/map-shares/groups/:groupId/moderation", (request, response) => {
        const user = identity(request, response), db = storage(response), groupId = text(request.params.groupId, 64), status = text(request.body?.status, 16), reason = typeof request.body?.reason === "string" ? request.body.reason.trim().slice(0, 500) : ""
        if (!user || !db || !groupId || !status || !isManager(user) || !["pending", "published", "hidden", "rejected"].includes(status)) { if (user && db) response.status(400).json({success: false, message: "审核参数无效"}); return }
        const result = db.moderate_map_artwork_group(groupId, status, reason, user.username); if (!result.success) { response.status(404).json(result); return }; response.json({success: true})
    })

    app.get("/api/map-shares/:id", (request, response) => {
        if (!identity(request, response)) return
        const db = storage(response), id = Number(request.params.id); if (!db || !Number.isSafeInteger(id)) { if (db) response.status(400).json({success: false, message: "地图画 ID 无效"}); return }
        const artwork = db.get_map_artwork(id), data = artwork && readArtworkFiles(artwork)
        if (!artwork || !data) { response.status(404).json({success: false, message: "地图画不存在或原始文件缺失"}); return }
        response.json({success: true, artwork, ...data, group: db.get_map_artwork_group(artwork.group_id)})
    })

    app.patch("/api/map-shares/:id", (request, response) => {
        const user = identity(request, response), db = storage(response), id = Number(request.params.id), name = text(request.body?.name, 128)
        if (!user || !db || !Number.isSafeInteger(id) || !name) { if (user && db) response.status(400).json({success: false, message: "地图画名称无效"}); return }
        const artwork = db.get_map_artwork(id)
        if (!artwork) { response.status(404).json({success: false, message: "地图画不存在"}); return }
        const result = db.update_map_artwork_group(artwork.group_id, {name}, user.username, isManager(user))
        if (!result.success) { response.status(403).json({success: false, message: result.message}); return }
        response.json({success: true})
    })
}
