import {NCWebsocket} from "node-napcat-ts";
import {chat_adapter_logger} from "../index.js";
import {ChatAdapterMessage} from "../type.js";
import {time_utils} from "../../utils/time_utils.js";
import {running_status} from "../../type/index.js";
import {event_emitter} from "../../utils/event_emitter.js";

export class init {
    private napcat: NCWebsocket
    public event = new event_emitter()
    public status: running_status = "stopped"
    constructor(napcatConfig:any) {

        this.napcat = new NCWebsocket({
            protocol: napcatConfig.protocol || 'ws',
            host: napcatConfig.host || 'localhost',
            port: napcatConfig.port || 3001,
            accessToken: napcatConfig.accessToken || '',
            reconnection: {
                enable: napcatConfig.reconnection?.enable ?? true,
                attempts: napcatConfig.reconnection?.attempts ?? 10,
                delay: napcatConfig.reconnection?.delay ?? 10000
            }
        })
        this.napcat.connect().then(() => {
            chat_adapter_logger("napcat", `napcat 连接成功`, "info")
        }).catch((error:any) => {
            chat_adapter_logger("napcat", `napcat 连接失败`, "error")
            chat_adapter_logger("napcat", error.message || error.stack || String(error), "error")
        })

        this.napcat.on("socket.open", () => {
            this.status = "running"
        })

        this.napcat.on("socket.close", () => {
            this.status = "stopped"
        })

        this.napcat.on("socket.connecting", () => {
            this.status = "connecting"
        })

        this.napcat.on("message", (msg) => {
            const emit_msg: ChatAdapterMessage = {
                adapter: 'napcat',
                instance_name: napcatConfig.name,
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
    }

    stop() {
        try {
            this.napcat.disconnect().then(() => {
                chat_adapter_logger("napcat", `napcat 已断开连接`, "info")
            }).catch((error: any) => {
                chat_adapter_logger("napcat", `napcat 断开连接失败: ${error.message || error}`, "error")
            })
            this.status = "stopped"
        } catch (error: any) {
            this.status = "stopped"
            chat_adapter_logger("napcat", `napcat 停止错误: ${error.message || error}`, "error")
        }
    }

    send(type: "group" | "private", user_id: number, message: any, event: any) {
        if (type === "group") {
            this.napcat.send_group_msg({
                group_id: user_id,
                message,
            }).then(() => {
                chat_adapter_logger("napcat", `发送群消息成功, 群ID: ${user_id}, 消息: ${message}`, "info")
            })
        } else if (type === "private") {
            this.napcat.send_private_msg({
                user_id: user_id,
                message,
            }).then(() => {
                chat_adapter_logger("napcat", `发送私信成功, 用户ID: ${user_id}, 消息: ${message}`, "info")
            })
        }
    }
}
