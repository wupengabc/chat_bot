import { help } from "../../type.js";
import {get_game_adapter} from "../../../game_adapter/index.js";

export class init {
    private readonly server_owner_list : string[];
    public help: help = {
        name: "bangxi_autoend",
        keyword: "autoend",
        description: "自动end",
        permission: 0,
        args: [],
        platform: "game_adapter",
    }
    constructor(config: any) {
        this.server_owner_list = config.players
    }

    event_handler(event: any, data: any) {
        if (event === "player_list") {
            if (data.adapter === "mineflayer" && data.instance_name === "bangxi") {
                const usernames = data.players.map((player: any) => player.username)
                if (usernames.some((username: string) => this.server_owner_list.includes(username))) {
                    const temp_instance = get_game_adapter("mineflayer", "bangxi")
                    temp_instance.bot.end("Server_Owner is Online")
                }
            }
        }
    }

    on_unload() {

    }
}