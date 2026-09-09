import {lookup} from "node:dns/promises"
import {isIP} from "node:net"

export interface WebSearchResult {
    readonly title: string
    readonly url: string
    readonly description: string
    readonly engine: string
}

export interface WebSearchConfig {
    readonly engines?: readonly string[]
    readonly max_results?: number
    readonly timeout_ms?: number
    readonly parallel_engines?: number
    readonly time_from?: string
    readonly time_to?: string
    readonly exclude_urls?: readonly string[]
}

export interface WebSearchDiagnostic {
    readonly engine: string
    readonly result_count: number
    readonly error: string | null
}

export interface WebSearchResponse {
    readonly results: WebSearchResult[]
    readonly diagnostics: readonly WebSearchDiagnostic[]
    readonly time_from: string | null
    readonly time_to: string | null
}

type SearchEngine = (query: string, limit: number, signal: AbortSignal) => Promise<WebSearchResult[]>

const DEFAULT_ENGINES = ["bing", "duckduckgo", "baidu", "sogou"] as const
const DEFAULT_TIMEOUT_MS = 12_000
const MAX_QUERY_LENGTH = 500
const MAX_RESULTS = 50
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"

function decodeHtml(value: string): string {
    return value
        .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#(\d+);?/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim()
}

function stripTags(value: string): string {
    return decodeHtml(value.replace(/<[^>]*>/g, " "))
}

function safeResultUrl(value: string): string | null {
    try {
        const url = new URL(value)
        if (url.protocol !== "http:" && url.protocol !== "https:") return null
        url.hash = ""
        for (const key of [...url.searchParams.keys()]) {
            if (/^(?:utm_|spm|from|source|ref|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
        }
        return url.toString()
    } catch {
        return null
    }
}

function uniqueResults(results: WebSearchResult[], limit: number): WebSearchResult[] {
    const seen = new Set<string>()
    return results.filter(result => {
        const url = safeResultUrl(result.url)
        if (!url || seen.has(url)) return false
        seen.add(url)
        return true
    }).map(result => ({...result, url: safeResultUrl(result.url) as string})).slice(0, limit)
}

function validTime(value: string | undefined): string | null {
    if (!value) return null
    const timestamp = Date.parse(value)
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function chinaDate(value: string): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value))
}

function shiftDate(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
}

function queryWithTimeRange(query: string, timeFrom: string | null, timeTo: string | null): string {
    if (!timeFrom && !timeTo) return query
    const from = timeFrom ? shiftDate(chinaDate(timeFrom), -1) : ""
    const to = timeTo ? shiftDate(chinaDate(timeTo), 1) : ""
    return `${query}${from ? ` after:${from}` : ""}${to ? ` before:${to}` : ""}`.trim()
}

