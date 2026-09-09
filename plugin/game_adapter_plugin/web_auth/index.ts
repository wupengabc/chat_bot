import {get_game_adapter} from "../../../game_adapter/index.js";
import {get_storage} from "../../../storage/index.js";
import {plugin_logger} from "../../index.js";

function generateRandomCode(length: number): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function isPrivateMessage(node: any): boolean {
    if (!node) return false;
    if (
        node.clickEvent?.action === "suggest_command" &&
        typeof node.clickEvent.command === "string" &&
        /^\/(?:tell|msg|w|m)\s+\S+/.test(node.clickEvent.command)
    ) {
        return true;
    }
    return Array.isArray(node.extra) && node.extra.some(isPrivateMessage);
}

function parsePrivateMessage(text: string): {from: string, to: string, content: string} | null {
    const match = text.match(/^\[(.+?)\s*->\s*(.+?)\]\s*(.*)$/);
    if (!match) return null;
    return {
        from: match[1].trim(),
        to: match[2].trim(),
        content: match[3],
    };
}

export class init {
    constructor() {}

    event_handler(event: string, data: any) {
        if (event !== "message") return;
        if (data.adapter !== "mineflayer" || data.instance_name !== "bangxi") return;

        const message = data.message;
        if (!message?.normalized) return;

        if (!isPrivateMessage(message.normalized)) return;

        const parsed = parsePrivateMessage(message.plainText);
        if (!parsed) return;
        const sender = parsed.from;
        const parts = parsed.content.trim().split(' ');
        const command = parts[0]?.toLowerCase();
        const password = parts[1];
        const confirmPassword = parts[2];
        const username = sender;

        const gameInstance = get_game_adapter("mineflayer", "bangxi") as any;
        if (!gameInstance || gameInstance.status !== "running") {
            plugin_logger("web_auth", `游戏实例不可用，无法处理 ${username} 的请求`, "warn");
            return;
        }

        const storage = get_storage("bangxi_server_storage") as any;
        if (!storage) {
            plugin_logger("web_auth", "bangxi_server_storage 不可用", "error");
            return;
        }

        if (command === "reg") {
            if (!password || !confirmPassword) {
                gameInstance.send_message(`/tell ${username} 用法: /tell botName reg <密码> <重复密码> ${generateRandomCode(5)}`);
                return;
            }
            if (password !== confirmPassword) {
                gameInstance.send_message(`/tell ${username} 两次密码输入不一致 ${generateRandomCode(5)}`);
                return;
            }
            if (password.length < 4) {
                gameInstance.send_message(`/tell ${username} 密码长度不能少于 4 位 ${generateRandomCode(5)}`);
                return;
            }
            if (storage.is_user_registered(username)) {
                gameInstance.send_message(`/tell ${username} 该用户名已注册，请使用 cpwd 修改密码 ${generateRandomCode(5)}`);
                return;
            }

            storage.set_user_password(username, password);
            gameInstance.send_message(`/tell ${username} 注册成功，可使用网页端登录 ${generateRandomCode(5)}`);
            plugin_logger("web_auth", `用户 ${username} 注册成功`, "info");

        } else if (command === "cpwd") {
            if (!password || !confirmPassword) {
                gameInstance.send_message(`/tell ${username} 用法: /tell botName cpwd <新密码> <重复新密码> ${generateRandomCode(5)}`);
                return;
            }
            if (password !== confirmPassword) {
                gameInstance.send_message(`/tell ${username} 两次密码输入不一致 ${generateRandomCode(5)}`);
                return;
            }
            if (password.length < 4) {
                gameInstance.send_message(`/tell ${username} 密码长度不能少于 4 位 ${generateRandomCode(5)}`);
                return;
            }
            if (!storage.is_user_registered(username)) {
                gameInstance.send_message(`/tell ${username} 您尚未注册，请先使用 reg 注册 ${generateRandomCode(5)}`);
                return;
            }

            storage.set_user_password(username, password);
            gameInstance.send_message(`/tell ${username} 密码修改成功 ${generateRandomCode(5)}`);
            plugin_logger("web_auth", `用户 ${username} 修改密码成功`, "info");
        }
    }

    on_unload() {}
}