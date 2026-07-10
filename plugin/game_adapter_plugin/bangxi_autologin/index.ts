import {get_game_adapter} from "../../../game_adapter/index.js";

export class init {
    private password: string;
    constructor(config: any) {
        this.password = config.password;
    }

    event_handler(event: any, data: any) {
        if (event === "login") {
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
                login()
            }
        }
    }
}