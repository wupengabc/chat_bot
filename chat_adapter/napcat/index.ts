import {SnowLumaWebSocketClient} from "@snowluma/sdk";
import {chat_adapter_logger} from "../index.js";
import {ChatAdapterMessage} from "../type.js";
import {time_utils} from "../../utils/time_utils.js";
import {running_status} from "../../type/index.js";
import {event_emitter} from "../../utils/event_emitter.js";
import {filter_segments, get_chat_actor, is_sensitive_chat_message, SENSITIVE_INPUT_MESSAGE} from "../../service/sensitive_filter/index.js";
import {get_chat_adapter_prefix} from "../../plugin/index.js";

function removeAtSegments(message: any): any {
    if (Array.isArray(message)) {
        return message.filter(item => !(item && item.type === "at")).map(item => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                return item
            }
            return item
        })
    }
    if (message && typeof message === "object" && message.type === "at") {
        return null
    }
    return message
}

function normalizeMediaSegments(message: any): any {
    if (Array.isArray(message)) return message.map(normalizeMediaSegments)
    if (!message || typeof message !== "object" || !message.data) return message
    if (!["image", "record", "video", "file"].includes(message.type) || !Buffer.isBuffer(message.data.file)) return message
    return {...message, data: {...message.data, file: `base64://${message.data.file.toString("base64")}`}}
}

function formatMessageForLog(message: any): string {
    if (typeof message === "string") return message
    if (typeof message === "number" || typeof message === "boolean") return String(message)
    if (Array.isArray(message)) return message.map(formatMessageForLog).join("")
    if (!message || typeof message !== "object") return ""

    const data = message.data || {}
    switch (message.type) {
        case "text": return typeof data.text === "string" ? data.text : ""
        case "at": return `@${data.qq === "all" ? "全体成员" : data.qq ?? "未知用户"}`
        case "reply": return `[回复消息${data.id !== undefined ? `:${data.id}` : ""}]`
        case "face": return `[表情${data.text ? `:${data.text}` : data.id !== undefined ? `:${data.id}` : ""}]`
        case "image": return `[图片${data.name ? `:${data.name}` : ""}]`
        case "record": return `[语音${data.name ? `:${data.name}` : ""}]`
        case "video": return `[视频${data.name ? `:${data.name}` : ""}]`
        case "file": return `[文件${data.name ? `:${data.name}` : ""}]`
        case "json": return "[JSON消息]"
        case "xml": return "[XML消息]"
        default: return `[${message.type || "未知消息"}]`
    }
}

export class init {
    private napcat: SnowLumaWebSocketClient
    private readonly connectionOptions: any
    public event = new event_emitter()
    public status: running_status = "stopped"
    private isStopped = false
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null
    private healthCheckInFlight = false
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private connectWatchdogTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectCount = 0
    private reconnection: {enable: boolean, attempts: number, delay: number}
    private readonly healthCheckInterval = 15000
    private readonly healthCheckTimeout = 8000
    private readonly connectWatchdogTimeout = 20000
    private readonly instanceName: string

    constructor(napcatConfig:any) {
        this.instanceName = napcatConfig.name
        this.reconnection = {
            enable: napcatConfig.reconnection?.enable ?? true,
            attempts: napcatConfig.reconnection?.attempts ?? 10,
            delay: napcatConfig.reconnection?.delay ?? 10000
        }

        this.connectionOptions = {
            url: `${napcatConfig.protocol || 'ws'}://${napcatConfig.host || 'localhost'}:${napcatConfig.port || 3001}/`,
            accessToken: napcatConfig.accessToken || '',
            requestTimeoutMs: this.healthCheckTimeout,
        }
        this.napcat = this.createClient()
        this.connect()
    }

