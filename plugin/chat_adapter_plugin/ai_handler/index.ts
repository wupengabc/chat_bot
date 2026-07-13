import {help} from "../../type.js";
import {get_chat_adapter_prefix, help_list, plugin_handle_adapter_event, acquire_plugin_lock, release_plugin_lock} from "../../index.js";
import {send_message} from "../../../chat_adapter/index.js";
import {Structs} from "node-napcat-ts";
import {get_ai_session} from "../../../service/ai_service/index.js";

export function is_dispatchable_correction(command: string, handler_command: string, commands: string[]): boolean {
    return command !== handler_command && commands.includes(command)
}

export class init {
    public help: help = {
        name: "ai_handler",
        keyword: "ai",
        description: "当命令不存在时，使用AI进行命令修正并重新执行",
        permission: 0,
        args: [],
        platform: "chat_adapter",
    }
    private chat_adapter_prefix = get_chat_adapter_prefix()
    
    /** 追踪用户的命令修正历史，防止无限循环 */
    private correction_history: Map<string, {
        original_command: string,
        count: number,
        timestamp: number
    }> = new Map()
    
    /** 历史记录过期时间（5分钟） */
    private static readonly HISTORY_EXPIRE_MS = 5 * 60 * 1000
    
    /** 最大修正次数 */
    private static readonly MAX_CORRECTION_ATTEMPTS = 3
    
    /** 清理定时器 */
    private cleanup_timer: ReturnType<typeof setInterval> | null = null
    
    constructor() {
        // 定期清理过期的历史记录
        this.cleanup_timer = setInterval(() => {
            const now = Date.now()
            for (const [key, record] of this.correction_history.entries()) {
                if (now - record.timestamp > init.HISTORY_EXPIRE_MS) {
                    this.correction_history.delete(key)
                }
            }
        }, 60000) // 每分钟清理一次
    }
    
    /** 插件卸载时清理资源 */
    on_unload(): void {
        if (this.cleanup_timer) {
            clearInterval(this.cleanup_timer)
            this.cleanup_timer = null
        }
        this.correction_history.clear()
    }
    
    /** 生成用户会话的唯一键 */
    private get_session_key(data: any, original_command: string): string {
        return `${data.sender.user_id}_${data.receiver.id}_${original_command}`
    }
    
    /** 检查是否超过修正次数限制 */
    private check_correction_limit(session_key: string, original_command: string): boolean {
        const record = this.correction_history.get(session_key)
        const now = Date.now()
        
        if (!record || now - record.timestamp > init.HISTORY_EXPIRE_MS) {
            // 新的修正或已过期，重置计数
            this.correction_history.set(session_key, {
                original_command,
                count: 1,
                timestamp: now
            })
            return true
        }
        
        if (record.count >= init.MAX_CORRECTION_ATTEMPTS) {
            // 超过限制
            return false
        }
        
        // 增加计数
        record.count++
        record.timestamp = now
        return true
    }
    
    /** 清理用户的修正历史 */
    private clear_correction_history(session_key: string): void {
        this.correction_history.delete(session_key)
    }
    
