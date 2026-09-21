import fs from "node:fs"
import path from "node:path"
import {message as Structs} from "@snowluma/sdk"
import {send_message} from "../../../chat_adapter/index.js"
import {get_storage} from "../../../storage/index.js"
import {get_chat_adapter_prefix, plugin_logger} from "../../index.js"
import {help} from "../../type.js"
import {path_utils} from "../../../utils/path_utils.js"

type Artwork = {
    name: string
    author: string
    price: string
    source_pw: string
    description: string
    category: string
    tags: string
    creator_username: string
    preview_file: string
    view_count: number
    like_count: number
    created_at: string
}

type ArtworkStorage = {
    get_random_public_map_artwork_group(): Artwork | null
    get_public_map_artwork_groups_by_name(name: string): Artwork[]
    list_public_map_artwork_groups(page?: number, limit?: number): {groups: Artwork[], total: number}
    search_public_map_artwork_group_names(field: "name" | "author", keyword: string, page?: number, limit?: number): {groups: Array<Pick<Artwork, "name" | "author">>, total: number}
}

const previewDirectory = path.join(path_utils.get_project_root_path(), "storage", "bangxi_server_storage", "data", "map_artworks", "preview")

export class init {
    public help: help = {
        name: "map", keyword: "map", description: "查询公开地图画", permission: 0,
        args: [
            {key: "random", description: "随机获取一张公开地图画", permission: 0, args: []},
            {key: "list", description: "按添加时间分页列出公开地图画（每页 3 条）", permission: 0, args: [{key: "页码", description: "可选，默认第 1 页", permission: 0, args: []}]},
            {key: "get", description: "按完整名称获取地图画详情", permission: 0, args: [{key: "名称", description: "地图画完整名称", permission: 0, args: []}]},
            {key: "search", description: "按名称或作者模糊查询地图画", permission: 0, args: [
                {key: "name", description: "按名称搜索", permission: 0, args: [{key: "关键词 [页码]", description: "关键词与可选页码", permission: 0, args: []}]},
                {key: "author", description: "按作者搜索", permission: 0, args: [{key: "关键词 [页码]", description: "关键词与可选页码", permission: 0, args: []}]},
            ]},
        ], platform: "chat_adapter",
    }
    private commandStart = get_chat_adapter_prefix() + this.help.keyword

    async event_handler(_event: string, data: any) {
        if (data.adapter_platform !== "chat_adapter") return
        const args = String(data.raw_message || "").trim().split(/\s+/)
        if (args[0] !== this.commandStart) return
        try {
            const storage = get_storage("bangxi_server_storage")
            if (!storage) return this.reply(data, "地图画系统未初始化")
            const action = args[1]?.toLowerCase()
            if (action === "random") return this.showArtwork(data, storage.get_random_public_map_artwork_group())
            if (action === "list") return this.listArtworks(data, storage, args.slice(2))
            if (action === "get") return this.getArtwork(data, storage, args.slice(2).join(" ").trim())
            if (action === "search") return this.searchArtwork(data, storage, args.slice(2))
            this.reply(data, "用法：map random | map list [页码] | map get <名称> | map search <name|author> <关键词> [页码]")
        } catch (error) {
            plugin_logger("map", error instanceof Error ? error.stack || error.message : String(error), "error")
            this.reply(data, "地图画查询失败，请稍后重试")
        }
    }

    private getArtwork(data: any, storage: ArtworkStorage, name: string) {
        if (!name) return this.reply(data, "用法：map get <地图画完整名称>")
        const artworks = storage.get_public_map_artwork_groups_by_name(name) as Artwork[]
        if (!artworks.length) return this.reply(data, "未找到公开的已发布地图画")
        for (const artwork of artworks) this.showArtwork(data, artwork)
    }

