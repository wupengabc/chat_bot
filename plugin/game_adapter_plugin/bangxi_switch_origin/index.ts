import {get_game_adapter} from "../../../game_adapter/index.js";
import { help } from "../../type.js";

export class init {
    public help: help = {
        name: "bangxi_switch_origin",
        keyword: "switch_origin",
        description: "切换到主城",
        permission: 0,
        args: [],
        platform: "game_adapter",
    }
    constructor() {
    }

    event_handler(event: any, data: any) {
        if (event === "message") {
            if (data.adapter === "mineflayer" && data.instance_name === "bangxi") {
                const messageParsed = data.message
                if (data.position !== "system") {
                    return
                }
                const instance = get_game_adapter("mineflayer", "bangxi");
                if (messageParsed.plainText.includes("密码要设置复杂,安全更加有保障,记在手机备忘录,安全牢记不丢失")) {
                    setTimeout(() => {
                        instance.bot.activateItem()
                        setTimeout(() => {
                            instance.bot.deactivateItem()
                        }, 100)
                        const onceWindowOpen = (_window: any) => {
                            setTimeout(() => {
                                instance.bot.clickWindow(13, 1, 0).then(() => {}).catch(() => {})
                            }, 100)
                        }
                        instance.bot.once("windowOpen", onceWindowOpen)
                        // bot 销毁时移除未触发的 once
                        instance.bot._client_listeners = instance.bot._client_listeners || []
                        instance.bot._client_listeners.push({ target: 'bot', event: 'windowOpen', listener: onceWindowOpen })
                    }, 1000)
                }
            }
        }
    }
}