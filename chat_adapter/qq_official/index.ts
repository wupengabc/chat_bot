import {Bot, ReceiverMode, SessionEvents} from "qq-official-bot";
import {running_status} from "../../type/index.js";
import {chat_adapter_logger} from "../index.js";
import {ChatAdapterMessage} from "../type.js";
import {time_utils} from "../../utils/time_utils.js";
import {event_emitter} from "../../utils/event_emitter.js";

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

    send(type: "group" | "private", user_id: number, message: any, event: any) {
        event.reply(message)
    }
}