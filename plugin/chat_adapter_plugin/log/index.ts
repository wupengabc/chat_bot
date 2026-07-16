import {Structs} from "node-napcat-ts"
import {send_message} from "../../../chat_adapter/index.js"
import {get_storage} from "../../../storage/index.js"
import {log_utils} from "../../../utils/log_utils.js"
import {acquire_plugin_lock, get_chat_adapter_prefix, plugin_logger, release_plugin_lock} from "../../index.js"
import {help} from "../../type.js"
import {parseLogArgs, resolveLogAccess} from "./logic.js"
const currentUrl = new URL(import.meta.url)
const version = currentUrl.searchParams.get("t") ?? Date.now().toString()
const utilsUrl = new URL("./utils/index.js", import.meta.url)
utilsUrl.searchParams.set("t", version)
const {renderLogReport} = await import(utilsUrl.href)

export class init {
    public help: help = {
        name: "log",
        keyword: "log",
        description: "查询系统运行日志",
        permission: 2,
        args: [
            { key: "页码", description: "可选", permission: 2, args: [] },
            { key: "type", description: "可选，info、warn 或 error", permission: 2, args: [] },
            { key: "platform", description: "可选，按平台筛选", permission: 2, args: [] },
            { key: "plugin", description: "可选，按插件筛选", permission: 2, args: [] },
        ],
        platform: "chat_adapter",
    }
    private command_start = get_chat_adapter_prefix() + this.help.keyword

    event_handler(_event: string, data: any) {
        if (data.adapter_platform !== "chat_adapter") return
        const args = data.raw_message.trim().split(/\s+/)
        if (args[0] !== this.command_start) return

        const user_id = data.sender.user_id.toString()
        if (!acquire_plugin_lock(user_id)) return this.reply(data, "请等待当前操作完成后再试")

        try {
            this.handle_command(data, args, user_id)
        } catch (error: any) {
            plugin_logger("log", error?.stack || String(error), "error")
            this.reply(data, "日志查询失败，请稍后再试")
        } finally {
            release_plugin_lock(user_id)
        }
    }

    private handle_command(data: any, args: string[], user_id: string) {
        const permission_storage = get_storage("chat_permission_storage")
        const player_storage = get_storage("bangxi_server_storage")
        const access = resolveLogAccess(user_id, permission_storage, player_storage)
        if (!access.ok) return this.reply(data, access.message)

        const parsed = parseLogArgs(args.slice(1))
        if (!parsed.ok) return this.reply(data, parsed.message)

        const [total, entries] = log_utils.query_logs(parsed.filter, parsed.page, 10)
        const totalPages = total === 0 ? 1 : Math.ceil(total / 10)
        if (total > 0 && parsed.page > totalPages) {
            return this.reply(data, `页码超出范围，共 ${totalPages} 页`)
        }

        const image = renderLogReport(entries, {
            page: total === 0 ? 1 : parsed.page,
            totalPages,
            totalCount: total,
            filter: parsed.filter,
        })
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.image(image)], data.origin_object)
    }

    private reply(data: any, message: string) {
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id,
            [Structs.at(data.sender.user_id), Structs.text(`\n${message}`)], data.origin_object)
    }
}
