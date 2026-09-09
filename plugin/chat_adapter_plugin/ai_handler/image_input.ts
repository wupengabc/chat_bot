const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 10_000
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

export type MultimodalContent = string | Array<
    | {type: "text", text: string}
    | {type: "image_url", image_url: {url: string}}
>

function decodeCqValue(value: string): string {
    return value
        .replace(/&#44;/g, ",")
        .replace(/&#91;/g, "[")
        .replace(/&#93;/g, "]")
        .replace(/&amp;/g, "&")
}

export function extractCqImageUrls(content: string, limit: number = MAX_IMAGES): string[] {
    const urls: string[] = []
    const safeLimit = Math.max(0, Math.min(MAX_IMAGES, Math.floor(limit) || 0))
    if (!safeLimit) return urls

    for (const segment of content.matchAll(/\[CQ:image,([^\]]*)]/g)) {
        const urlMatch = segment[1].match(/(?:^|,)url=(.*?)(?=,(?:file|sub_type|file_size|cache|id|type|summary|name|size|width|height)=|$)/)
        if (!urlMatch) continue
        try {
            const url = new URL(decodeCqValue(urlMatch[1]))
            if (url.protocol !== "https:") continue
            urls.push(url.href)
            if (urls.length >= safeLimit) break
        } catch {
            // Ignore malformed CQ image URLs.
        }
    }
    return urls
}

export function extractReplyMessageId(content: string, message?: unknown): number | null {
    const rawMatch = content.match(/\[CQ:reply,([^\]]*)]/)?.[1]?.match(/(?:^|,)id=(-?\d+)(?:,|$)/)
    if (rawMatch) {
        const value = Number(rawMatch[1])
        if (Number.isSafeInteger(value)) return value
    }
    const segments = Array.isArray(message) ? message : []
    for (const item of segments) {
        if (!item || typeof item !== "object" || (item as any).type !== "reply") continue
        const value = Number((item as any).data?.id)
        if (Number.isSafeInteger(value)) return value
    }
    return null
}

export function stripLeadingReply(content: string): string {
    return content.replace(/^\s*\[CQ:reply,[^\]]*]\s*/, "")
}

function isSupportedImageUrl(value: unknown): value is string {
    if (typeof value !== "string" || !value.trim()) return false
    try {
        return new URL(value).protocol === "https:"
    } catch {
        return false
    }
}

/** NapCat supplies images as message segments, while raw_message often only contains a display placeholder. */
export function extractMessageImageUrls(message: unknown, limit: number = MAX_IMAGES): string[] {
    const urls = new Set<string>()
    const collect = (value: unknown): void => {
        if (urls.size >= limit || !value || typeof value !== "object") return
        if (Array.isArray(value)) {
            for (const item of value) collect(item)
            return
        }
        const segment = value as {type?: unknown, data?: {url?: unknown}}
        if (segment.type === "image" && isSupportedImageUrl(segment.data?.url)) urls.add(segment.data.url)
    }
    collect(message)
    return [...urls]
}

export async function fetchImageDataUrl(url: string, fetcher: typeof fetch = fetch): Promise<string> {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== "https:") throw new Error("仅支持 HTTPS 图片")

    const response = await fetcher(parsedUrl, {signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS)})
    if (!response.ok) throw new Error(`图片请求失败: ${response.status}`)

    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || ""
    if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) throw new Error(`不支持的图片类型: ${mediaType || "未知"}`)

    const declaredLength = Number(response.headers.get("content-length") || 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) throw new Error("图片超过 10 MB")
    if (!response.body) throw new Error("图片响应为空")

    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_IMAGE_BYTES) {
                await reader.cancel()
                throw new Error("图片超过 10 MB")
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        reader.releaseLock()
    }

    return `data:${mediaType};base64,${Buffer.concat(chunks, size).toString("base64")}`
}

export async function loadCqImages(
    content: string,
    onWarning: (index: number, error: unknown) => void,
    fetcher: typeof fetch = fetch,
    message?: unknown,
): Promise<string[]> {
    const urls = [...new Set([...extractCqImageUrls(content), ...extractMessageImageUrls(message)])].slice(0, MAX_IMAGES)
    const results = await Promise.all(urls.map(async (url, index) => {
        try {
            return await fetchImageDataUrl(url, fetcher)
        } catch (error) {
            onWarning(index + 1, error)
            return null
        }
    }))
    return results.filter((result): result is string => result !== null)
}

export function buildMultimodalContent(text: string, dataUrls: string[]): MultimodalContent {
    if (!dataUrls.length) return text
    return [
        {type: "text", text},
        ...dataUrls.map(url => ({type: "image_url" as const, image_url: {url}})),
    ]
}
