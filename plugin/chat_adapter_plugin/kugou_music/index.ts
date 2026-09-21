import {get_chat_adapter_prefix, acquire_plugin_lock, plugin_logger, release_plugin_lock} from "../../index.js";
import type {help} from "../../type.js";
import {send_message} from "../../../chat_adapter/index.js";
import {searchSongs, songUrl, cachedSongFile} from "../../../service/kugou/kugou.js";
import {message as Structs} from "@snowluma/sdk";
import {readFile} from "node:fs/promises";

function songHash(song: any): string { return String(song?.FileHash ?? song?.hash ?? song?.Hash ?? ""); }
function songTitle(song: any): string { return String(song?.FileName ?? song?.SongName ?? song?.name ?? song?.songname ?? song?.filename ?? "未知歌曲"); }
function singer(song: any): string { return String(song?.SingerName ?? song?.Singer ?? song?.singername ?? song?.singerinfo?.map((item: any) => item?.name).filter(Boolean).join(" / ") ?? "未知歌手"); }
function cover(song: any): string { return String(song?.Image ?? song?.image ?? song?.cover ?? song?.imgurl ?? song?.AlbumImg ?? "").replace("{size}", "240"); }
function musicCardRequest(song: any, audioUrl: string, apiKey: string): Record<string, string> {
    const image = cover(song)
    if (!apiKey.trim()) throw new Error("未配置音乐卡片签名服务令牌")
    if (!/^https?:\/\//i.test(image)) throw new Error("歌曲封面地址无效，无法发送音乐卡片")
    if (!/^https?:\/\//i.test(audioUrl)) throw new Error("歌曲播放地址无效，无法发送音乐卡片")
    return {
        key: apiKey,
        url: audioUrl,
        song: songTitle(song),
        singer: singer(song),
        cover: image,
        jump: audioUrl,
        format: "kugou",
    }
}
interface SearchSession { songs: any[]; expiresAt: number; }

function recordFlagged(input: string): {text: string; record: boolean} {
    const trimmed = input.trim();
    if (!trimmed) return {text: trimmed, record: false};
    const tokens = trimmed.split(/\s+/);
    if (tokens[tokens.length - 1].toLowerCase() === "record") {
        tokens.pop();
        return {text: tokens.join(" ").trim(), record: true};
    }
    return {text: trimmed, record: false};
}

export class init {
    public help: help = {name: "kugou_music", keyword: "music", description: "music search <歌曲名> 自动发送第 1 首歌曲卡片；music get <序号> 获取其他音乐卡片；末尾添加 record 参数改为发送语音录音", permission: 0, args: [{key: "search 歌曲名 [record]", description: "搜索歌曲、自动发送第 1 首并列出其余选项，末尾加 record 发送语音", permission: 0, args: []}, {key: "get 序号 [record]", description: "通过搜索序号获取其他音乐卡片，末尾加 record 发送语音", permission: 0, args: []}], platform: "chat_adapter"};
    private readonly commandStart = `${get_chat_adapter_prefix()}${this.help.keyword}`;
    private readonly serviceConfig: string;
    private readonly signatureApi: string;
    private readonly signatureApiKey: string;
    private readonly sessions = new Map<string, SearchSession>();
    constructor(config: {serviceConfig?: string, signatureApi?: string, signatureApiKey?: string}) {
        this.serviceConfig = config.serviceConfig || "default";
        this.signatureApi = config.signatureApi || "https://apii.xianyuw.cn/api/v1/qq-musicArk";
        this.signatureApiKey = config.signatureApiKey || "";
    }
    on_unload() { this.sessions.clear(); }
    private reply(data: any, text: string) { send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id), Structs.text(`\n${text}`)], data.origin_object); }
    private async sendMusic(data: any, song: any, audioUrl: string) {
        const request = musicCardRequest(song, audioUrl, this.signatureApiKey)
        const endpoint = new URL(this.signatureApi)
        for (const [key, value] of Object.entries(request)) endpoint.searchParams.set(key, value)
        const response = await fetch(endpoint, {headers: {accept: "application/json"}})
        if (!response.ok) throw new Error(`音乐卡片签名服务请求失败: HTTP ${response.status}`)
        const result = await response.json()
        if (result?.code !== 200) throw new Error(`音乐卡片签名服务返回错误: ${result?.msg || result?.code || "未知错误"}`)
        const card = result.data
        if (!card || typeof card !== "object" || Array.isArray(card) || card.view !== "music" || !card.meta?.music?.musicUrl) {
            throw new Error("音乐卡片签名服务返回了无效数据")
        }
        const json = JSON.stringify(card)
        plugin_logger("kugou_music", `发送已签名音乐卡片: ${json.slice(0, 4_000)}${json.length > 4_000 ? "... [truncated]" : ""}`, "info")
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [Structs.at(data.sender.user_id), {type: "json", data: {data: json}}], data.origin_object)
    }
    private async loadRecordFile(hash: string): Promise<Buffer> {
        const {file} = await cachedSongFile(this.serviceConfig, hash, ["128", "high", "320", "flac"]);
        return await readFile(file);
    }
    private sendRecord(data: any, buffer: Buffer, name = "歌曲语音") {
        plugin_logger("kugou_music", `发送歌曲语音: ${buffer.length} bytes`, "info")
        send_message(data.adapter, data.instance_name, data.receiver.type, data.sender.id, [{type: "record", data: {file: buffer, name}}], data.origin_object)
    }
    private sessionKey(data: any): string { return `${data.adapter}:${data.instance_name}:${data.sender.user_id}`; }
    async event_handler(event: string, data: any) {
        if (event !== "message" || data.adapter_platform !== "chat_adapter") return;
        const raw = String(data.raw_message || "").trim();
        const userId = String(data.sender.user_id);
        const command = raw.match(new RegExp(`^${this.commandStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+(.+))?$`, "i"));
        if (!command) return;
        const [, input = ""] = command;
        const [action = "", ...argumentsList] = input.trim().split(/\s+/);
        const argument = argumentsList.join(" ").trim();
        if (!acquire_plugin_lock(userId)) { this.reply(data, "请等待当前操作完成后再试"); return; }
        try {
            const parsed = recordFlagged(argument)
            if (action.toLowerCase() === "search") {
                if (!parsed.text) { this.reply(data, "用法：music search <歌曲名> [record]"); return; }
                const songs = (await searchSongs(this.serviceConfig, parsed.text)).filter(song => songHash(song)).slice(0, 10);
                if (!songs.length) { this.reply(data, "没有找到可播放的歌曲"); return; }
                this.sessions.set(this.sessionKey(data), {songs, expiresAt: Date.now() + 30 * 60_000});
                const firstSong = songs[0];
                if (parsed.record) {
                    this.sendRecord(data, await this.loadRecordFile(songHash(firstSong)), `${songTitle(firstSong)}.mp3`);
                } else {
                    const playable = await songUrl(this.serviceConfig, songHash(firstSong), ["128", "high", "320", "flac"]);
                    await this.sendMusic(data, firstSong, playable.url);
                }
                const alternatives = songs.slice(1).map((song, index) => `${index + 2}. ${songTitle(song)} - ${singer(song)}`).join("\n");
                if (alternatives) this.reply(data, `已发送第 1 首歌曲。\n\n其他选项：\n${alternatives}\n\n使用 ${this.commandStart} get 序号 选择其他歌曲`);
                return;
            }
            if (action.toLowerCase() === "get") {
                if (!/^\d{1,2}$/.test(parsed.text)) { this.reply(data, "用法：music get 歌曲序号 [record]"); return; }
                const sessionKey = this.sessionKey(data);
                const session = this.sessions.get(sessionKey);
                if (!session || session.expiresAt < Date.now()) {
                    this.sessions.delete(sessionKey);
                    this.reply(data, "搜索结果已过期，请先使用 music search 搜索歌曲");
                    return;
                }
                const song = session.songs[Number(parsed.text) - 1];
                if (!song) { this.reply(data, "歌曲序号无效，请输入搜索结果中的序号"); return; }
                if (parsed.record) {
                    this.sendRecord(data, await this.loadRecordFile(songHash(song)), `${songTitle(song)}.mp3`);
                } else {
                    const playable = await songUrl(this.serviceConfig, songHash(song), ["128", "high", "320", "flac"]);
                    await this.sendMusic(data, song, playable.url);
                }
                return;
            }
            this.reply(data, "操作无效，可用操作：search / get\n用法：music search 歌曲名（自动发送第 1 首）\nmusic get 歌曲序号");
        } catch (error: any) {
            plugin_logger("kugou_music", error?.stack || String(error), "error");
            this.reply(data, `音乐操作失败: ${error?.message || String(error)}`);
        }
        finally { release_plugin_lock(userId); }
    }
}
