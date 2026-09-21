import {Bot, ReceiverMode, segment, SessionEvents} from "qq-official-bot";
import {running_status} from "../../type/index.js";
import {chat_adapter_logger} from "../index.js";
import {ChatAdapterMessage} from "../type.js";
import {time_utils} from "../../utils/time_utils.js";
import {event_emitter} from "../../utils/event_emitter.js";
import {filter_segments, get_chat_actor, is_sensitive_chat_message, SENSITIVE_INPUT_MESSAGE} from "../../service/sensitive_filter/index.js";
import {get_chat_adapter_prefix} from "../../plugin/index.js";

function convertSnowLumaStruct(message: any, event: any, type?: "group" | "private"): any {
    if (Array.isArray(message)) {
        return message.map(item => convertSnowLumaStruct(item, event, type)).filter(item => item !== null)
    }
    if (!message || typeof message !== "object" || !message.data) {
        return message
    }

    const data = message.data
    switch (message.type) {
        case "text":
            return typeof data.text === "string" ? segment.text(data.text) : message
        case "at":
            if (data.qq === undefined) return message
            // 私聊不支持 @，直接去掉
            if (type === "private") return null
            return event?.message_type === "guild" || event?.message_type === "group"
                ? segment.at(String(data.qq))
                : null
        case "reply":
            return data.id !== undefined ? segment.reply(String(data.id)) : message
        case "face": {
            const id = Number(data.id)
            return Number.isInteger(id) ? segment.face(id, data.text) : message
        }
        case "image":
            return data.file !== undefined
                ? segment.image(data.file, {url: data.url, name: data.name})
                : message
        case "video":
            return typeof data.file === "string"
                ? segment.video(data.file, {url: data.url, name: data.name})
                : message
        case "record":
            return typeof data.file === "string"
                ? segment.audio(data.file, {url: data.url, name: data.name})
                : message
        case "markdown":
            return typeof data.content === "string" ? segment.markdown(data.content) : message
        default:
            return message
    }
}

export class init {
    private qq_official: Bot;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectCount = 0
    private isStopped = false
    private reconnection: {enable: boolean, attempts: number, delay: number}
    public event = new event_emitter()
    public status: running_status = "stopped"

    constructor(officialBotConfig:any) {
        this.reconnection = {
            enable: officialBotConfig.reconnection?.enable ?? true,
            attempts: officialBotConfig.reconnection?.attempts ?? 10000,
            delay: officialBotConfig.reconnection?.delay ?? 10000
        }
        this.status = "connecting"
        this.qq_official = new Bot({
            appid: officialBotConfig.appid,
            secret: officialBotConfig.secret,
            sandbox: officialBotConfig.sandbox || false,
            removeAt: officialBotConfig.remove_at !== false,
            logLevel: 'off',
            maxRetry: this.reconnection.enable ? this.reconnection.attempts : 0,
            delay: this.reconnection.delay,
            intents: officialBotConfig.intents || [
                'GROUP_AND_C2C_EVENT',
                'GUILD_MESSAGES',
                'DIRECT_MESSAGE',
                'GUILD_MESSAGE_REACTIONS',
                'GUILDS',
                'GUILD_MEMBERS',
            ],
            mode: ReceiverMode.WEBSOCKET
        })

        this.qq_official.sessionManager.on(SessionEvents.EVENT_WS, (data: any) => {
            switch (data.eventType) {
                case SessionEvents.READY:
                    chat_adapter_logger("qq_official", `qq_official 连接成功`, "info")
                    this.reconnectCount = 0
                    this.status = "running"
                    break
                case SessionEvents.DISCONNECT:
                    chat_adapter_logger("qq_official", `qq_official 连接断开`, "warn")
                    this.status = "stopped"
                    break
                case SessionEvents.RESUMED:
                    chat_adapter_logger("qq_official", `qq_official 重连成功`, "info")
                    this.reconnectCount = 0
                    this.status = "running"
                    break
                case SessionEvents.RECONNECT:
                    chat_adapter_logger("qq_official", `qq_official 正在重连`, "warn")
                    this.status = "connecting"
                    break
            }
        })

        this.qq_official.sessionManager.on(SessionEvents.ERROR, (code: number, message: string) => {
            chat_adapter_logger("qq_official", `qq_official 连接错误: ${code} ${message}`, "error")
            this.status = "stopped"
        })

        this.qq_official.sessionManager.on(SessionEvents.DEAD, () => {
            chat_adapter_logger("qq_official", `qq_official 连接已死亡`, "error")
            this.status = "stopped"
            this.scheduleReconnect()
        })

        this.start()

        this.qq_official.on("message", (message:any) => {
            try {
                if (typeof message.raw_message === "string" && message.raw_message.startsWith(get_chat_adapter_prefix()) && is_sensitive_chat_message({
                    raw_message: message.raw_message,
                    message: message.message,
                    sender: {user_id: message.sender?.user_id},
                })) {
                    const type = message.message_type === "private" ? "private" : "group"
                    const target = type === "private"
                        ? message.sender?.user_id
                        : message.group_id || message.group_openid || message.channel_id || message.guild_id
                    if (target !== undefined && target !== null) {
                        this.send(type, target, [{type: "text", data: {text: SENSITIVE_INPUT_MESSAGE}}], message)
                    }
                    return
                }
                const emit_message:ChatAdapterMessage = {
                    adapter: "qq_official",
                    instance_name: officialBotConfig.name,
                    receiver: {
                        id: message.bot.config.appid,
                        type: message.message_type,
                        channel_name: message.message_type === "group" ? message.group_openid : message.sender.user_name
                    },
                    sender: {
                        id: message.sender.user_id,
                        user_id: message.sender.user_id,
                        name: message.sender.user_name,
                        role: message.message_type === "group" ? message.author.member_role : "member"
                    },
                    raw_message: message.raw_message,
                    message: message.message,
                    timestamp: time_utils.get_current_time(),
                    origin_object: message,
                }
                this.event.emit("message", emit_message)
            } catch (error:any) {
                chat_adapter_logger("qq_official", `qq_official 处理消息错误: ${error.message}`, "error")
            }
        })
    }

