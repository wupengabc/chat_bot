import { help } from "../../type.js";
import {get_chat_adapter_prefix, plugin_logger, acquire_plugin_lock, release_plugin_lock} from "../../index.js";
import queryMinecraftMotd from "../../../service/minecraft_service/motd.js";
import {send_message} from "../../../chat_adapter/index.js";
import {Structs} from "node-napcat-ts";
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const { renderMinecraftMotdPng } = await import(utilsUrl.href)

export class init {
    public help:help = {
        name: "motd",
        keyword: "motd",
        description: "motd 插件, 用于获取Minecraft服务器的 MOTD 信息",
        permission: 0,
        args: [{ key: "服务器地址", description: "可选，默认 mc.bangxi.top", permission: 0, args: [] }],
        platform: "chat_adapter"
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword
    constructor() {
    }
    async event_handler(event: any, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            if (data.raw_message.split(" ")[0] === this.command_start) {
                const user_id = data.sender.user_id.toString()
                if (!acquire_plugin_lock(user_id)) {
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
                        [Structs.at(data.sender.user_id), Structs.text("请等待当前操作完成后再试")], data.origin_object)
                    return
                }
                try {
                    const ip_address = data.raw_message.split(" ")[1] || "mc.bangxi.top:25565";
                    const address = ip_address.split(":")[0]
                    const port = ip_address.split(":")[1]
                    try {
                        const start_message = [Structs.at(data.sender.user_id), Structs.text(`开始查询服务器 ${ip_address} MOTD信息`)]
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, start_message, data.origin_object)
                        const result = await queryMinecraftMotd(address, port)
                        const image_buffer = await renderMinecraftMotdPng(result)
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id) ,Structs.image(image_buffer)], data.origin_object)
                    } catch (error:any) {
                        const error_message = [Structs.at(data.sender.user_id), Structs.text(`查询服务器 ${ip_address} MOTD信息失败: ${error.message}`)]
                        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, error_message, data.origin_object)
                        plugin_logger("motd", error.message, "error")
                    }
                } catch (error:any) {
                    const error_message = [Structs.at(data.sender.user_id), Structs.text(`查询服务器MOTD信息失败: ${error.message}`)]
                    send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, error_message, data.origin_object)
                    plugin_logger("motd", error.message, "error")
                } finally {
                    release_plugin_lock(user_id)
                }
            }
        }
    }
}