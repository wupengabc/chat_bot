import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {path_utils} from "../../utils/path_utils.js";

type Json = Record<string, any>;
export type KugouAccount = Record<string, string>;
export interface KugouConfig extends Json { name: string; kugouApi: string; account: KugouAccount; tokenRefreshHours?: number; playlistPageSize?: number; autoPlay?: boolean; autoPictureInPicture?: boolean; }

const root = path.join(path_utils.get_project_root_path(), "service", "kugou");
const configPath = path.join(root, "config.json");
const dataPath = path.join(root, "data", "kugou.json");
const cacheRoot = path.join(root, "data", "temp");
const authorizationNames: Record<string, string> = {token: "token", userid: "userid", t1: "t1", dfid: "dfid", mid: "KUGOU_API_MID", guid: "KUGOU_API_GUID", serverDev: "KUGOU_API_DEV", mac: "KUGOU_API_MAC"};

interface RuntimeData { playlists?: Record<string, unknown>; tracks?: Record<string, unknown[]>; user?: Record<string, unknown>; vip?: Record<string, unknown>; playlistsSyncedAt?: string; tracksSyncedAt?: Record<string, string>; }
interface LoginSession { id: string; instanceName: string; key: string; createdAt: number; }
export interface KugouMvInfo { mvhash: string; downurl: string; backupdownurl: string[]; filesize: number | null }
const loginSessions = new Map<string, LoginSession>();
const refreshTimers = new Map<string, ReturnType<typeof setInterval>>();
const mediaDownloads = new Map<string, Promise<string>>();

