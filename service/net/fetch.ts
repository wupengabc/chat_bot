import {NodeHtmlMarkdown} from "node-html-markdown"
import {isPublicHttpUrl} from "./search.js"

const markdownConverter = new NodeHtmlMarkdown()
const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_CHARS = 30_000
const MAX_CHARS = 200_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

export interface WebImageCandidate {
    readonly src: string
    readonly alt: string
    readonly title: string
    readonly caption: string
    readonly surrounding_text: string
    readonly position: number
    readonly width?: number
    readonly height?: number
}

export interface WebImage {
    readonly url: string
    readonly mime_type: string
    readonly buffer: Buffer
}

export interface WebPageContent {
    readonly url: string
    readonly title: string
    readonly content: string
    readonly content_type: string
    readonly truncated: boolean
    readonly images: readonly WebImageCandidate[]
}

export interface FetchWebPageOptions {
    readonly max_chars?: number
    readonly timeout_ms?: number
    readonly signal?: AbortSignal
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value ?? fallback)))
}

function titleFromHtml(html: string): string {
    return (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&quot;/gi, '"').replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ").trim().slice(0, 300)
}

function decodeHtml(value: string): string {
    return value
        .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#(\d+);?/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
}

function stripHtml(value: string): string {
    return decodeHtml(value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ").trim()
}

function htmlAttribute(tag: string, name: string): string {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))
    return decodeHtml(match?.[1]?.trim() || "")
}

function imageSource(tag: string): string {
    const direct = htmlAttribute(tag, "src") || htmlAttribute(tag, "data-src") || htmlAttribute(tag, "data-original")
    if (direct) return direct
    const srcset = htmlAttribute(tag, "srcset")
    return srcset.split(",")[0]?.trim().split(/\s+/)[0] || ""
}

function parseDimension(value: string): number | undefined {
    const result = Number.parseInt(value, 10)
    return Number.isFinite(result) && result > 0 ? result : undefined
}

function isCandidateImageUrl(value: string): boolean {
    if (!/^https?:\/\//i.test(value) || /^data:|^blob:/i.test(value)) return false
    return !/(?:sprite|favicon|avatar|logo|icon|emoji|tracking|pixel|qrcode)/i.test(value)
}

export function extractWebImageCandidates(html: string, pageUrl: string): WebImageCandidate[] {
    const candidates: WebImageCandidate[] = []
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
        const tag = match[0]
        const position = match.index || 0
        let src = imageSource(tag)
        try { src = new URL(src, pageUrl).toString() } catch { src = "" }
        if (!isCandidateImageUrl(src)) continue
        const surrounding = stripHtml(html.slice(Math.max(0, position - 900), Math.min(html.length, position + 1_500))).slice(0, 1_200)
        const figure = html.slice(Math.max(0, position - 1_200), Math.min(html.length, position + 1_800))
        const caption = stripHtml(figure.match(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/i)?.[0] || "").slice(0, 500)
        const width = parseDimension(htmlAttribute(tag, "width"))
        const height = parseDimension(htmlAttribute(tag, "height"))
        if ((width !== undefined && width <= 2) || (height !== undefined && height <= 2)) continue
        candidates.push({
            src,
            alt: htmlAttribute(tag, "alt").slice(0, 300),
            title: htmlAttribute(tag, "title").slice(0, 300),
            caption,
            surrounding_text: surrounding,
            position,
            ...(width ? {width} : {}),
            ...(height ? {height} : {}),
        })
    }
    return [...new Map(candidates.map(candidate => [candidate.src, candidate])).values()].slice(0, 30)
}

function trimContent(value: string, maxChars: number): {content: string; truncated: boolean} {
    const content = value.trim()
    return content.length > maxChars ? {content: content.slice(0, maxChars), truncated: true} : {content, truncated: false}
}

