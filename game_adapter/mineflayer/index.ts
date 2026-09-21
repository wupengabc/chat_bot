import {running_status} from "../../type/index.js";
import {game_adapter_logger} from "../index.js";
import {LoggerType} from "../../utils/log_utils.js";
import {MinecraftJsonParser} from "./utils/message_json_parser.js";
import {event_emitter} from "../../utils/event_emitter.js";
import mineflayer from "mineflayer";
import fs from "node:fs";
import {path_utils} from "../../utils/path_utils.js";
import path from "node:path";

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
    private playerListTimer: ReturnType<typeof setInterval> | null = null
    private isStopped = false
    public config: Record<string, unknown> = {}
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
            if (this.playerListTimer) {
                clearInterval(this.playerListTimer)
                this.playerListTimer = null
            }
            // 断开 bot 连接
            if (this.bot) {
                this.detachBot(this.bot)
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

    /**
     * 清空旧 bot 上除 error 外的所有监听器并结束连接。
     *
     * bot.end() 只是发起异步收尾（等待 serializer/socket 优雅关闭或超时强制
     * destroy），并不会立刻让底层 client 触发 'end'。这意味着 removeAllListeners()
     * 执行之后、真正断开之前，仍有一个窗口期：NMP 内部已经在跑的计时器（例如
     * keepalive 宽限期）可能照常到期，并调用 client.emit('error', ...)，经
     * mineflayer loader 转发为 bot.emit('error', ...)。如果此时 bot 上一个
     * 'error' 监听器都没有，Node 会把它当作未处理异常直接抛出，崩溃整个进程
     * （不只是这一个 bot 实例）。所以必须在移除旧监听器之后，永远保留（或立刻
     * 补上）一个兜底的空 'error' 监听器，再发起 end()。
     */
    private detachBot(bot: any): void {
        bot.removeAllListeners()
        bot.on("error", () => {})
        bot.end()
    }

    private start(config: Record<string, unknown>): void {
        // 清理旧 bot
        if (this.bot) {
            try {
                this.detachBot(this.bot)
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

        this.bot = mineflayer.createBot({
            host: typeof config.host === "string" ? config.host : undefined,
            port: typeof config.port === "number" ? config.port : undefined,
            username: typeof config.username === "string" ? config.username : "",
            version: typeof config.version === "string" ? config.version : undefined,
            hideErrors: true,
            checkTimeoutInterval: 120000,
            keepAliveTimeoutGracePeriod: 5000
        } as any)

        const protocolClient = this.bot._client
        protocolClient?.on("keep_alive", (packet: any) => {
            protocolClient._chatBotLastKeepAliveAt = Date.now()
            protocolClient._chatBotLastKeepAliveId = typeof packet?.keepAliveId === "bigint"
                ? packet.keepAliveId.toString()
                : packet?.keepAliveId
        })
        protocolClient?.on("keepAliveWarning", (diagnostics: any) => {
            this.logger(this.formatKeepAliveDiagnostics(config, "keepalive 暂无入站数据，进入宽限期", diagnostics), "warn")
        })
        protocolClient?.on("keepAliveRecovered", (diagnostics: any) => {
            this.logger(this.formatKeepAliveDiagnostics(config, "keepalive 在宽限期内恢复", diagnostics), "info")
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
            if (reason === "keepAliveError") {
                this.logger(this.formatConnectionDiagnostics(config, this.bot?._client), "error")
            }
            this.event.emit("disconnect", {adapter: "mineflayer", instance_name: config.name, reason })
            // 自动重连（仅在未被主动 stop 时）
            if (!this.isStopped && (config.reconnection as any)?.enable !== false) {
                const maxReconnect = (config.reconnection as any)?.attempts ?? 3
                if (this.reconnectCount >= maxReconnect) {
                    this.logger(`实例 ${config.name} 重连次数超过上限（${maxReconnect}），停止重连`, "error")
                    this.status = "stopped"
                    return
                }
                this.isReconnecting = true
                this.status = "connecting"
                const delay = (config.reconnection as any)?.delay ?? 5000
                this.logger(`实例 ${config.name} 将在 ${delay / 1000} 秒后重连（第 ${this.reconnectCount + 1} 次）`, "info")
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer)
                    this.reconnectTimer = null
                }
                this.reconnectTimer = setTimeout(() => {
                    if (!this.isStopped) {
                        this.start(config)
                    }
                }, delay)
            }
        })

        // ── 错误 ──
        this.bot.on("error", (err: any) => {
            const errorMessage = err.message || err.toString() || "错误"
            const diagnosticMessage = err.keepAliveDiagnostics
                ? `；${this.formatKeepAliveDiagnostics(config, "keepalive 错误详情", err.keepAliveDiagnostics)}`
                : ""
            this.logger(`实例 ${config.name} 错误: ${errorMessage}${diagnosticMessage}`, "error")
            this.event.emit("adapter_error", {adapter: "mineflayer", instance_name: config.name, error: err.message || err.toString() })
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

        if (!this.playerListTimer) {
            this.playerListTimer = setInterval(()=>{
                if (this.status === "running" && this.bot) {
                    const players = Object.values(this.bot.players)
                    this.event.emit("player_list", {
                        adapter: "mineflayer",
                        instance_name: config.name,
                        players
                    })
                }
            }, 2000)
        }
    }

    private formatKeepAliveDiagnostics(config: Record<string, unknown>, message: string, diagnostics: any): string {
        const state = diagnostics?.protocolState ?? "unknown"
        const idle = diagnostics?.socketIdleFor == null ? "unknown" : `${diagnostics.socketIdleFor}ms`
        const lastPacket = diagnostics?.lastKeepAliveAt == null ? "none" : `${Date.now() - diagnostics.lastKeepAliveAt}ms ago`
        const socketEvent = diagnostics?.lastSocketEvent?.event ?? "none"
        const socketHistory = Array.isArray(diagnostics?.socketEventHistory)
            ? diagnostics.socketEventHistory.map((event: any) => event.event).join(",")
            : "none"
        return `实例 ${config.name} ${message}（state=${state}，socket_idle=${idle}，last_keepalive=${lastPacket}，last_socket_event=${socketEvent}，socket_history=${socketHistory}，grace=${diagnostics?.keepAliveTimeoutGracePeriod ?? "unknown"}ms）`
    }

    private formatConnectionDiagnostics(config: Record<string, unknown>, client: any): string {
        const socket = client?.socket
        const lastActivity = client?._lastSocketActivity
        const idle = lastActivity == null ? "unknown" : `${Date.now() - lastActivity}ms`
        const lastKeepAlive = client?._chatBotLastKeepAliveAt ?? client?._lastKeepAliveAt
        const keepAlive = lastKeepAlive == null ? "none" : `${Date.now() - lastKeepAlive}ms ago`
        const socketState = socket
            ? `destroyed=${socket.destroyed}, readableEnded=${socket.readableEnded}, writableEnded=${socket.writableEnded}, readyState=${socket.readyState ?? "unknown"}`
            : "missing"
        return `实例 ${config.name} keepalive 断开时连接状态（state=${client?.protocolState ?? "unknown"}，protocol=${client?.protocolVersion ?? "unknown"}，socket_idle=${idle}，last_keepalive=${keepAlive}，socket=${socketState}）`
    }

    public send_message(message: string) :boolean {
        if (this.status !== "running") {
            return false
        }
        this.bot.chat(message)
        return true
    }

    public get_language(lang: string) {
        if (!fs.existsSync(path.join(path_utils.get_project_root_path(), `/game_adapter/mineflayer/data/language/${lang}/${lang}.json`))) {
            return {}
        }
        return JSON.parse(fs.readFileSync(path.join(path_utils.get_project_root_path(), `/game_adapter/mineflayer/data/language/${lang}/${lang}.json`), "utf-8"))
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
