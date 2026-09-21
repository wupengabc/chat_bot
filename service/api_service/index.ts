import fs from "node:fs"
import {isIP} from "node:net"
import path from "node:path"
import {isPublicHttpUrl} from "../net/search.js"
import {path_utils} from "../../utils/path_utils.js"

export type ApiMethod = "GET" | "POST"
export type ApiVariableType = "string" | "number" | "boolean"

export interface ApiVariable {
    readonly description?: string
    readonly type?: ApiVariableType
    readonly required?: boolean
}

export interface ApiServiceConfig {
    readonly name: string
    readonly description?: string
    readonly method: ApiMethod
    readonly url: string
    readonly params?: Record<string, unknown>
    readonly body?: unknown
    readonly variables?: Record<string, ApiVariable>
    readonly timeout_ms?: number
    readonly max_response_bytes?: number
    readonly enabled?: boolean
}

export interface ApiCallResult {
    readonly success: boolean
    readonly service: string
    readonly status: number
    readonly content_type: string
    readonly data: unknown
    readonly raw_text: string
    readonly error?: string
}

const CONFIG_PATH = path.join(path_utils.get_project_root_path(), "service", "api_service", "config.json")
const MAX_TIMEOUT_MS = 30_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_BODY_DEPTH = 12
const PLACEHOLDER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_-]*)}/g

function readConfig(): {configs?: unknown[]} {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {configs?: unknown[]} }
    catch { return {configs: []} }
}

function text(value: unknown, max = 500): string {
    return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function boundedNumber(value: unknown, fallback: number, maximum: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1_000, Math.min(maximum, Math.floor(parsed))) : fallback
}

function validServiceName(value: unknown): string {
    const name = text(value, 64)
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("API 服务名称无效")
    return name
}

function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function walkPlaceholders(value: unknown, names: Set<string>, depth = 0): void {
    if (depth > MAX_BODY_DEPTH) throw new Error("API 配置 JSON 嵌套层级过深")
    if (typeof value === "string") {
        for (const match of value.matchAll(PLACEHOLDER_PATTERN)) names.add(match[1])
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) walkPlaceholders(item, names, depth + 1)
        return
    }
    if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            if (key.length > 128) throw new Error("API 参数名过长")
            walkPlaceholders(item, names, depth + 1)
        }
    }
}

function variableNames(config: ApiServiceConfig): Set<string> {
    const names = new Set<string>()
    if (config.method === "GET") walkPlaceholders(config.params || {}, names)
    if (config.method === "POST") walkPlaceholders(config.body, names)
    for (const name of Object.keys(config.variables || {})) names.add(name)
    return names
}

function placeholderNames(value: unknown): Set<string> {
    const names = new Set<string>()
    walkPlaceholders(value, names)
    return names
}

function normalizeConfig(value: unknown): ApiServiceConfig | null {
    const input = objectValue(value)
    const name = text(input.name, 64)
    const method = input.method === "POST" ? "POST" : input.method === "GET" ? "GET" : null
    const url = text(input.url, 2_000)
    if (!name || !method || !url || input.enabled === false) return null
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return null
    if (!/^https?:\/\//i.test(url)) return null
    const variables = objectValue(input.variables)
    const normalizedVariables: Record<string, ApiVariable> = {}
    for (const [key, raw] of Object.entries(variables)) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) continue
        const item = objectValue(raw)
        const type = item.type === "number" || item.type === "boolean" ? item.type : "string"
        normalizedVariables[key] = {description: text(item.description, 300), type, required: item.required !== false}
    }
    return {
        name,
        description: text(input.description, 500),
        method,
        url,
        params: objectValue(input.params),
        body: input.body,
        variables: normalizedVariables,
        timeout_ms: boundedNumber(input.timeout_ms, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
        max_response_bytes: boundedNumber(input.max_response_bytes, DEFAULT_MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES),
        enabled: true,
    }
}

