import {help} from "../../type.js";
import {get_game_adapter} from "../../../game_adapter/index.js";

function isPrivate(node: any): boolean {
    if (!node) return false

    if (
        node.clickEvent?.action === "suggest_command" &&
        typeof node.clickEvent.command === "string" &&
        /^\/(?:tell|msg|w|m)\s+\S+/.test(node.clickEvent.command)
    ) {
        return true
    }

    return Array.isArray(node.extra) && node.extra.some(isPrivate)
}

export class init {
    private readonly home: string;
    private isGoingHome: boolean = false;
    private going_timer: any = null;
    public help: help = {
        name: "bangxi_autohome",
        keyword: "autohome",
        description: "自动home",
        permission: 0,
        args: [],
        platform: "game_adapter",
    }
    constructor(config: any) {
        this.home = config.home;
    }

    event_handler(event: any, data: any) {
        if (event === "message") {
            if (data.adapter === "mineflayer" && data.instance_name === "bangxi") {
                if (data.position === "system") {
                    if (!isPrivate(data.message.normalized)) {
                        if (data.message.plainText.includes("主城大区")) {
                            if (!this.isGoingHome) {
                                this.isGoingHome = true
                                this.going_timer = setTimeout(() => {
                                    const temp_instance = get_game_adapter("mineflayer", "bangxi")
                                    temp_instance.send_message("/home " + this.home)
                                    this.isGoingHome = false
                                }, 5000)
                            }
                        }
                    }
                }
            }
        }
    }

    on_unload() {
        clearTimeout(this.going_timer)
        this.isGoingHome = false
    }
}