    private createClient(): SnowLumaWebSocketClient {
        const client = new SnowLumaWebSocketClient(this.connectionOptions)
        const isCurrent = () => !this.isStopped && client === this.napcat

        client.on("open", () => {
            if (!isCurrent()) return
            this.clearConnectWatchdog()
            this.reconnectCount = 0
            this.status = "connecting"
            this.startHealthChecks(client)
            void this.checkHealth(client)
        })

        client.on("close", () => {
            if (!isCurrent()) return
            this.stopHealthChecks()
            this.clearConnectWatchdog()
            this.status = "connecting"
            this.scheduleReconnect("连接已关闭")
        })

        client.on("error", (error: unknown) => {
            if (!isCurrent()) return
            this.markConnectionUnhealthy(client, error)
        })

client.onMessage((msg: any) => {
            if (!isCurrent()) return
            const raw_message = typeof msg.raw_message === "string" ? msg.raw_message : ""
            const chat_adapter_prefix = get_chat_adapter_prefix()
            const is_pw_command = raw_message.startsWith(chat_adapter_prefix + "pw")
                && raw_message.slice(chat_adapter_prefix.length + 2).match(/^\s|^$/)
            if (raw_message.startsWith(chat_adapter_prefix) && !is_pw_command && is_sensitive_chat_message({
                raw_message,
                message: msg.message,
                sender: {user_id: msg.sender?.user_id},
            })) {
                const type = msg.message_type === "private" ? "private" : "group"
                const target = type === "private" ? msg.sender?.user_id : msg.group_id
                if (target !== undefined && target !== null) {
                    this.send(type, target, [{type: "text", data: {text: SENSITIVE_INPUT_MESSAGE}}], msg)
                }
                return
            }
            const emit_msg: ChatAdapterMessage = {
                adapter: 'napcat',
                instance_name: this.instanceName,
                receiver: {
                    id: msg.self_id,
                    type: msg.message_type,
                    // @ts-ignore
                    channel_name: msg.message_type === 'group' ? msg.group_name : msg.sender.nickname,
                },
                sender: {
                    id: msg.message_type === 'group' ? msg.group_id : msg.sender.user_id,
                    user_id: msg.sender.user_id,
                    role: msg.message_type === 'group' ? msg.sender.role : 'member',
                    name: msg.sender.nickname,
                },
                raw_message: msg.raw_message,
                message: msg.message,
                timestamp: time_utils.get_current_time(),
                origin_object: msg,
            }
            this.event.emit('message', emit_msg)
        })

        return client
    }

    private connect() {
        if (this.isStopped) return
        const client = this.napcat
        this.status = "connecting"
        this.startConnectWatchdog(client)
        client.connect().catch((error:any) => {
            if (this.isStopped || client !== this.napcat) return
            chat_adapter_logger("napcat", `napcat 连接失败`, "error")
            chat_adapter_logger("napcat", error.message || error.stack || String(error), "error")
            this.scheduleReconnect("连接失败")
        })
    }

    private startConnectWatchdog(client: SnowLumaWebSocketClient) {
        this.clearConnectWatchdog()
        this.connectWatchdogTimer = setTimeout(() => {
            if (this.isStopped || client !== this.napcat || client.isConnected) return
            chat_adapter_logger("napcat", `napcat 连接等待超过 ${this.connectWatchdogTimeout / 1000} 秒，准备重建连接`, "warn")
            this.scheduleReconnect("连接超时")
        }, this.connectWatchdogTimeout)
    }

    private clearConnectWatchdog() {
        if (!this.connectWatchdogTimer) return
        clearTimeout(this.connectWatchdogTimer)
        this.connectWatchdogTimer = null
    }

