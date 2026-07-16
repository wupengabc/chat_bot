import { help } from "../../type.js";
import {get_chat_adapter_prefix, acquire_plugin_lock, release_plugin_lock, acquire_named_lock, release_named_lock} from "../../index.js";
import {send_message} from "../../../chat_adapter/index.js";
import {Structs} from "node-napcat-ts";
import {get_game_adapter} from "../../../game_adapter/index.js";
import {get_storage} from "../../../storage/index.js";

interface PendingBindTask {
    game_instance: any
    listener: (data: any) => void
    timer: ReturnType<typeof setTimeout>
    user_id: string
}

export class init {
    public help:help = {
        name: "bind",
        keyword: "bind",
        description: "绑定您的游戏账户到Chat",
        permission: 0,
        args: [
            {
                key: "get",
                description: "获取绑定信息",
                permission: 0,
                args: [],
            },
            {
                key: "set",
                description: "绑定游戏账户",
                permission: 0,
                args: [
                    { key: "游戏账户id", description: "要绑定的游戏账户 ID", permission: 0, args: [] },
                    { key: "游戏账户名", description: "可选，用于指定账户名称", permission: 0, args: [] },
                ],
            },
            {
                key: "delete",
                description: "删除绑定信息",
                permission: 0,
                args: [],
            },
        ],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword
    
    /** 正在进行的绑定任务 */
    private pending_tasks: PendingBindTask[] = []
    
    constructor() {
    }
    
    on_unload() {
        for (const task of this.pending_tasks) {
            clearTimeout(task.timer)
            task.game_instance.event.off("message", task.listener)
            release_plugin_lock(task.user_id, 0)
            release_named_lock("bind", task.user_id, 0)
        }
        this.pending_tasks.length = 0
    }
    
    /** 验证 Minecraft 用户名格式 */
    private validate_minecraft_username(username: string): boolean {
        // Minecraft 用户名规则：3-16 个字符，只能包含字母、数字和下划线
        const regex = /^[a-zA-Z0-9_]{3,16}$/
        return regex.test(username)
    }
    
    event_handler(_event: string, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.split(" ")[0] === this.command_start) {
                const user_id = data.sender.user_id.toString()
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
                
                const args = data.raw_message.split(" ")
                const action = args[1]
                const game_id = args[2]
                
                if (!action) {
                    send_message(
                        data.adapter,
                        data.instance_name,
                        data.receiver.type,
                        data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("\n请指定操作: get(查询) / set(绑定) / delete(解绑)")],
                        data.origin_object
                    )
                    release_plugin_lock(user_id)
                    return
                }
                
                const permission_storage = get_storage("chat_permission_storage")
                if (!permission_storage) {
                    send_message(
                        data.adapter,
                        data.instance_name,
                        data.receiver.type,
                        data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("\n权限系统未初始化")],
                        data.origin_object
                    )
                    release_plugin_lock(user_id)
                    return
                }
                