export function validateApiServiceConfig(value: unknown): void {
    const input = objectValue(value)
    if (input.enabled === false) return
    const method = input.method
    if (method !== "GET" && method !== "POST") throw new Error("API 请求方法必须是 GET 或 POST")
    const url = text(input.url, 2_000)
    if (!url || !/^https?:\/\//i.test(url)) throw new Error("API 请求地址必须是 HTTP(S) 地址")
    if (PLACEHOLDER_PATTERN.test(url)) {
        PLACEHOLDER_PATTERN.lastIndex = 0
        throw new Error("API 请求地址不能包含 AI 占位符")
    }
    PLACEHOLDER_PATTERN.lastIndex = 0
    if (!isPublicHttpUrlSync(url)) throw new Error("API 请求地址不能指向本机或内网地址")
    const config = normalizeConfig({...input, name: text(input.name, 64) || "validation", enabled: true})
    if (!config) throw new Error("API 配置无效")
    if (config.method === "GET" && (input.params === undefined || input.params === null)) throw new Error("GET API 参数必须是对象")
    if (config.method === "GET" && (typeof input.params !== "object" || Array.isArray(input.params))) throw new Error("GET API 参数必须是对象")
    if (config.method === "GET") validateGetParams(config.params || {})
    if (config.method === "GET" && (input.body !== undefined && input.body !== null && !isEmptyObject(input.body))) throw new Error("GET API 不能配置 JSON Body")
    if (config.method === "POST" && (input.params !== undefined && input.params !== null && !isEmptyObject(input.params))) throw new Error("POST API 不能配置 GET 参数")
    const rawVariables = input.variables
    if (rawVariables !== undefined && (rawVariables === null || typeof rawVariables !== "object" || Array.isArray(rawVariables))) throw new Error("AI 参数必须是对象")
    for (const [name, raw] of Object.entries(objectValue(rawVariables))) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new Error(`AI 参数名无效: ${name}`)
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`AI 参数 ${name} 定义无效`)
        const type = (raw as Record<string, unknown>).type
        if (type !== undefined && type !== "string" && type !== "number" && type !== "boolean") throw new Error(`AI 参数 ${name} 类型无效`)
    }
    const declared = new Set(Object.keys(config.variables || {}))
    const used = placeholderNames(config.method === "GET" ? config.params || {} : config.body)
    for (const name of used) if (!declared.has(name)) throw new Error(`占位符 ${name} 未在 AI 参数中声明`)
    for (const name of declared) if (!used.has(name)) throw new Error(`AI 参数 ${name} 没有在请求模板中使用`)
}

function validateGetParams(value: Record<string, unknown>): void {
    for (const [key, item] of Object.entries(value)) {
        if (!key.trim() || key.length > 128) throw new Error("API 参数名无效")
        if (item !== null && typeof item === "object") throw new Error("GET API 参数值必须是文本、数字或布尔值")
    }
}

function isEmptyObject(value: unknown): boolean {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
}

export function listApiServices(): ApiServiceConfig[] {
    const configured = readConfig().configs
    const configs: unknown[] = Array.isArray(configured) ? configured : []
    return configs.flatMap(item => {
        const config = normalizeConfig(item)
        if (!config) return []
        try {
            if (!isPublicHttpUrlSync(config.url)) return []
            validateApiServiceConfig(config)
            return [config]
        } catch { return [] }
    })
}

function isPublicHttpUrlSync(value: string): boolean {
    let parsed: URL
    try { parsed = new URL(value) } catch { return false }
    if (parsed.username || parsed.password) return false
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "broadcasthost") return false
    if (isIP(hostname) === 4) {
        const parts = hostname.split(".").map(Number)
        return parts[0] !== 0 && parts[0] !== 10 && parts[0] !== 127 && parts[0] < 224
            && !(parts[0] === 169 && parts[1] === 254)
            && !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            && !(parts[0] === 192 && parts[1] === 168)
            && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    }
    if (isIP(hostname) === 6) return hostname !== "::" && hostname !== "::1" && !hostname.startsWith("fc") && !hostname.startsWith("fd") && !/^fe[89ab]/.test(hostname) && !hostname.startsWith("ff") && !hostname.startsWith("::ffff:")
    return true
}

function findService(name: string): ApiServiceConfig {
    const config = listApiServices().find(item => item.name === name)
    if (!config) throw new Error("未找到或未启用该 API 服务")
    return config
}

function replaceValue(value: unknown, values: Record<string, unknown>, depth = 0): unknown {
    if (depth > MAX_BODY_DEPTH) throw new Error("API 请求 JSON 嵌套层级过深")
    if (typeof value === "string") {
        const exact = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_-]*)}$/)
        if (exact) return values[exact[1]]
        return value.replace(PLACEHOLDER_PATTERN, (_, name: string) => values[name] === undefined || values[name] === null ? "" : String(values[name]))
    }
    if (Array.isArray(value)) return value.map(item => replaceValue(item, values, depth + 1))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item, values, depth + 1)]))
    return value
}

