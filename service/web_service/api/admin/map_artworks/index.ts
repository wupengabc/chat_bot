import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import sharp from "sharp"
import type {Response} from "express"
import {get_storage} from "../../../../../storage/index.js"
import {path_utils} from "../../../../../utils/path_utils.js"
import {type AdminRequest, require_admin} from "../auth.js"

interface MapArtworkStorage {
    search_admin_map_artwork_groups(page: number, limit: number, filters: any): {groups: any[], total: number, summary: any}
    get_admin_map_artwork_group(groupId: string): any
    update_map_artwork_group(groupId: string, updates: any, username: string, canManage: boolean, note?: string): {success: boolean, message?: string}
    moderate_map_artwork_group(groupId: string, status: string, reason: string, username: string): {success: boolean, message?: string}
    delete_map_artwork_group(groupId: string, username: string, canManage: boolean): {success: boolean, message?: string, group?: any, tiles?: any[]}
    resolve_map_artwork_report(reportId: number, username: string, resolved: boolean): {success: boolean, message?: string}
}

const artworkDirectory = path.join(path_utils.get_project_root_path(), "storage", "bangxi_server_storage", "data", "map_artworks")
const statuses = new Set(["draft", "pending", "published", "hidden", "rejected"])
const moderationStatuses = new Set(["pending", "published", "hidden", "rejected"])
const visibilities = new Set(["public", "unlisted", "private"])
const categories = new Set(["pixel-art", "text", "building", "anime", "logo", "other"])
const sorts = new Set(["updated", "created", "reports", "views", "likes"])

function storage(response: Response): MapArtworkStorage | null {
    const value = get_storage("bangxi_server_storage") as MapArtworkStorage | undefined
    if (!value?.search_admin_map_artwork_groups || !value.get_admin_map_artwork_group || !value.resolve_map_artwork_report) {
        response.status(503).json({success: false, message: "bangxi_server_storage 不可用"})
        return null
    }
    return value
}

function text(value: unknown, max: number, optional = false): string | null | undefined {
    if (value === undefined && optional) return undefined
    if (typeof value !== "string") return null
    const parsed = value.trim()
    return parsed.length <= max && (optional || parsed.length > 0) ? parsed : null
}

function pageNumber(value: unknown, fallback: number) {
    if (value === undefined) return fallback
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}

