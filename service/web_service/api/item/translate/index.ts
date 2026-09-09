import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {createRequire} from "node:module"
import type {Express, Request, Response} from "express"
import {verify_resource_token} from "../../user/auth/index.js"

const _require = createRequire(import.meta.url)
const mcAssets = _require("minecraft-assets")("1.21.8")

interface TranslationMap {
    zh_cn: Record<string, string>
    en_us: Record<string, string>
}

let translationMap: TranslationMap | null = null
let reverseMap: Record<string, string> | null = null

function loadTranslations(): TranslationMap {
    if (translationMap) return translationMap
    const baseDir = path.resolve(fileURLToPath(import.meta.url), "../../../../../../game_adapter/mineflayer/data/language")
    translationMap = {
        zh_cn: JSON.parse(fs.readFileSync(path.join(baseDir, "zh_cn", "zh_cn.json"), "utf8")),
        en_us: JSON.parse(fs.readFileSync(path.join(baseDir, "en_us", "en_us.json"), "utf8")),
    }
    return translationMap
}

function loadReverseMap(): Record<string, string> {
    if (reverseMap) return reverseMap
    const maps = loadTranslations()
    reverseMap = {}
    for (const lang of ["zh_cn", "en_us"] as const) {
        for (const [key, value] of Object.entries(maps[lang])) {
            if ((key.startsWith("item.minecraft.") || key.startsWith("block.minecraft.")) && !reverseMap[value]) {
                reverseMap[value] = key
            }
        }
    }
    return reverseMap
}

function getItemKey(input: string): string | null {
    const normalized = input.trim()
    const lower = normalized.toLowerCase()

    const rawName = (() => {
        if (lower.startsWith("item.minecraft.")) return lower.slice("item.minecraft.".length)
        if (lower.startsWith("block.minecraft.")) return lower.slice("block.minecraft.".length)
        if (lower.startsWith("minecraft:")) return lower.slice("minecraft:".length)
        return null
    })()

    if (rawName) {
        const itemKey = `item.minecraft.${rawName}`
        const blockKey = `block.minecraft.${rawName}`
        const maps = loadTranslations()
        if (maps.zh_cn[itemKey] || maps.en_us[itemKey]) return itemKey
        if (maps.zh_cn[blockKey] || maps.en_us[blockKey]) return blockKey
    }

    const rev = loadReverseMap()
    const exact = rev[normalized]
    if (exact) return exact

    for (const [displayName, key] of Object.entries(rev)) {
        if (displayName.includes(normalized) || normalized.includes(displayName.toLowerCase())) {
            return key
        }
    }

    return null
}

function getTexturePath(rawName: string): string | null {
    const item = mcAssets.items[rawName]
    if (!item?.texture) return null
    const texturePath = item.texture.replace("minecraft:", "")
    const fixedPath = texturePath.replace(/^block\//, "blocks/")
    return fixedPath
}

function getTexture(input: string): string | null {
    const key = getItemKey(input)
    if (!key) return null
    const rawName = key.replace(/^(item|block)\.minecraft\./, "")
    const texturePath = getTexturePath(rawName)
    if (!texturePath) return null

    const filePath = path.join(mcAssets.directory, texturePath + ".png")
    try {
        if (!fs.existsSync(filePath)) return null
        const buffer = fs.readFileSync(filePath)
        return `data:image/png;base64,${buffer.toString("base64")}`
    } catch {
        return null
    }
}

export async function init(app: Express) {
    loadTranslations()
    loadReverseMap()

    app.get("/api/item/translate", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"})
            return
        }

        const name = request.query.name
        if (typeof name !== "string" || !name.trim()) {
            response.status(400).json({success: false, message: "name 必须是非空字符串"})
            return
        }

        const key = getItemKey(name)
        const maps = loadTranslations()
        const zhName = key ? maps.zh_cn[key] || null : null
        const enName = key ? maps.en_us[key] || null : null
        const texture = getTexture(name)

        response.json({
            success: true,
            item: name.trim(),
            item_key: key,
            translate: {
                zh_cn: zhName,
                en_us: enName,
            },
            texture,
        })
    })

    app.post("/api/item/translate/batch", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"})
            return
        }

        const {items} = request.body ?? {}
        if (!Array.isArray(items)) {
            response.status(400).json({success: false, message: "items 必须是数组"})
            return
        }

        const maxItems = 1000
        const maps = loadTranslations()
        const limited = items.slice(0, maxItems).map((item: unknown) => {
            const name = typeof item === "string" ? item.trim() : ""
            if (!name) return null
            const key = getItemKey(name)
            const zhName = key ? maps.zh_cn[key] || null : null
            const enName = key ? maps.en_us[key] || null : null
            const texture = getTexture(name)
            return {
                item: name,
                item_key: key,
                translate: {
                    zh_cn: zhName,
                    en_us: enName,
                },
                texture,
            }
        }).filter(Boolean)

        response.json({
            success: true,
            items: limited,
            total: limited.length,
        })
    })

    app.get("/api/item/texture", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"})
            return
        }

        const name = request.query.name
        if (typeof name !== "string" || !name.trim()) {
            response.status(400).json({success: false, message: "name 必须是非空字符串"})
            return
        }

        const texture = getTexture(name)
        if (!texture) {
            response.status(404).json({success: false, message: "没有找到该物品的纹理"})
            return
        }

        response.json({success: true, item: name.trim(), texture})
    })
}