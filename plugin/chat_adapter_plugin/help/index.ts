import {help} from "../../type.js";
import {send_message} from "../../../chat_adapter/index.js";
import {get_chat_adapter_prefix, help_list, permission_map} from "../../index.js";
import {Structs} from "node-napcat-ts";
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const { renderCommandHelp } = await import(utilsUrl.href)

export class init {
    private help_list_page_size = 5
    public help: help = {
        name: "chat_adapter_help",
        keyword: "help",
        description: "获取聊天适配器的帮助",
        permission: 0,
        args: ["页码(可选)"],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword
    constructor() {}
    event_handler(event: any, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.startsWith(this.command_start)) {
                const page = parseInt(data.raw_message.split(" ")[1]) || 1
                const chat_adapter_help = help_list.filter(item => item.platform === "chat_adapter")
                const total_page = Math.ceil(chat_adapter_help.length / this.help_list_page_size)
                const page_list_send = chat_adapter_help.slice((page - 1) * this.help_list_page_size, page * this.help_list_page_size)
                const buffer = renderCommandHelp(page_list_send, page, total_page, {
                    width: 600
                })
                if (buffer) {
                    const message = [Structs.at(data.sender.user_id),Structs.image(buffer)]
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, message, data.origin_object)
                }
            }
        }
    }
}