function readJson<T>(filePath: string, fallback: T): T {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; } catch { return fallback; }
}
function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const temporary = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
}
function configDocument(): Json { return readJson<Json>(configPath, {configs: []}); }
export function getConfig(instanceName = "default"): KugouConfig {
    const instance = configDocument().configs?.find((item: Json) => item?.name === instanceName);
    if (!instance) throw new Error(`未找到酷狗配置实例: ${instanceName}`);
    return {...instance, account: instance.account && typeof instance.account === "object" ? instance.account : {}};
}
function updateAccount(instanceName: string, account: KugouAccount): void {
    const document = configDocument();
    const instance = document.configs?.find((item: Json) => item?.name === instanceName);
    if (!instance) throw new Error(`未找到酷狗配置实例: ${instanceName}`);
    instance.account = account;
    writeJson(configPath, document);
}
function unwrap(value: any): any { return value?.data ?? value; }
function valueOf(source: any, names: string[]): string {
    for (const name of names) {
        const value = source?.[name];
        if (value !== undefined && value !== null && value !== "") return String(value);
    }
    return "";
}
function valuesOf(source: any, names: string[]): string[] {
    const values: string[] = [];
    for (const name of names) {
        const value = source?.[name];
        if (Array.isArray(value)) values.push(...value.filter(item => typeof item === "string" && item));
        else if (typeof value === "string" && value) values.push(value);
    }
    return [...new Set(values)];
}
function extractAccount(source: any, existing: KugouAccount = {}): KugouAccount {
    const data = unwrap(source);
    const nested = data?.tokenInfo ?? data?.userinfo ?? data?.user ?? data;
    const next: KugouAccount = {...existing};
    const aliases: Record<string, string[]> = {
        token: ["token", "Token"], userid: ["userid", "userId", "userid"], t1: ["t1", "T1"],
        dfid: ["dfid", "DFID"], mid: ["mid", "MID"], guid: ["guid", "GUID"],
        serverDev: ["serverDev", "server_dev"], mac: ["mac", "MAC"],
    };
    for (const [target, keys] of Object.entries(aliases)) {
        const value = valueOf(data, keys) || valueOf(nested, keys);
        if (value) next[target] = value;
    }
    return next;
}
function pagedItems(response: any): any[] {
    const data = unwrap(response);
    const items = data?.info ?? data?.songs ?? data?.list ?? data?.playlists ?? data?.data?.info ?? data?.data?.songs ?? data?.data?.list ?? data?.data ?? data;
    return Array.isArray(items) ? items : [];
}
function totalItems(response: any): number | null {
    const data = unwrap(response);
    const total = data?.list_count ?? data?.total ?? data?.total_count ?? data?.count ?? data?.data?.list_count ?? data?.data?.total ?? data?.data?.count;
    const parsed = Number(total);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function playlistPageSize(instanceName: string): number {
    return Math.min(Math.max(Number(getConfig(instanceName).playlistPageSize) || 30, 1), 100);
}

export function getAccountStatus(instanceName = "default") {
    const account = getConfig(instanceName).account;
    return {authenticated: Boolean(account.token), userid: account.userid || null};
}
export function logout(instanceName = "default"): void {
    updateAccount(instanceName, {});
    const refreshTimer = refreshTimers.get(instanceName);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimers.delete(instanceName);
    for (const [sessionId, session] of loginSessions) {
        if (session.instanceName === instanceName) loginSessions.delete(sessionId);
    }

    const data = runtimeData();
    if (data.playlists) delete data.playlists[instanceName];
    if (data.user) delete data.user[instanceName];
    if (data.vip) delete data.vip[instanceName];
    if (data.tracks) for (const key of Object.keys(data.tracks)) if (key.startsWith(`${instanceName}:`)) delete data.tracks[key];
    if (data.tracksSyncedAt) for (const key of Object.keys(data.tracksSyncedAt)) if (key.startsWith(`${instanceName}:`)) delete data.tracksSyncedAt[key];
    writeJson(dataPath, data);
}
export function isKugouConfigPath(filePath: string): boolean { return path.resolve(filePath) === path.resolve(configPath); }
export function buildAuthorization(account: KugouAccount): string {
    return Object.entries(authorizationNames).filter(([key]) => account[key]).map(([key, headerName]) => `${headerName}=${account[key]}`).join(";");
}
export async function gateway(instanceName: string, endpoint: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<any> {
    const config = getConfig(instanceName);
    const base = config.kugouApi?.replace(/\/+$/, "") || "http://127.0.0.1:3000";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = new Headers(init.headers);
        const authorization = buildAuthorization(config.account);
        if (authorization) headers.set("Authorization", authorization);
        headers.set("Cache-Control", "no-cache");
        headers.set("Pragma", "no-cache");
        const response = await fetch(`${base}/${endpoint.replace(/^\/+/, "")}`, {...init, headers, signal: controller.signal});
        const text = await response.text();
        let payload: any;
        try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`酷狗网关 ${endpoint.split("?")[0]} 返回无效 JSON (HTTP ${response.status})`); }
        if (!response.ok) {
            const message = typeof payload?.message === "string" && payload.message.trim() ? `: ${payload.message.trim()}` : "";
            throw new Error(`酷狗网关 ${endpoint.split("?")[0]} 请求失败 (HTTP ${response.status})${message}`);
        }
        if (Number(payload?.status) === 2) {
            updateAccount(instanceName, {});
            throw new Error("酷狗登录已失效，请重新扫码登录");
        }
        return payload;
    } finally { clearTimeout(timer); }
}
export async function startQrLogin(instanceName: string): Promise<{sessionId: string; qr: string}> {
    const keyResponse = unwrap(await gateway(instanceName, "login/qr/key"));
    const key = valueOf(keyResponse, ["key", "qrkey", "qrcode_key", "qrcode"]);
    if (!key) throw new Error("网关未返回二维码登录密钥");
    // This gateway already returns a ready-to-display data URL with the login key.
    let qr = valueOf(keyResponse, ["qrcode_img", "qrurl", "qr", "url", "image"]);
    if (!qr) {
        const qrResponse = unwrap(await gateway(instanceName, `login/qr/create?key=${encodeURIComponent(key)}`));
        qr = valueOf(qrResponse, ["base64", "qrurl", "qr", "url", "qrcode", "image"]);
    }
    if (!qr) throw new Error("网关未返回二维码内容");
    const sessionId = randomUUID();
    loginSessions.set(sessionId, {id: sessionId, instanceName, key, createdAt: Date.now()});
    return {sessionId, qr};
}
export async function pollQrLogin(instanceName: string, sessionId: string): Promise<{state: "waiting" | "confirmed" | "expired"; account?: ReturnType<typeof getAccountStatus>}> {
    const session = loginSessions.get(sessionId);
    if (!session || session.instanceName !== instanceName || Date.now() - session.createdAt > 5 * 60_000) {
        loginSessions.delete(sessionId);
        return {state: "expired"};
    }
    const payload = await gateway(instanceName, `login/qr/check?key=${encodeURIComponent(session.key)}&timestamp=${Date.now()}`);
    const data = unwrap(payload);
    const status = Number(data?.status ?? payload?.status);
    if (status === 2 || /expire|expired/i.test(String(data?.message ?? ""))) {
        loginSessions.delete(sessionId);
        return {state: "expired"};
    }
    const account = extractAccount(data, getConfig(instanceName).account);
    if (account.token) {
        updateAccount(instanceName, account);
        await syncAccountInfo(instanceName);
        startKugouService();
        loginSessions.delete(sessionId);
        return {state: "confirmed", account: getAccountStatus(instanceName)};
    }
    return {state: "waiting"};
}
export async function refreshToken(instanceName = "default"): Promise<void> {
    const config = getConfig(instanceName);
    if (!config.account.token) return;
    const response = await gateway(instanceName, "login/token");
    const account = extractAccount(response, config.account);
    if (!account.token) throw new Error("网关未返回刷新后的 Token");
    updateAccount(instanceName, account);
    await syncAccountInfo(instanceName);
}
export function startKugouService(): void {
    for (const timer of refreshTimers.values()) clearInterval(timer);
    refreshTimers.clear();
    for (const instance of configDocument().configs ?? []) {
        if (!instance?.name || !instance.account?.token) continue;
        const hours = Math.min(Math.max(Number(instance.tokenRefreshHours) || 12, 1), 24 * 30);
        const refresh = () => void refreshToken(instance.name).catch(error => console.error(`[kugou] 刷新 ${instance.name} Token 失败:`, error));
        refresh();
        refreshTimers.set(instance.name, setInterval(refresh, hours * 60 * 60 * 1000));
    }
}
export function stopKugouService(): void {
    for (const timer of refreshTimers.values()) clearInterval(timer);
    refreshTimers.clear();
}
function runtimeData(): RuntimeData { return readJson<RuntimeData>(dataPath, {}); }
export async function syncAccountInfo(instanceName = "default"): Promise<{user: any; vip: any}> {
    if (!getConfig(instanceName).account.token) throw new Error("请先完成酷狗登录");
    const [user, vip] = await Promise.all([gateway(instanceName, "user/detail"), gateway(instanceName, "user/vip/detail")]);
    const data = runtimeData();
    data.user = {...data.user, [instanceName]: unwrap(user)};
    data.vip = {...data.vip, [instanceName]: unwrap(vip)};
    writeJson(dataPath, data);
    return {user: unwrap(user), vip: unwrap(vip)};
}
export function kugouCacheSummary(instanceName = "default") {
    const data = runtimeData();
    const playlistList = Array.isArray(data.playlists?.[instanceName]) ? data.playlists![instanceName] as any[] : [];
    const tracks = data.tracks ?? {};
    return {
        user: data.user?.[instanceName] ?? null,
        vip: data.vip?.[instanceName] ?? null,
        playlists: playlistList.map(item => { const id = String(item?.global_collection_id ?? item?.specialid ?? item?.id ?? item?.playlistId ?? ""); const syncedTracks = tracks[`${instanceName}:${id}`]; return {id, name: String(item?.specialname ?? item?.name ?? item?.playlistName ?? "未命名歌单"), cover: String(item?.imgurl ?? item?.pic ?? item?.cover ?? "").replace("{size}", "150"), trackCount: Array.isArray(syncedTracks) ? syncedTracks.length : Number(item?.count ?? item?.m_count) || 0, syncedAt: data.tracksSyncedAt?.[`${instanceName}:${id}`] ?? null}; }).filter(item => item.id),
        playlistsSyncedAt: data.playlistsSyncedAt ?? null,
    };
}
export function navbarPlaylist(instanceName = "default") {
    const config = getConfig(instanceName);
    const playlistId = String(config.navbarPlaylistId ?? "");
    if (!playlistId) return null;
    const data = runtimeData();
    const playlist = Array.isArray(data.playlists?.[instanceName])
        ? (data.playlists![instanceName] as any[]).find(item => String(item?.global_collection_id ?? item?.specialid ?? item?.id ?? item?.playlistId ?? "") === playlistId)
        : null;
    const tracks = data.tracks?.[`${instanceName}:${playlistId}`];
    if (!playlist || !Array.isArray(tracks) || !tracks.length) return null;
    return {
        id: playlistId,
        name: String(playlist?.name ?? playlist?.specialname ?? playlist?.playlistName ?? "导航歌单"),
        cover: String(playlist?.pic ?? playlist?.imgurl ?? playlist?.cover ?? "").replace("{size}", "150"),
        tracks,
    };
}
export function navbarPlaylistTrack(instanceName: string, hash: string): any | null {
    const playlist = navbarPlaylist(instanceName);
    const normalizedHash = hash.toLowerCase();
    return playlist?.tracks.find((track: any) => String(track?.hash ?? track?.filehash ?? track?.FileHash ?? track?.Hash ?? "").toLowerCase() === normalizedHash) ?? null;
}
export function isNavbarPlaylistTrack(instanceName: string, hash: string): boolean {
    return Boolean(navbarPlaylistTrack(instanceName, hash));
}
export function cachedPlaylistTracks(instanceName: string, playlistId: string): any[] {
    return runtimeData().tracks?.[`${instanceName}:${playlistId}`] ?? [];
}
export async function playlists(instanceName = "default"): Promise<any[]> {
    if (!getConfig(instanceName).account.token) throw new Error("请先完成酷狗登录");
    const pageSize = playlistPageSize(instanceName);
    const all: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 100; page++) {
        const response = await gateway(instanceName, `user/playlist?page=${page}&pagesize=${pageSize}`);
        const items = pagedItems(response);
        if (!items.length) break;
        let added = 0;
        for (const item of items) {
            const id = String(item?.global_collection_id ?? item?.specialid ?? item?.id ?? item?.playlistId ?? "");
            const key = id || JSON.stringify(item);
            if (seen.has(key)) continue;
            seen.add(key);
            all.push(item);
            added++;
        }
        const total = totalItems(response);
        if (all.length >= (total ?? Number.POSITIVE_INFINITY) || items.length < pageSize || added === 0) break;
    }
    return all;
}
export async function syncPlaylists(instanceName = "default"): Promise<any[]> {
    if (!getConfig(instanceName).account.token) throw new Error("请先完成酷狗登录");
    const items = await playlists(instanceName);
    const data = runtimeData();
    data.playlists = {...data.playlists, [instanceName]: items};
    data.playlistsSyncedAt = new Date().toISOString();
    writeJson(dataPath, data);
    return items;
}
export async function playlistTracks(instanceName: string, playlistId: string): Promise<any[]> {
    if (!/^[\w-]{1,128}$/.test(playlistId)) throw new Error("歌单 ID 无效");
    const pageSize = playlistPageSize(instanceName);
    const all: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 100; page++) {
        const response = await gateway(instanceName, `playlist/track/all?id=${encodeURIComponent(playlistId)}&page=${page}&pagesize=${pageSize}`, {}, 60_000);
        const items = pagedItems(response);
        if (!items.length) break;
        let added = 0;
        for (const item of items) {
            const key = String(item?.hash ?? item?.filehash ?? item?.audio_id ?? item?.songid ?? "") || JSON.stringify(item);
            if (seen.has(key)) continue;
            seen.add(key);
            all.push(item);
            added++;
        }
        const total = totalItems(response);
        if (all.length >= (total ?? Number.POSITIVE_INFINITY) || items.length < pageSize || added === 0) break;
    }
    const data = runtimeData();
    const key = `${instanceName}:${playlistId}`;
    data.tracks = {...data.tracks, [key]: all};
    data.tracksSyncedAt = {...data.tracksSyncedAt, [key]: new Date().toISOString()};
    writeJson(dataPath, data);
    return all;
}
export async function searchSongs(instanceName: string, keywords: string): Promise<any[]> {
    if (!keywords.trim()) throw new Error("搜索关键词不能为空");
    const response = unwrap(await gateway(instanceName, `search?keywords=${encodeURIComponent(keywords.trim())}`));
    const items = response?.lists ?? response?.list ?? response?.songs ?? [];
    return Array.isArray(items) ? items : [];
}
export async function songUrl(instanceName: string, hash: string, qualities: string[]): Promise<{url: string; quality: string}> {
    if (!/^[a-f\d]{16,64}$/i.test(hash)) throw new Error("歌曲 hash 无效");
    for (const quality of qualities) {
        const response = unwrap(await gateway(instanceName, `song/url?hash=${encodeURIComponent(hash)}&quality=${encodeURIComponent(quality)}`));
        const url = valuesOf(response, ["url", "backupUrl", "play_url", "playUrl"])[0] ?? "";
        if (url) return {url, quality};
    }
    throw new Error("未获取到可播放的歌曲地址");
}
export async function lyrics(instanceName: string, hash: string): Promise<string | null> {
    if (!/^[a-f\d]{16,64}$/i.test(hash)) throw new Error("歌曲 hash 无效");
    const file = path.join(cacheRoot, hash.toLowerCase(), "lyrics.json");
    const cached = readJson<any>(file, null);
    if (typeof cached === "string") return cached;
    if (cached && Object.prototype.hasOwnProperty.call(cached, "decodeContent")) {
        return typeof cached.decodeContent === "string" && cached.decodeContent ? cached.decodeContent : null;
    }
    const search = unwrap(await gateway(instanceName, `search/lyric?hash=${encodeURIComponent(hash)}`));
    const first = search?.candidates?.[0] ?? search?.list?.[0] ?? search?.[0];
    const id = valueOf(first, ["id", "lyricid"]); const accesskey = valueOf(first, ["accesskey", "accessKey"]);
    if (!id || !accesskey) {
        writeJson(file, {decodeContent: null});
        return null;
    }
    const result = unwrap(await gateway(instanceName, `lyric?id=${encodeURIComponent(id)}&accesskey=${encodeURIComponent(accesskey)}&fmt=krc&decode=true`));
    const decodeContent = valueOf(result, ["decodeContent"]);
    writeJson(file, {decodeContent: decodeContent || null});
    return decodeContent || null;
}
export async function mvInfo(instanceName: string, hash: string): Promise<KugouMvInfo> {
    if (!/^[a-f\d]{16,64}$/i.test(hash)) throw new Error("MV hash 无效");
    const response = unwrap(await gateway(instanceName, `video/url?hash=${encodeURIComponent(hash)}`));
    const normalizedHash = hash.toLowerCase();
    const mvData = response?.[normalizedHash] ?? response?.[hash] ?? response?.data?.[normalizedHash] ?? response?.data?.[hash];
    if (!mvData || typeof mvData !== "object") throw new Error("未找到 MV");
    const normalizeMvUrl = (url: string) => url.startsWith("//") ? `http:${url}` : url.replace(/^https:\/\//i, "http://");
    const downurls = valuesOf(mvData, ["downurl", "url", "play_url", "playUrl"]).map(normalizeMvUrl);
    const backupdownurls = valuesOf(mvData, ["backupdownurl", "backupDownUrl", "backup_url", "backupUrl"]).map(normalizeMvUrl);
    if (!downurls.length) throw new Error("未找到可播放的 MV 地址");
    const filesize = Number(mvData.filesize);
    return {
        mvhash: hash,
        downurl: downurls[0],
        backupdownurl: [...new Set([...downurls.slice(1), ...backupdownurls])],
        filesize: Number.isFinite(filesize) && filesize > 0 ? filesize : null,
    };
}
export async function mvUrl(instanceName: string, hash: string): Promise<string> {
    return (await mvInfo(instanceName, hash)).downurl;
}
export function cachedFile(hash: string, quality: string): string | null {
    if (!/^[a-f\d]{16,64}$/i.test(hash) || !/^(128|high|320|flac)$/.test(quality)) return null;
    const file = path.join(cacheRoot, hash.toLowerCase(), `${quality}.mp3`);
    return fs.existsSync(file) ? file : null;
}
export async function cachedSongFile(instanceName: string, hash: string, qualities: string[]): Promise<{file: string; quality: string}> {
    if (!/^[a-f\d]{16,64}$/i.test(hash)) throw new Error("歌曲 hash 无效");
    for (const quality of qualities) {
        if (!/^(128|high|320|flac)$/.test(quality)) continue;
        const file = cachedFile(hash, quality);
        if (file) return {file, quality};
    }
    let playable: {url: string; quality: string; urls: string[]} | null = null;
    for (const quality of qualities) {
        const response = unwrap(await gateway(instanceName, `song/url?hash=${encodeURIComponent(hash)}&quality=${encodeURIComponent(quality)}`));
        const urls = valuesOf(response, ["url", "backupUrl", "play_url", "playUrl"]);
        if (urls.length) { playable = {url: urls[0], quality, urls}; break; }
    }
    if (!playable) throw new Error("未获取到可播放的歌曲地址");
    const key = `${hash.toLowerCase()}:${playable.quality}`;
    let download = mediaDownloads.get(key);
    if (!download) {
        const target = path.join(cacheRoot, hash.toLowerCase(), `${playable.quality}.mp3`);
        download = (async () => {
            fs.mkdirSync(path.dirname(target), {recursive: true});
            const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
            try {
                let lastStatus = 0;
                for (const url of playable.urls) {
                    const response = await fetch(url, {headers: {"User-Agent": "Mozilla/5.0", "Referer": "https://www.kugou.com/"}});
                    lastStatus = response.status;
                    if (!response.ok || !response.body) continue;
                    await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(temporary));
                    fs.renameSync(temporary, target);
                    return target;
                }
                throw new Error(`下载歌曲缓存失败: ${lastStatus}`);
            } catch (error) {
                fs.rmSync(temporary, {force: true});
                throw error;
            } finally { mediaDownloads.delete(key); }
        })();
        mediaDownloads.set(key, download);
    }
    return {file: await download, quality: playable.quality};
}
export function clearMediaCache(): {files: number; bytes: number} {
    let files = 0;
    let bytes = 0;
    const visit = (directory: string) => {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(entryPath);
            else { files++; bytes += fs.statSync(entryPath).size; }
        }
    };
    visit(cacheRoot);
    fs.rmSync(cacheRoot, {recursive: true, force: true});
    return {files, bytes};
}