    private start() {
        if (this.isStopped) return
        this.status = "connecting"
        this.qq_official.start().catch((error:any) => {
            this.status = "stopped"
            chat_adapter_logger("qq_official", `qq_official 连接失败`, "error")
            chat_adapter_logger("qq_official", error.message || error.stack || String(error), "error")
            this.scheduleReconnect()
        })
    }

    private scheduleReconnect() {
        if (this.isStopped || !this.reconnection.enable || this.reconnectTimer) return
        if (this.reconnectCount >= this.reconnection.attempts) {
            chat_adapter_logger("qq_official", `qq_official 重连次数超过上限（${this.reconnection.attempts}），停止重连`, "error")
            return
        }
        this.reconnectCount++
        this.status = "connecting"
        chat_adapter_logger("qq_official", `qq_official 将在 ${this.reconnection.delay / 1000} 秒后进行第 ${this.reconnectCount} 次重连`, "warn")
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.start()
        }, this.reconnection.delay)
    }

    stop() {
        this.isStopped = true
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        // 通知 Bot 库内部连接管理器停止自动重连
        const sessionManager = (this.qq_official as any).sessionManager
        if (sessionManager?.connectionManager) {
            sessionManager.connectionManager.state.userClose = true
            sessionManager.connectionManager.state.alive = false
            sessionManager.connectionManager.stopHeartbeat()
            sessionManager.connectionManager.removeAllListeners()
        }
        try {
            this.qq_official.stop().then(() => {
                chat_adapter_logger("qq_official", `qq_official 已断开连接`, "info")
            }).catch((error: any) => {
                chat_adapter_logger("qq_official", `qq_official 断开连接失败: ${error.message || error}`, "error")
            })
            this.status = "stopped"
        } catch (error: any) {
            this.status = "stopped"
            chat_adapter_logger("qq_official", `qq_official 停止错误: ${error.message || error}`, "error")
        }
    }

    send(type: "group" | "private", user_id: number | string, message: any, event: any) {
        const actor = get_chat_actor(event) || (type === "private" ? {user_id} : null)
        const converted = convertSnowLumaStruct(filter_segments(message, actor), event, type)
        if (type === "group" && typeof event?.reply !== "function") {
            this.qq_official.sendGroupMessage(String(user_id), converted)
            return
        }
        if (type === "private" && typeof event?.reply !== "function") {
            this.qq_official.sendPrivateMessage(String(user_id), converted)
            return
        }
        event.reply(converted)
    }
}
