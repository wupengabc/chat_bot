import {running_status} from "../../type/index.js";
import {game_adapter_logger} from "../index.js";
import {LoggerType} from "../../utils/log_utils.js";
import {MinecraftJsonParser} from "./utils/message_json_parser.js";
import {event_emitter} from "../../utils/event_emitter.js";
import mineflayer from "mineflayer";

export class init {
    public event = new event_emitter()
    public status: running_status = "stopped"
    private single_task_status: running_status = "stopped"
    private task_queue: Array<() => void | Promise<void>> = []

    /** mineflayer bot 实例（running 时可用，其他状态为 null） */
    public bot: any = null

    private reconnectCount = 0
    private isReconnecting = false
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private isStopped = false
    private config: Record<string, unknown> = {}
    private logger = (msg: string, level: LoggerType)=>{
        game_adapter_logger("mineflayer", msg, level)
    }

    /** 声明控制台命令 */
    public console_commands = {
        send_message: {
            description: "向游戏内发送消息",
            args: ["message"],
            handler: (args: string[]) => {
                const message = args.join(" ")
                if (!message) {
                    return "用法: /game select mineflayer config <config_name> send_message <message>"
                }
                if (this.status !== "running") {
                    return `错误: bot 未运行（当前状态: ${this.status}）`
                }
                try {
                    const success = this.send_message(message)
                    return success 
                        ? `成功发送消息: ${message}` 
                        : "发送失败: bot 未运行"
                } catch (error: any) {
                    return `发送消息失败: ${error.message}`
                }
            }
        },
        status: {
            description: "查看 bot 状态",
            args: [],
            handler: () => {
                const info = [
                    `状态: ${this.status}`,
                    `实例名: ${this.config.name}`,
                    `服务器: ${this.config.host}:${this.config.port}`,
                    `用户名: ${this.config.username}`,
                    `重连次数: ${this.reconnectCount}`,
                ]
                if (this.status === "running" && this.bot) {
                    const players = Object.values(this.bot.players)
                    info.push(`在线玩家数: ${players.length}`)
                }
                return info.join("\n")
            }
        }
    }

    constructor(config: Record<string, unknown>) {
        this.config = config
        this.start(config)
    }

    stop(): void {
        this.status = "stopped"
        this.isStopped = true
        try {
            // 终止自动重连定时器
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer)
                this.reconnectTimer = null
            }
            // 断开 bot 连接
            if (this.bot) {
                this.bot.removeAllListeners()
                this.bot.end()
                this.bot = null
            }
            this.reconnectCount = 0
            this.isReconnecting = false
            this.logger("成功停止", "info")
        } catch (error: any) {
            this.status = "stopped"
            this.logger(error.message || "停止错误", "error")
        }
    }

    private start(config: Record<string, unknown>): void {
        // 清理旧 bot
        if (this.bot) {
            try {
                this.bot.removeAllListeners()
                this.bot.end()
            } catch {
                // ignore
            }
            this.bot = null
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }

        if (this.isReconnecting) {
            this.reconnectCount++
        }
        this.isReconnecting = false

        this.status = "connecting"

        // @ts-ignore
        this.bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: config.username,
            version: config.version,
            hideErrors: true,
        })

        // ── 登录成功 ──
        this.bot.on("login", () => {
            this.reconnectCount = 0
            if (this.status !== "running") {
                this.logger(`已登录: ${config.username}@${config.host}:${config.port}`, "info")
                this.event.emit("login", {adapter: "mineflayer", instance_name: config.name, username: config.username, host: config.host, port: config.port })
            }
            this.status = "running"
        })

        // ── 连接断开 ──
        this.bot.on("end", (reason: string) => {
            this.status = "stopped"
            this.logger(`连接已断开（实例: ${config.name}，原因: ${reason}）`, "info")
            this.event.emit("disconnect", {adapter: "mineflayer", instance_name: config.name, reason })
            // 自动重连（仅在未被主动 stop 时）
            if (!this.isStopped && (config.reconnection as any)?.enable) {
                const maxReconnect = (config.reconnection as any).attempt || 3
                if (this.reconnectCount >= maxReconnect) {
                    this.logger(`实例 ${config.name} 重连次数超过上限（${maxReconnect}），停止重连`, "error")
                    this.status = "stopped"
                    return
                }
                this.isReconnecting = true
                this.status = "connecting"
                const random = ((config.reconnection as any).interval || 5) + Math.floor(Math.random() * 21);
                const interval = random * 1000
                this.logger(`实例 ${config.name} 将在 ${interval / 1000} 秒后重连（第 ${this.reconnectCount + 1} 次）`, "info")
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer)
                    this.reconnectTimer = null
                }
                this.reconnectTimer = setTimeout(() => {
                    if (!this.isStopped) {
                        this.start(config)
                    }
                }, interval)
            }
        })

        // ── 错误 ──
        this.bot.on("error", (err: any) => {
            this.logger(`实例 ${config.name} 错误: ${err.message || err.toString() || "错误"}`, "error")
            this.event.emit("error", {adapter: "mineflayer", instance_name: config.name, error: err.message || err.toString() })
        })

        // ── 踢出 ──
        this.bot.on("kicked", (reason: any, loggedIn: any) => {
            const reasonText = typeof reason === "string" ? reason : (JSON.stringify(reason) || "unknown")
            this.logger(`被踢出: ${reasonText}`, "warn")
            this.event.emit("kicked", {adapter: "mineflayer", instance_name: config.name, reason: reasonText, logged_in: loggedIn })
        })

        // ── 消息（聊天 + 系统消息）──
        this.bot.on("message", (jsonMsg: any, position: any) => {
            const playerName = jsonMsg.senderName || jsonMsg.username || "unknown"
            const messageParsed = MinecraftJsonParser.parse(jsonMsg)
            this.logger(`${messageParsed.plainText}`, "info")
            this.event.emit("message", {
                adapter: "mineflayer",
                instance_name: config.name,
                player_name: playerName,
                message: messageParsed,
                position
            })
        })

        setInterval(()=>{
            if (this.status === "running") {
                const players = Object.values(this.bot.players)
                this.event.emit("player_list", {
                    adapter: "mineflayer",
                    instance_name: config.name,
                    players
                })
            }
        }, 2000)
    }

    public send_message(message: string) :boolean {
        if (this.status !== "running") {
            return false
        }
        this.bot.chat(message)
        return true
    }

    async execute_single_task(task: () => void | Promise<void>, join_to_queue: boolean = false) :Promise<boolean> {
        if (this.single_task_status !== "stopped") {
            if (join_to_queue) {
                this.task_queue.push(task)
                return true
            }
            return false
        }
        this.single_task_status = "running"
        try {
            await task()
            while (this.task_queue.length > 0) {
                const next = this.task_queue.shift()!
                await next()
            }
        } finally {
            this.single_task_status = "stopped"
        }
        return true
    }
}