    async event_handler(_event: string, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            // 检查是否以命令前缀开头
            if (!data.raw_message.startsWith(this.chat_adapter_prefix)) {
                return
            }
            
            // 提取命令关键字（去掉前缀后的第一个词）
            const message_without_prefix = data.raw_message.slice(this.chat_adapter_prefix.length)
            const parts = message_without_prefix.trim().split(" ")
            const command_keyword = parts[0]
            const command_args = parts.slice(1).join(" ")
            
            // 获取所有已注册的命令关键字
            const keywords = help_list
                .filter(command => command.platform === "chat_adapter")
                .map(command => command.keyword)
            const correction_commands = help_list
                .filter(command => command.platform === "chat_adapter" && command.keyword !== this.help.keyword)
            
            // 如果命令不存在，或者用户主动使用 /ai，使用 AI 进行命令修正
            if (!keywords.includes(command_keyword) || command_keyword === this.help.keyword) {
                const user_id = data.sender.user_id.toString()
                
                // 尝试获取并发锁
                if (!acquire_plugin_lock(user_id)) {
                    send_message(
                        data.adapter,
                        data.instance_name,
                        data.receiver.type,
                        data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("\n请等待当前操作完成后再试")],
                        data.origin_object
                    )
                    return
                }
                
                try {
                    // 确定要识别的内容
                    let content_to_recognize = ""
                    let is_manual_trigger = false

                    if (command_keyword === this.help.keyword) {
                        // 用户主动使用 /ai args
                        is_manual_trigger = true
                        content_to_recognize = command_args
                        if (!content_to_recognize) {
                            const empty_message = [
                                Structs.at(data.sender.user_id),
                                Structs.text(`\n请在 ${this.chat_adapter_prefix}${this.help.keyword} 后面输入要识别的内容`)
                            ]
                            send_message(
                                data.adapter,
                                data.instance_name,
                                data.receiver.type,
                                data.sender.id,
                                empty_message,
                                data.origin_object
                            )
                            release_plugin_lock(user_id, 0)
                            return
                        }
                    } else {
                        // 命令不存在的情况
                        content_to_recognize = command_keyword + (command_args ? " " + command_args : "")
                    }
                
                    // 检查是否超过修正次数限制（仅对自动触发生效）
                    if (!is_manual_trigger) {
                        const session_key = this.get_session_key(data, content_to_recognize)
                        if (!this.check_correction_limit(session_key, content_to_recognize)) {
                            const limit_message = [
                                Structs.at(data.sender.user_id),
                                Structs.text(`\n命令修正次数过多，请检查命令是否正确。使用 ${this.chat_adapter_prefix}help 查看可用命令`)
                            ]
                            send_message(
                                data.adapter,
                                data.instance_name,
                                data.receiver.type,
                                data.sender.id,
                                limit_message,
                                data.origin_object
                            )
                            release_plugin_lock(user_id, 0)
                            return
                        }
                    }
                
                    // 立刻回复用户，告知正在处理
                    const processing_message = [
                        Structs.at(data.sender.user_id),
                        Structs.text(command_keyword === this.help.keyword
                            ? `\n正在智能识别您的意图...`
                            : `\n命令不存在，正在智能识别您的意图...`)
                    ]
                    
                    send_message(
                        data.adapter,
                        data.instance_name,
                        data.receiver.type,
                        data.sender.id,
                        processing_message,
                        data.origin_object
                    )
                    try {
                        const {session, model} = get_ai_session()

                        // 构建 AI 提示词
                        const available_commands_with_desc = correction_commands
                            .map(command => `${command.keyword}: ${command.description}${command.args.length > 0 ? ` (参数: ${command.args.join(", ")})` : ""}`)
                            .join("\n")

                        const available_commands = correction_commands
                            .map(command => command.keyword)
                            .join(", ")

                        const prompt = `用户输入了: "${content_to_recognize}"

可用的命令列表:
${available_commands_with_desc}

请判断用户最可能想要使用的命令关键字和参数。
返回格式: 命令关键字 参数(如果有)
例如: "help 1" 或 "message" 或 "baltop"
只返回修正后的命令和参数，不要有任何其他文字说明。如果无法判断，返回 "help"。

可用命令关键字: ${available_commands}`
                        
                        const completion = await session.chat.completions.create({
                            model: model,
                            messages: [
                                {
                                    role: "system",
                                    content: "你是一个命令修正助手。你只需要返回修正后的命令和参数，不要有任何其他解释或标点符号。"
                                },
                                {
                                    role: "user",
                                    content: prompt
                                }
                            ],
                            temperature: 0.2,
                            max_tokens: 30
                        })
                        
                        const corrected_text = completion.choices[0]?.message?.content?.trim() || "help"
                        const corrected_parts = corrected_text.split(" ")
                        const corrected_command = corrected_parts[0]
                        const corrected_args = corrected_parts.slice(1).join(" ")
                        
                        // 验证 AI 返回的命令是否在可用列表中
                        if (is_dispatchable_correction(corrected_command, this.help.keyword, keywords)) {
                            // 构建修正后的消息
                            const corrected_message = corrected_args
                                ? `${this.chat_adapter_prefix}${corrected_command} ${corrected_args}`
                                : `${this.chat_adapter_prefix}${corrected_command}`

                            // 通知用户命令已修正
                            const notification = [
                                Structs.at(data.sender.user_id),
                                Structs.text(`\n已识别为命令: ${corrected_command}${corrected_args ? " " + corrected_args : ""}`)
                            ]

                            send_message(
                                data.adapter,
                                data.instance_name,
                                data.receiver.type,
                                data.sender.id,
                                notification,
                                data.origin_object
                            )

                            // 释放锁（立即释放，无冷却期），以便重新触发的插件可以获取锁
                            release_plugin_lock(user_id, 0)

                            // 重新触发事件，使用修正后的命令
                            const corrected_data = {
                                ...data,
                                raw_message: corrected_message
                            }

                            // 延迟一点时间，让通知先发送
                            setTimeout(() => {
                                plugin_handle_adapter_event("chat_adapter", _event, corrected_data)

                                // 如果修正成功，清理该会话的历史记录（避免后续正常命令被限制）
                                if (!is_manual_trigger) {
                                    const session_key = this.get_session_key(data, content_to_recognize)
                                    // 延迟清理，确保命令执行完成
                                    setTimeout(() => {
                                        this.clear_correction_history(session_key)
                                    }, 1000)
                                }
                            }, 100)
                        } else {
                            // AI 返回的命令无效，使用 help
                            const fallback_message = [
                                Structs.at(data.sender.user_id),
                                Structs.text(`\n无法识别您的意图，请使用 ${this.chat_adapter_prefix}help 查看可用命令`)
                            ]

                            send_message(
                                data.adapter,
                                data.instance_name,
                                data.receiver.type,
                                data.sender.id,
                                fallback_message,
                                data.origin_object
                            )
                            release_plugin_lock(user_id, 0)
                        }
                    } catch (error: any) {
                        // AI 调用失败时的降级处理
                        const fallback_message = [
                            Structs.at(data.sender.user_id),
                            Structs.text(`\nAI 识别失败，请使用 ${this.chat_adapter_prefix}help 查看可用命令`)
                        ]
                        
                        send_message(
                            data.adapter,
                            data.instance_name,
                            data.receiver.type,
                            data.sender.id,
                            fallback_message,
                            data.origin_object
                        )
                        release_plugin_lock(user_id, 0)
                    }
                } catch (error: any) {
                    // 外层 catch：处理任何未预料的错误
                    release_plugin_lock(user_id, 0)
                    throw error
                }
            }
        }
    }
}