async function readResponseBody(response: Response, byteLimit: number): Promise<{body: string; truncated: boolean}> {
    const reader = response.body?.getReader()
    if (!reader) return {body: "", truncated: false}
    const chunks: Uint8Array[] = []
    let bytes = 0
    let truncated = false
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            const remaining = byteLimit - bytes
            if (remaining <= 0) { truncated = true; break }
            if (next.value.byteLength > remaining) {
                chunks.push(next.value.slice(0, remaining))
                bytes += remaining
                truncated = true
                break
            }
            chunks.push(next.value)
            bytes += next.value.byteLength
        }
    } finally {
        if (truncated) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))))
    return {body, truncated}
}

async function readBinaryBody(response: Response, byteLimit: number): Promise<Buffer> {
    const declaredLength = Number(response.headers.get("content-length") || 0)
    if (Number.isFinite(declaredLength) && declaredLength > byteLimit) throw new Error("图片超过大小限制")
    const reader = response.body?.getReader()
    if (!reader) throw new Error("图片响应为空")
    const chunks: Buffer[] = []
    let size = 0
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            size += next.value.byteLength
            if (size > byteLimit) {
                await reader.cancel().catch(() => undefined)
                throw new Error("图片超过大小限制")
            }
            chunks.push(Buffer.from(next.value))
        }
    } finally {
        reader.releaseLock()
    }
    if (!size) throw new Error("图片内容为空")
    return Buffer.concat(chunks, size)
}

async function fetchResponse(initialUrl: string, signal: AbortSignal): Promise<{response: Response; url: string}> {
    let url = initialUrl
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        if (!await isPublicHttpUrl(url)) throw new Error("目标网址不是公开 HTTP(S) 地址")
        const response = await fetch(url, {
            signal,
            redirect: "manual",
            headers: {"User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) return {response, url}
        const location = response.headers.get("location")
        if (!location) throw new Error("网页重定向缺少目标地址")
        if (redirects === MAX_REDIRECTS) throw new Error("网页重定向次数过多")
        url = new URL(location, url).toString()
    }
    throw new Error("网页重定向失败")
}

export async function fetchWebPage(url: string, options: FetchWebPageOptions = {}): Promise<WebPageContent> {
    const maxChars = bounded(options.max_chars, DEFAULT_MAX_CHARS, 1_000, MAX_CHARS)
    const timeoutMs = bounded(options.timeout_ms, DEFAULT_TIMEOUT_MS, 1_000, 30_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal
    try {
        const fetched = await fetchResponse(url, signal)
        if (!fetched.response.ok) throw new Error(`网页请求失败: HTTP ${fetched.response.status}`)
        const contentType = fetched.response.headers.get("content-type") || ""
        const responseBody = await readResponseBody(fetched.response, MAX_RESPONSE_BYTES)
        const body = responseBody.body
        const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) || /<html[\s>]/i.test(body)
        const title = isHtml ? titleFromHtml(body) : ""
        const converted = isHtml ? markdownConverter.translate(body) : body
        const trimmed = trimContent(converted, maxChars)
        return {url: fetched.url, title, content: trimmed.content, content_type: contentType, truncated: responseBody.truncated || trimmed.truncated, images: isHtml ? extractWebImageCandidates(body, fetched.url) : []}
    } finally {
        clearTimeout(timer)
    }
}

/** Compatibility wrapper for callers that only need converted page text. */
export async function fetchMarkdown(url: string): Promise<string> {
    return (await fetchWebPage(url)).content
}

function hasImageSignature(buffer: Buffer, mimeType: string): boolean {
    return mimeType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        || mimeType === "image/jpeg" && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        || mimeType === "image/gif" && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
        || mimeType === "image/webp" && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
}

export async function fetchWebImage(url: string, timeoutMs = 12_000): Promise<WebImage> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const fetched = await fetchResponse(url, controller.signal)
        if (!fetched.response.ok) throw new Error(`图片请求失败: HTTP ${fetched.response.status}`)
        const mimeType = (fetched.response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase()
        if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) throw new Error(`不支持的图片类型: ${mimeType || "未知"}`)
        const buffer = await readBinaryBody(fetched.response, MAX_IMAGE_BYTES)
        if (!hasImageSignature(buffer, mimeType)) throw new Error("图片内容签名无效")
        return {url: fetched.url, mime_type: mimeType, buffer}
    } finally {
        clearTimeout(timer)
    }
}