function validateValues(config: ApiServiceConfig, values: Record<string, unknown>): Record<string, unknown> {
    const variables = config.variables || {}
    const allowed = new Set(Object.keys(variables))
    for (const key of Object.keys(values)) if (!allowed.has(key)) throw new Error(`不允许的 API 参数: ${key}`)
    const required = variableNames(config)
    for (const name of required) {
        const definition = variables[name]
        if (!definition && !Object.prototype.hasOwnProperty.call(values, name)) throw new Error(`API 参数未声明: ${name}`)
        if (definition?.required !== false && values[name] === undefined) throw new Error(`缺少 API 参数: ${name}`)
        if (values[name] === undefined) continue
        if (definition?.type === "number" && (typeof values[name] !== "number" || !Number.isFinite(values[name] as number))) throw new Error(`API 参数 ${name} 必须是数字`)
        if (definition?.type === "boolean" && typeof values[name] !== "boolean") throw new Error(`API 参数 ${name} 必须是布尔值`)
        if (definition?.type === "string" && typeof values[name] !== "string") throw new Error(`API 参数 ${name} 必须是文本`)
    }
    return values
}

async function fetchWithPublicRedirects(url: string, init: RequestInit, signal: AbortSignal, fetcher: typeof fetch): Promise<Response> {
    let current = url
    for (let index = 0; index <= 5; index += 1) {
        if (!await isPublicHttpUrl(current)) throw new Error("API 地址不是公开 HTTP(S) 地址")
        const response = await fetcher(current, {...init, redirect: "manual", signal})
        if (![301, 302, 303, 307, 308].includes(response.status)) return response
        const location = response.headers.get("location")
        if (!location || index === 5) throw new Error("API 重定向无效或次数过多")
        current = new URL(location, current).toString()
    }
    throw new Error("API 重定向失败")
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
    const declared = Number(response.headers.get("content-length") || 0)
    if (Number.isFinite(declared) && declared > limit) throw new Error("API 响应超过大小限制")
    if (!response.body) return ""
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            size += next.value.byteLength
            if (size > limit) {
                await reader.cancel().catch(() => undefined)
                throw new Error("API 响应超过大小限制")
            }
            chunks.push(next.value)
        }
    } finally { reader.releaseLock() }
    return new TextDecoder().decode(Buffer.concat(chunks.map(item => Buffer.from(item))))
}

export async function callApiServiceConfig(config: ApiServiceConfig, input: Record<string, unknown> = {}, fetcher: typeof fetch = fetch): Promise<ApiCallResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        validateApiServiceConfig(config)
        const values = validateValues(config, input)
        const controller = new AbortController()
        timer = setTimeout(() => controller.abort(), config.timeout_ms)
        const url = new URL(config.url)
        const headers: Record<string, string> = {"Accept": "application/json, text/plain;q=0.9"}
        let body: string | undefined
        if (config.method === "GET") {
            const params = replaceValue(config.params || {}, values) as Record<string, unknown>
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
            }
        } else {
            headers["Content-Type"] = "application/json"
            body = JSON.stringify(replaceValue(config.body ?? {}, values))
        }
        const response = await fetchWithPublicRedirects(url.toString(), {method: config.method, headers, body}, controller.signal, fetcher)
        const rawText = await readLimitedText(response, config.max_response_bytes || DEFAULT_MAX_RESPONSE_BYTES)
        let data: unknown = rawText
        try { data = rawText ? JSON.parse(rawText) : null } catch { /* keep plain text */ }
        if (rawText.length > 100_000) data = rawText.slice(0, 100_000)
        const result: ApiCallResult = {success: response.ok, service: config.name, status: response.status, content_type: response.headers.get("content-type") || "", data, raw_text: rawText.slice(0, 100_000)}
        return response.ok ? result : {...result, error: `API 请求失败: HTTP ${response.status}`}
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {success: false, service: config.name, status: 0, content_type: "", data: null, raw_text: "", error: message.slice(0, 300)}
    } finally {
        if (timer) clearTimeout(timer)
    }
}

export async function callApiService(name: string, input: Record<string, unknown> = {}): Promise<ApiCallResult> {
    return callApiServiceConfig(findService(validServiceName(name)), input)
}

export function getApiServiceTools(): any[] {
    return listApiServices().map(config => {
        const properties: Record<string, unknown> = {}
        const required: string[] = []
        for (const [name, variable] of Object.entries(config.variables || {})) {
            properties[name] = {type: variable.type || "string", description: variable.description || `API 参数 ${name}`}
            if (variable.required !== false) required.push(name)
        }
        return {
            type: "function",
            function: {
                name: `api_${config.name}`,
                description: config.description || `调用 API 服务 ${config.name}`,
                parameters: {type: "object", properties, required, additionalProperties: false},
            },
        }
    })
}

export function apiToolServiceName(toolName: string): string | null {
    if (!/^api_[A-Za-z0-9_-]+$/.test(toolName)) return null
    return toolName.slice(4)
}

export async function executeApiServiceTool(toolName: string, input: Record<string, unknown>): Promise<ApiCallResult | null> {
    const service = apiToolServiceName(toolName)
    return service ? callApiService(service, input) : null
}
