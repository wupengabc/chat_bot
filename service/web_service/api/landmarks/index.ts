import type {Express, Request, Response} from "express"
import {get_storage} from "../../../../storage/index.js"
import {verify_resource_token} from "../user/auth/index.js"

type SortBy = "name" | "owner" | "visits" | "updated_at" | "first_seen_at"
type SortOrder = "asc" | "desc"

interface LandmarkFilters {
    keyword?: string
    name?: string
    owner?: string
    item_id?: string
    min_visits?: number
    max_visits?: number
    updated_from?: string
    updated_to?: string
    sort_by?: SortBy
    sort_order?: SortOrder
}

interface BangxiStorage {
    search_landmarks_page(page: number, limit: number, filters: LandmarkFilters): {landmarks: unknown[], total: number, visits: number}
}

function stringQuery(value: unknown, maxLength = 256): string | null | undefined {
    if (value === undefined) return undefined
    if (typeof value !== "string") return null
    const parsed = value.trim()
    return parsed.length <= maxLength ? parsed || undefined : null
}

function positiveInteger(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}

function nonNegativeInteger(value: unknown): number | null | undefined {
    if (value === undefined || value === "") return undefined
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}

function dateQuery(value: unknown, endOfDay = false): string | null | undefined {
    const parsed = stringQuery(value, 64)
    if (!parsed || parsed === null) return parsed
    const timestamp = Date.parse(parsed)
    if (Number.isNaN(timestamp)) return null
    const date = new Date(timestamp)
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(parsed)) date.setUTCHours(23, 59, 59, 999)
    return date.toISOString()
}

export async function init(app: Express) {
    app.get("/api/landmarks", (request: Request, response: Response) => {
        if (!verify_resource_token(request)) {
            response.status(401).json({success: false, message: "资源令牌无效或已过期"})
            return
        }

        const page = positiveInteger(request.query.page, 1)
        const requestedLimit = positiveInteger(request.query.limit, 20)
        const keyword = stringQuery(request.query.keyword)
        const name = stringQuery(request.query.name, 128)
        const owner = stringQuery(request.query.owner, 64)
        const itemId = stringQuery(request.query.item_id)
        const minVisits = nonNegativeInteger(request.query.min_visits)
        const maxVisits = nonNegativeInteger(request.query.max_visits)
        const updatedFrom = dateQuery(request.query.updated_from)
        const updatedTo = dateQuery(request.query.updated_to, true)
        const sortBy = stringQuery(request.query.sort_by, 32) || "visits"
        const sortOrder = stringQuery(request.query.sort_order, 4) || "desc"
        const sortColumns = new Set<SortBy>(["name", "owner", "visits", "updated_at", "first_seen_at"])

        if (page === null || requestedLimit === null || keyword === null || name === null || owner === null || itemId === null || minVisits === null || maxVisits === null || updatedFrom === null || updatedTo === null) {
            response.status(400).json({success: false, message: "地标查询参数格式无效"})
            return
        }
        if (!sortColumns.has(sortBy as SortBy) || (sortOrder !== "asc" && sortOrder !== "desc")) {
            response.status(400).json({success: false, message: "排序参数无效"})
            return
        }
        if (minVisits !== undefined && maxVisits !== undefined && minVisits > maxVisits) {
            response.status(400).json({success: false, message: "最低访问量不能大于最高访问量"})
            return
        }
        if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
            response.status(400).json({success: false, message: "更新时间起点不能晚于终点"})
            return
        }

        const storage = get_storage("bangxi_server_storage") as BangxiStorage | undefined
        if (!storage?.search_landmarks_page) {
            response.status(503).json({success: false, message: "bangxi_server_storage 不可用"})
            return
        }
        const limit = Math.min(requestedLimit, 30)
        const result = storage.search_landmarks_page(page, limit, {
            keyword, name, owner, item_id: itemId, min_visits: minVisits, max_visits: maxVisits,
            updated_from: updatedFrom, updated_to: updatedTo, sort_by: sortBy as SortBy, sort_order: sortOrder as SortOrder,
        })
        const totalPages = Math.max(1, Math.ceil(result.total / limit))
        response.json({
            success: true,
            landmarks: result.landmarks,
            summary: {total: result.total, visits: result.visits},
            pagination: {page, limit, total: result.total, total_pages: totalPages, has_previous: page > 1, has_next: page < totalPages},
        })
    })
}