    private scheduleReconnect(reason: string) {
        if (this.isStopped || !this.reconnection.enable || this.reconnectTimer) return
        if (this.reconnectCount >= this.reconnection.attempts) {
            this.status = "stopped"
            chat_adapter_logger("napcat", `napcat 重连次数超过上限（${this.reconnection.attempts}），停止重连`, "error")
            return
        }
        this.stopHealthChecks()
        this.clearConnectWatchdog()
        this.reconnectCount += 1
        this.status = "connecting"
        chat_adapter_logger("napcat", `napcat ${reason}，将在 ${this.reconnection.delay / 1000} 秒后重连（第 ${this.reconnectCount} 次）`, "warn")
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            if (this.isStopped) return
            const previous = this.napcat
            // The SDK can keep a failed socket in a pending state. Recreate it so
            // every adapter retry starts from a known-clean WebSocket client.
            this.napcat = this.createClient()
            try { previous.close() } catch {}
            this.connect()
        }, this.reconnection.delay)
    }

    private startHealthChecks(client: SnowLumaWebSocketClient) {
        this.stopHealthChecks()
        this.healthCheckTimer = setInterval(() => {
            void this.checkHealth(client)
        }, this.healthCheckInterval)
    }

    private stopHealthChecks() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer)
            this.healthCheckTimer = null
        }
        this.healthCheckInFlight = false
    }

    private async checkHealth(client: SnowLumaWebSocketClient) {
        if (this.isStopped || this.healthCheckInFlight || client !== this.napcat) return
        this.healthCheckInFlight = true
        try {
            const health = await client.getStatus() as {good?: boolean, online?: boolean}
            if (this.isStopped || client !== this.napcat) return
            if (health?.good !== true || health?.online !== true) throw new Error("NapCat 返回离线状态")
            this.status = "running"
        } catch (error:any) {
            this.markConnectionUnhealthy(client, error)
        } finally {
            if (client === this.napcat) this.healthCheckInFlight = false
        }
    }

    private markConnectionUnhealthy(client: SnowLumaWebSocketClient, error: any) {
        if (this.isStopped || client !== this.napcat) return
        this.stopHealthChecks()
        const message = error?.message || error?.info?.message || error?.error_type || String(error)
        chat_adapter_logger("napcat", `napcat 连接失效: ${message}`, "warn")
        this.scheduleReconnect("连接失效")
    }

    stop() {
        this.isStopped = true
        this.stopHealthChecks()
        this.clearConnectWatchdog()
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        try {
            this.napcat.close()
            chat_adapter_logger("napcat", `napcat 已断开连接`, "info")
            this.status = "stopped"
        } catch (error: any) {
            this.status = "stopped"
            chat_adapter_logger("napcat", `napcat 停止错误: ${error.message || error}`, "error")
        }
    }

    getMessage(messageId: number) {
        return this.napcat.getMessage(messageId)
    }

    send(type: "group" | "private", user_id: number | string, message: any, event: any) {
        const numeric_user_id = Number(user_id)
        if (!Number.isSafeInteger(numeric_user_id)) {
            chat_adapter_logger("napcat", `目标 ID 无效: ${user_id}`, "error")
            return
        }
        const actor = get_chat_actor(event) || (type === "private" ? {user_id} : null)
        const filtered = normalizeMediaSegments(type === "private"
            ? removeAtSegments(filter_segments(message, actor))
            : filter_segments(message, actor))
        if (!filtered || (Array.isArray(filtered) && filtered.length === 0)) return
        const logMessage = formatMessageForLog(filtered)
        if (type === "group") {
            this.napcat.sendGroupMessage(numeric_user_id, filtered).then(() => {
                chat_adapter_logger("napcat", `发送群消息成功, 群ID: ${numeric_user_id}, 消息: ${logMessage}`, "info")
            }).catch((error: any) => {
                chat_adapter_logger("napcat", `发送群消息失败, 群ID: ${numeric_user_id}: ${error.message || error}`, "error")
            })
        } else if (type === "private") {
            this.napcat.sendPrivateMessage(numeric_user_id, filtered).then(() => {
                chat_adapter_logger("napcat", `发送私信成功, 用户ID: ${numeric_user_id}, 消息: ${logMessage}`, "info")
            }).catch((error: any) => {
                chat_adapter_logger("napcat", `发送私信失败, 用户ID: ${numeric_user_id}: ${error.message || error}`, "error")
            })
        }
    }
}
