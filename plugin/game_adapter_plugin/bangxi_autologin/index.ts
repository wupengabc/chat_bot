import {get_game_adapter} from "../../../game_adapter/index.js";
import {plugin_logger} from "../../index.js";
import {help} from "../../type.js";


export class init {
    private password: string;
    private loginTimer: ReturnType<typeof setTimeout> | null = null;
    private loginAttempted = false;
    private disposed = false;
    private readonly loginDelayMs: number;
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
        const loginDelayMs = Number(config.login_delay_ms);
        this.loginDelayMs = Number.isFinite(loginDelayMs) ? Math.max(0, Math.floor(loginDelayMs)) : 5000;
    }

    private clearLoginTimer(): void {
        if (!this.loginTimer) return;
        clearTimeout(this.loginTimer);
        this.loginTimer = null;
    }

    private requestLogin(): void {
        if (this.disposed || !this.password || this.loginAttempted || this.loginTimer) return;
        const instance = get_game_adapter("mineflayer", "bangxi") as any;
        if (!instance) return;

        plugin_logger("bangxi_autologin", `收到登录提示，将在 ${this.loginDelayMs}ms 后发送登录命令`, "info");
        this.loginTimer = setTimeout(() => {
            this.loginTimer = null;
            const currentInstance = get_game_adapter("mineflayer", "bangxi") as any;
            if (this.disposed || this.loginAttempted || currentInstance !== instance || currentInstance?.status !== "running") return;
            if (currentInstance.send_message(`/login ${this.password}`)) {
                this.loginAttempted = true;
                plugin_logger("bangxi_autologin", "已发送登录命令", "info");
            }
        }, this.loginDelayMs);
    }

    event_handler(event: any, data: any) {
        if (data.adapter !== "mineflayer" || data.instance_name !== "bangxi") return;
        if (event === "login") {
            this.clearLoginTimer();
            this.loginAttempted = false;
            return;
        }
        if (event === "disconnect" || event === "kicked") {
            this.clearLoginTimer();
            this.loginAttempted = false;
            return;
        }
        if (event !== "message" || data.position !== "system") return;
        if (data.message?.plainText.includes("请输入“ /login <密码> ”以登录")) this.requestLogin();
    }

    on_unload() {
        this.disposed = true;
        this.clearLoginTimer();
    }
}