function parseBingResults(html: string, limit: number): WebSearchResult[] {
    const results: WebSearchResult[] = []
    for (const match of html.matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<\/li>/gi)) {
        const block = match[0]
        const link = block.match(/<h2[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
        if (!link) continue
        const url = safeResultUrl(decodeHtml(link[1]))
        const title = stripTags(link[2])
        const description = stripTags(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "")
        if (url && title) results.push({title, url, description, engine: "bing"})
        if (results.length >= limit) break
    }
    return uniqueResults(results, limit)
}

function parseDuckDuckGoResults(html: string, limit: number): WebSearchResult[] {
    const results: WebSearchResult[] = []
    for (const match of html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const url = safeResultUrl(decodeHtml(match[1]))
        const block = html.slice(match.index || 0, (match.index || 0) + 4_000)
        const description = stripTags(block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "")
        const title = stripTags(match[2])
        if (url && title) results.push({title, url, description, engine: "duckduckgo"})
        if (results.length >= limit) break
    }
    return uniqueResults(results, limit)
}

function parseBaiduResults(html: string, limit: number): WebSearchResult[] {
    const results: WebSearchResult[] = []
    for (const match of html.matchAll(/<h3[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)) {
        const url = safeResultUrl(decodeHtml(match[1]))
        const block = html.slice(match.index || 0, (match.index || 0) + 5_000)
        const title = stripTags(match[2])
        const description = stripTags(block.match(/class=["'][^"']*(?:c-container|c-span-last)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "")
        if (url && title) results.push({title, url, description, engine: "baidu"})
        if (results.length >= limit) break
    }
    return uniqueResults(results, limit)
}

function parseSogouResults(html: string, limit: number): WebSearchResult[] {
    const results: WebSearchResult[] = []
    for (const match of html.matchAll(/<h3[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)) {
        const url = safeResultUrl(decodeHtml(match[1]))
        const block = html.slice(match.index || 0, (match.index || 0) + 4_000)
        const title = stripTags(match[2])
        const description = stripTags(block.match(/class=["'][^"']*(?:str_info|fb)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "")
        if (url && title) results.push({title, url, description, engine: "sogou"})
        if (results.length >= limit) break
    }
    return uniqueResults(results, limit)
}

async function requestSearch(url: URL, signal: AbortSignal): Promise<string> {
    const response = await fetch(url, {
        signal,
        headers: {"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
    })
    if (!response.ok) throw new Error(`搜索请求失败: HTTP ${response.status}`)
    return response.text()
}

const engines: Record<string, SearchEngine> = {
    bing: async (query, limit, signal) => {
        const url = new URL("https://www.bing.com/search")
        url.searchParams.set("q", query)
        url.searchParams.set("count", String(limit))
        return parseBingResults(await requestSearch(url, signal), limit)
    },
    duckduckgo: async (query, limit, signal) => {
        const url = new URL("https://html.duckduckgo.com/html/")
        url.searchParams.set("q", query)
        return parseDuckDuckGoResults(await requestSearch(url, signal), limit)
    },
    baidu: async (query, limit, signal) => {
        const url = new URL("https://www.baidu.com/s")
        url.searchParams.set("wd", query)
        return parseBaiduResults(await requestSearch(url, signal), limit)
    },
    sogou: async (query, limit, signal) => {
        const url = new URL("https://www.sogou.com/web")
        url.searchParams.set("query", query)
        return parseSogouResults(await requestSearch(url, signal), limit)
    },
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await operation(controller.signal)
    } finally {
        clearTimeout(timer)
    }
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value ?? fallback)))
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 160) || "未知错误"
}

/** Search public engines in order, only falling back when earlier engines have too few results. */
export async function searchWebWithDiagnostics(query: string, config: WebSearchConfig = {}): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim().slice(0, MAX_QUERY_LENGTH)
    if (!normalizedQuery) return {results: [], diagnostics: [], time_from: null, time_to: null}
    const limit = bounded(config.max_results, 20, 1, MAX_RESULTS)
    const timeoutMs = bounded(config.timeout_ms, DEFAULT_TIMEOUT_MS, 1_000, 30_000)
    const timeFrom = validTime(config.time_from)
    const timeTo = validTime(config.time_to)
    const normalizedFrom = timeFrom && timeTo && timeFrom > timeTo ? timeTo : timeFrom
    const normalizedTo = timeFrom && timeTo && timeFrom > timeTo ? timeFrom : timeTo
    const searchQuery = queryWithTimeRange(normalizedQuery, normalizedFrom, normalizedTo)
    const selected = [...new Set((config.engines?.length ? config.engines : DEFAULT_ENGINES)
        .map(engine => engine.trim().toLowerCase()).filter(engine => engines[engine]))]
    const targetResults = Math.min(limit, 20)
    const excluded = new Set((config.exclude_urls || []).map(url => safeResultUrl(url)).filter((url): url is string => url !== null))
    const collected: WebSearchResult[] = []
    const diagnostics: WebSearchDiagnostic[] = []
    for (const engine of selected) {
        try {
            const results = await withTimeout(signal => engines[engine](searchQuery, limit, signal), timeoutMs)
            const fresh = results.filter(result => !excluded.has(result.url))
            collected.push(...fresh)
            diagnostics.push({engine, result_count: fresh.length, error: null})
        } catch (error) {
            diagnostics.push({engine, result_count: 0, error: errorMessage(error)})
        }
        if (uniqueResults(collected, limit).length >= targetResults) break
    }
    return {results: uniqueResults(collected, limit), diagnostics, time_from: normalizedFrom, time_to: normalizedTo}
}

/** Compatibility wrapper for callers that only need search results. */
export async function searchWeb(query: string, config: WebSearchConfig = {}): Promise<WebSearchResult[]> {
    return (await searchWebWithDiagnostics(query, config)).results
}

export async function isPublicHttpUrl(value: string): Promise<boolean> {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return false
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "broadcasthost") return false
    if (isIP(hostname)) return isPublicIp(hostname)
    try {
        const addresses = await lookup(hostname, {all: true})
        return addresses.length > 0 && addresses.every(address => isPublicIp(address.address))
    } catch {
        return false
    }
}

function isPublicIp(hostname: string): boolean {
    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase()
    const version = isIP(normalized)
    if (version === 4) {
        const parts = normalized.split(".").map(Number)
        return parts[0] !== 0 && parts[0] !== 10 && parts[0] !== 127 && parts[0] < 224
            && !(parts[0] === 169 && parts[1] === 254)
            && !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            && !(parts[0] === 192 && parts[1] === 168)
            && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
            && !(parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    }
    if (version === 6) {
        return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fc") && !normalized.startsWith("fd")
            && !/^fe[89ab]/.test(normalized) && !normalized.startsWith("ff")
            && !normalized.startsWith("::ffff:")
    }
    return false
}