    private listArtworks(data: any, storage: ArtworkStorage, args: string[]) {
        if (args.length > 1 || (args[0] && !/^\d+$/.test(args[0]))) return this.reply(data, "用法：map list [页码]")
        const page = Number(args[0] || 1)
        if (!Number.isSafeInteger(page) || page < 1) return this.reply(data, "页码必须是正整数")
        const limit = 3
        const result = storage.list_public_map_artwork_groups(page, limit)
        const totalPages = Math.max(1, Math.ceil(result.total / limit))
        if (page > totalPages || !result.groups.length) return this.reply(data, `没有第 ${page} 页地图画，共 ${result.total} 个公开作品`)
        const artworks = result.groups.map((artwork, index) => this.artworkSegments(artwork, (page - 1) * limit + index + 1)).filter((segments): segments is any[] => segments !== null)
        if (!artworks.length) return this.reply(data, "本页地图画预览文件不存在")
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n公开地图画（按添加时间排序）\n第 ${page} / ${totalPages} 页，共 ${result.total} 个；本页 ${artworks.length} 个作品。`), ...artworks.flat()], data.origin_object)
    }

    private searchArtwork(data: any, storage: ArtworkStorage, args: string[]) {
        const field = args.shift()?.toLowerCase()
        if (field !== "name" && field !== "author") return this.reply(data, "用法：map search <name|author> <关键词> [页码]")
        const final = args[args.length - 1]
        const page = final && /^\d+$/.test(final) ? Number(args.pop()) : 1
        const keyword = args.join(" ").trim()
        if (!keyword) return this.reply(data, "请输入搜索关键词")
        const result = storage.search_public_map_artwork_group_names(field, keyword, Math.max(1, page), 10)
        const totalPages = Math.max(1, Math.ceil(result.total / 10))
        if (page > totalPages || !result.groups.length) return this.reply(data, `没有第 ${page} 页结果，共 ${result.total} 个匹配地图画`)
        const label = field === "name" ? "名称" : "作者"
        const lines = result.groups.map((artwork: Pick<Artwork, "name" | "author">, index: number) => `${(page - 1) * 10 + index + 1}. ${artwork.name}【${artwork.author || "未知作者"}】`)
        this.reply(data, `按${label}搜索“${keyword}”\n${lines.join("\n")}\n第 ${page} / ${totalPages} 页，共 ${result.total} 个`)
    }

    private showArtwork(data: any, artwork: Artwork | null) {
        if (!artwork) return this.reply(data, "未找到公开的已发布地图画")
        const segments = this.artworkSegments(artwork)
        if (!segments) return this.reply(data, "地图画预览文件不存在")
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), ...segments], data.origin_object)
    }

    private artworkSegments(artwork: Artwork, index?: number): any[] | null {
        const preview = path.join(previewDirectory, artwork.preview_file)
        if (!/^[\w.-]+\.png$/i.test(artwork.preview_file) || !fs.existsSync(preview)) return null
        const tags = this.tags(artwork.tags)
        const details = [
            index === undefined ? "" : `第 ${index} 个作品`,
            `名称：${artwork.name}`,
            `作者：${artwork.author || "未知"}`,
            `价格：${artwork.price || "未标价"}`,
            `分类：${artwork.category || "其他"}`,
            `标签：${tags || "无"}`,
            `来源：${artwork.source_pw || "未记录"}`,
            `添加者：${artwork.creator_username || "未知"}`,
            `数据：${artwork.like_count || 0} 收藏 · ${artwork.view_count || 0} 浏览`,
            artwork.description ? `说明：${artwork.description}` : "",
        ].filter(Boolean).join("\n")
        return [Structs.image(fs.readFileSync(preview)), Structs.text(`\n${details}`)]
    }

    private tags(value: string) {
        try { return Array.isArray(JSON.parse(value)) ? JSON.parse(value).filter((tag: unknown) => typeof tag === "string").join(" · ") : "" } catch { return "" }
    }

    private reply(data: any, message: string) {
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n${message}`)], data.origin_object)
    }
}