function groupId(value: unknown) {
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

function deleteFiles(result: {group?: any, tiles?: any[]}) {
    try {
        for (const tile of result.tiles || []) {
            fs.rmSync(path.join(artworkDirectory, "raw", tile.dat_name), {force: true})
            fs.rmSync(path.join(artworkDirectory, "icons", tile.icons_file), {force: true})
        }
        if (result.group?.preview_file) fs.rmSync(path.join(artworkDirectory, "preview", result.group.preview_file), {force: true})
    } catch {}
}

async function mosaicPreview(db: MapArtworkStorage, id: string, pngBase64: string, regions: number, username: string) {
    const record = db.get_admin_map_artwork_group(id)
    if (!record?.group?.preview_file) return {success: false as const, status: 404, message: "地图画不存在"}
    const previewFile = String(record.group.preview_file)
    if (!/^group_[0-9a-f-]{36}\.png$/i.test(previewFile)) return {success: false as const, status: 409, message: "作品预览文件名无效"}
    const previewPath = path.join(artworkDirectory, "preview", previewFile)
    if (!fs.existsSync(previewPath)) return {success: false as const, status: 404, message: "原始预览文件不存在"}
    const encoded = pngBase64.replace(/^data:image\/png;base64,/, "")
    if (!encoded || encoded.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return {success: false as const, status: 400, message: "打码预览数据无效或过大"}
    const nextBuffer = Buffer.from(encoded, "base64")
    if (nextBuffer.length < 64 || nextBuffer.length > 16 * 1024 * 1024) return {success: false as const, status: 400, message: "打码预览文件大小无效"}
    const currentBuffer = fs.readFileSync(previewPath)
    try {
        const [currentMetadata, nextMetadata] = await Promise.all([sharp(currentBuffer).metadata(), sharp(nextBuffer).metadata()])
        if (nextMetadata.format !== "png" || !currentMetadata.width || !currentMetadata.height || nextMetadata.width !== currentMetadata.width || nextMetadata.height !== currentMetadata.height) {
            return {success: false as const, status: 400, message: "打码预览必须是与原图同尺寸的 PNG"}
        }
        await sharp(nextBuffer).png().toBuffer()
    } catch {
        return {success: false as const, status: 400, message: "无法解析打码预览 PNG"}
    }
    const historyDirectory = path.join(artworkDirectory, "preview_history", id)
    fs.mkdirSync(historyDirectory, {recursive: true})
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = path.join(historyDirectory, `${stamp}-${crypto.randomUUID()}.png`)
    fs.writeFileSync(backupPath, currentBuffer, {flag: "wx"})
    try {
        fs.writeFileSync(previewPath, nextBuffer)
        const audit = db.update_map_artwork_group(id, {description: record.group.description || ""}, username, true, `管理员打码预览（${regions} 个区域）`)
        if (!audit.success) throw new Error(audit.message || "审计记录写入失败")
        return {success: true as const}
    } catch (error) {
        fs.writeFileSync(previewPath, currentBuffer)
        fs.rmSync(backupPath, {force: true})
        return {success: false as const, status: 500, message: error instanceof Error ? error.message : "打码预览保存失败"}
    }
}

export async function init(app: import("express").Express) {
    app.get("/api/admin/map-artworks", require_admin, (request: AdminRequest, response: Response) => {
        const page = pageNumber(request.query.page, 1), limit = pageNumber(request.query.limit, 20)
        const keyword = text(request.query.keyword, 128, true), status = text(request.query.status, 16, true)
        const visibility = text(request.query.visibility, 16, true), category = text(request.query.category, 32, true)
        const sort = text(request.query.sort, 16, true) || "updated", reported = request.query.reported === "true"
        if (!page || !limit || keyword === null || status === null || visibility === null || category === null || !sorts.has(sort) || (status && !statuses.has(status)) || (visibility && !visibilities.has(visibility)) || (category && !categories.has(category))) {
            response.status(400).json({success: false, message: "地图画查询参数无效"}); return
        }
        const db = storage(response); if (!db) return
        const safeLimit = Math.min(limit, 100)
        const result = db.search_admin_map_artwork_groups(page, safeLimit, {keyword, status, visibility, category, reported, sort})
        const totalPages = Math.max(1, Math.ceil(result.total / safeLimit))
        response.json({success: true, artworks: result.groups, summary: result.summary, pagination: {page, limit: safeLimit, total: result.total, total_pages: totalPages, has_previous: page > 1, has_next: page < totalPages}})
    })

    app.get("/api/admin/map-artworks/:groupId", require_admin, (request: AdminRequest, response: Response) => {
        const id = groupId(request.params.groupId), db = storage(response)
        if (!id || !db) { if (db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const result = db.get_admin_map_artwork_group(id)
        if (!result) { response.status(404).json({success: false, message: "地图画不存在"}); return }
        response.json({success: true, ...result})
    })

    app.patch("/api/admin/map-artworks/:groupId", require_admin, (request: AdminRequest, response: Response) => {
        const id = groupId(request.params.groupId), db = storage(response)
        if (!id || !db || !request.admin) { if (db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const updates: any = {}
        for (const [field, max] of [["name", 128], ["price", 64], ["author", 256], ["description", 1000]] as const) {
            if (request.body?.[field] === undefined) continue
            const value = text(request.body[field], max, field === "description")
            if (value === null || value === undefined) { response.status(400).json({success: false, message: `${field} 无效`}); return }
            updates[field] = value
        }
        for (const [field, allowed] of [["category", categories], ["visibility", visibilities], ["status", statuses]] as const) {
            if (request.body?.[field] === undefined) continue
            const value = text(request.body[field], 32)
            if (!value || !allowed.has(value)) { response.status(400).json({success: false, message: `${field} 无效`}); return }
            updates[field] = value
        }
        if (request.body?.tags !== undefined) {
            if (!Array.isArray(request.body.tags) || request.body.tags.length > 10 || request.body.tags.some((tag: unknown) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 24)) { response.status(400).json({success: false, message: "标签无效"}); return }
            updates.tags = [...new Set(request.body.tags.map((tag: string) => tag.trim()))]
        }
        if (!Object.keys(updates).length) { response.status(400).json({success: false, message: "没有可更新的字段"}); return }
        const result = db.update_map_artwork_group(id, updates, request.admin.username, true, "管理员编辑作品")
        if (!result.success) { response.status(404).json(result); return }
        response.json({success: true})
    })

    app.post("/api/admin/map-artworks/:groupId/mosaic", require_admin, async (request: AdminRequest, response: Response) => {
        const id = groupId(request.params.groupId), db = storage(response)
        const png = request.body?.preview_png_base64, regions = request.body?.region_count
        if (!id || !db || !request.admin || typeof png !== "string" || !Number.isSafeInteger(regions) || regions < 1 || regions > 100) {
            if (db) response.status(400).json({success: false, message: "打码参数无效"}); return
        }
        const result = await mosaicPreview(db, id, png, regions, request.admin.username)
        if (!result.success) { response.status(result.status).json(result); return }
        response.json({success: true})
    })

    app.post("/api/admin/map-artworks/moderate", require_admin, (request: AdminRequest, response: Response) => {
        const ids = Array.isArray(request.body?.group_ids) ? [...new Set(request.body.group_ids.map(groupId).filter(Boolean))] as string[] : []
        const status = text(request.body?.status, 16), reason = text(request.body?.reason ?? "", 500, true) ?? ""
        const db = storage(response)
        if (!db || !request.admin || !ids.length || ids.length > 100 || !status || !moderationStatuses.has(status) || reason === null) { if (db) response.status(400).json({success: false, message: "批量审核参数无效"}); return }
        const failed: Array<{group_id: string, message: string}> = []
        for (const id of ids) { const result = db.moderate_map_artwork_group(id, status, reason, request.admin.username); if (!result.success) failed.push({group_id: id, message: result.message || "审核失败"}) }
        response.status(failed.length ? 207 : 200).json({success: failed.length === 0, updated: ids.length - failed.length, failed})
    })

    app.delete("/api/admin/map-artworks/:groupId", require_admin, (request: AdminRequest, response: Response) => {
        const id = groupId(request.params.groupId), db = storage(response)
        if (!id || !db || !request.admin) { if (db) response.status(400).json({success: false, message: "作品 ID 无效"}); return }
        const result = db.delete_map_artwork_group(id, request.admin.username, true)
        if (!result.success) { response.status(404).json(result); return }
        deleteFiles(result)
        response.json({success: true})
    })

    app.patch("/api/admin/map-artworks/reports/:reportId", require_admin, (request: AdminRequest, response: Response) => {
        const id = Number(request.params.reportId), resolved = request.body?.resolved, db = storage(response)
        if (!db || !request.admin || !Number.isSafeInteger(id) || id <= 0 || typeof resolved !== "boolean") { if (db) response.status(400).json({success: false, message: "举报处理参数无效"}); return }
        const result = db.resolve_map_artwork_report(id, request.admin.username, resolved)
        if (!result.success) { response.status(404).json(result); return }
        response.json({success: true})
    })
}
