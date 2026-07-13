import {get_game_adapter} from "../../../game_adapter/index.js";
import {help} from "../../type.js";


export class init {
    private password: string;
    public help: help = {
        name: "bangxi_autologin",
        keyword: "autologin",
        description: "自动登录bangxi",
        permission: 0,
        args: [],
        platform: "game_adapter",
    }
    constructor(config: any) {
        this.password = config.password;
    }

    event_handler(event: any, data: any) {
        if (event === "message") {
            if (data.adapter === "mineflayer" && data.instance_name === "bangxi") {
                const login = () => {
                    const instance = get_game_adapter("mineflayer", "bangxi");
                    const result = instance.send_message("/login " + this.password);
                    if (!result) {
                        setTimeout(() => {
                            login()
                        }, 1000)
                    }
                }
                if (data.message.plainText.includes("请输入“ /login <密码> ”以登录") && data.position === "system") {
                    login()
                }
            }
        }
    }
}