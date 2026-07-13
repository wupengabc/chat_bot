import { help } from "../../type.js";
import {get_chat_adapter_prefix, acquire_plugin_lock, release_plugin_lock} from "../../index.js";
import {send_message} from "../../../chat_adapter/index.js";
import {Structs} from "node-napcat-ts";
import {get_storage} from "../../../storage/index.js";
import {and, count, desc, eq} from "drizzle-orm";
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const { renderChatHistory } = await import(utilsUrl.href)

export class init {
    public help:help = {
        name: "message",
        keyword: "message",
        description: "查询服务器消息记录",
        permission: 0,
        args: ["页码(默认1)", "条数(10-20 默认15)"],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword
    constructor() {
    }
    event_handler(event: string,data: any) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.split(" ")[0] === this.command_start) {
                const user_id = data.sender.user_id.toString()
                if (!acquire_plugin_lock(user_id)) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("请等待当前操作完成后再试")], data.origin_object)
                    return
                }
                try {
                    const page = parseInt(data.raw_message.split(" ")[1]) || 1
                    const count1 = parseInt(data.raw_message.split(" ")[2]) || 15
                    if (count1 < 10 || count1 > 20) {
                        const error_message = [Structs.at(data.sender.user_id), Structs.text("条数必须在10-20之间")]
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, error_message, data.origin_object)
                        return
                    }
                    const storage = get_storage("bangxi_server_storage")
                    if (!storage) {
                        const error_message = [Structs.at(data.sender.user_id), Structs.text("bangxi_server_storage storage 未初始化")]
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, error_message, data.origin_object)
                        return
                    }
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id), Structs.text("正在开始查询消息记录...")], data.origin_object)
                    const {orm: message_orm, table} = storage.get_message_orm()
                    const messages = message_orm
                        .select()
                        .from(table)
                        .where(and(eq(table.position, "chat"), eq(table.message_type, "public")))
                        .orderBy(desc(table.id))
                        .limit(count1)
                        .offset((page - 1) * count1)
                        .all()
                    const total_count = message_orm
                        .select({total: count()})
                        .from(table)
                        .where(and(eq(table.position, "chat"), eq(table.message_type, "public")))
                        .get()
                    const total_page = Math.ceil(total_count.total / count1)
                    const image = renderChatHistory(messages, { page, totalPage: total_page, maxItems: count1, sortByTime: false })
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id) ,Structs.image(image)], data.origin_object)
                } finally {
                    release_plugin_lock(user_id)
                }
            }
        }
    }
}