                switch (action.toLowerCase()) {
                    case "get":
                        this.handle_get(data, permission_storage)
                        release_plugin_lock(user_id)
                        break
                    case "set":
                        // handle_set 内部自行管理共享锁和命名锁
                        this.handle_set(data, permission_storage, game_id, user_id)
                        break
                    case "delete":
                        this.handle_delete(data, permission_storage)
                        release_plugin_lock(user_id)
                        break
                    default:
                        send_message(
                            data.adapter,
                            data.instance_name,
                            data.receiver.type,
                            data.sender.id,
                            [Structs.at(data.sender.user_id), Structs.text("\n未知操作，请使用: get / set / delete")],
                            data.origin_object
                        )
                        release_plugin_lock(user_id)
                }
            }
        }
    }
    
    private handle_get(data: any, permission_storage: any) {
        const user_info = permission_storage.get_user_info(data.sender.user_id.toString())
        
        if (!user_info || !user_info.game_id) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n您还未绑定游戏账户")],
                data.origin_object
            )
        } else {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`\n您当前绑定的游戏账户: ${user_info.game_id}`)],
                data.origin_object
            )
        }
    }
    
    private handle_delete(data: any, permission_storage: any) {
        const unbind_result = permission_storage.unbind_game_id(data.sender.user_id.toString())
        
        if (unbind_result.success) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`\n解绑成功！已解除与游戏账户 ${unbind_result.old_game_id} 的绑定`)],
                data.origin_object
            )
        } else {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`\n解绑失败: ${unbind_result.message}`)],
                data.origin_object
            )
        }
    }
    
    private handle_set(data: any, permission_storage: any, game_id: string, user_id: string) {
        if (!game_id) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n请输入要绑定的游戏账户ID")],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 验证 Minecraft 用户名格式
        if (!this.validate_minecraft_username(game_id)) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n无效的游戏账户ID格式（3-16位字母、数字或下划线）")],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 提前检查用户是否已绑定
        const user_info = permission_storage.get_user_info(data.sender.user_id.toString())
        if (user_info?.game_id && user_info.game_id !== "") {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text(`\n您已绑定游戏账户: ${user_info.game_id}\n请先使用 ${get_chat_adapter_prefix()}bind delete 解绑`)],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 检查游戏ID是否已被其他用户绑定
        if (permission_storage.is_game_id_bound(game_id)) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n该游戏账户已被其他用户绑定")],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 检查 bot 连接状态
        const game_instance = get_game_adapter("mineflayer", "bangxi")
        if (!game_instance || game_instance.status !== "running") {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\nBot 暂未连接至服务器，无法验证账户")],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 检查用户是否存在于服务器
        const bangxi_storage = get_storage("bangxi_server_storage")
        if (!bangxi_storage) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n服务器存储未初始化")],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 获取 bind 命名锁，防止同一用户同时发起多个绑定请求
        if (!acquire_named_lock("bind", user_id)) {
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n您已有正在进行的绑定请求，请等待完成或超时后再试")],
                data.origin_object
            )
            release_plugin_lock(user_id)
            return
        }
        
        // 发送验证消息到游戏内
        send_message(
            data.adapter,
            data.instance_name,
            data.receiver.type,
            data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n正在验证游戏账户 ${game_id}，请在游戏内60秒内回复 "ok" 确认绑定...`)],
            data.origin_object
        )
        
        let settled = false
        
        const on_message = (game_data: any) => {
            if (settled) return
            if (game_data.adapter !== "mineflayer") return
            if (game_data.instance_name !== "bangxi") return
            
            const plain_text = game_data.message.plainText?.trim()
            if (!plain_text) return
            
            let player_name = game_data.player_name
            
            // 如果是 system 位置的消息，尝试解析私聊格式 [玩家名 -> 我] 消息
            if (game_data.position === "system") {
                const private_msg_match = plain_text.match(/^\[(.+?)\s*->\s*(.+?)\]\s*(.*)$/)
                if (private_msg_match) {
                    player_name = private_msg_match[1].trim()
                } else {
                    return // 不是私聊消息格式
                }
            } else if (game_data.position !== "chat") {
                return // 只处理 chat 和 system
            }
            
            // 检查是否是目标玩家回复的包含 "ok" 的消息
            if (player_name === game_id && plain_text.toLowerCase().includes("ok")) {
                settled = true
                clearTimeout(timer)
                game_instance.event.off("message", on_message)
                remove_pending()
                
                // 执行绑定（这里不再需要重复检查，因为前面已经检查过了）
                const bind_result = permission_storage.bind_game_id(data.sender.user_id.toString(), game_id)
                
                if (bind_result.success) {
                    send_message(
                        data.adapter,
                        data.instance_name,
                        data.receiver.type,
                        data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text(`\n绑定成功！游戏账户 ${game_id} 已绑定到您的QQ`)],
                        data.origin_object
                    )
                } else {
                    send_message(
                        data.adapter,
                        data.instance_name,
                        data.receiver.type,
                        data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text(`\n绑定失败: ${bind_result.message}`)],
                        data.origin_object
                    )
                }
            }
        }
        
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            game_instance.event.off("message", on_message)
            remove_pending()
            
            send_message(
                data.adapter,
                data.instance_name,
                data.receiver.type,
                data.sender.id,
                [Structs.at(data.sender.user_id), Structs.text("\n验证超时，请重新尝试绑定")],
                data.origin_object
            )
        }, 60000) // 60 秒超时
        
        const task: PendingBindTask = { game_instance, listener: on_message, timer, user_id }
        this.pending_tasks.push(task)
        
        const remove_pending = () => {
            const idx = this.pending_tasks.indexOf(task)
            if (idx >= 0) this.pending_tasks.splice(idx, 1)
            release_plugin_lock(user_id)
            release_named_lock("bind", user_id)
        }
        
        game_instance.event.on("message", on_message)
    }
}
