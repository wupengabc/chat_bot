import type {Express, Request, Response} from "express";
import {verify_resource_token} from "../../user/auth/index.js";
import {cachedSongFile, getConfig, isNavbarPlaylistTrack, lyrics, mvInfo, navbarPlaylist, navbarPlaylistTrack, playlists} from "../../../../kugou/kugou.js";

function requireMember(request: Request, response: Response): boolean {
    if (verify_resource_token(request)) return true;
    response.status(401).json({success: false, message: "资源令牌无效或已过期"});
    return false;
}
function hash(value: unknown): string | null {
    return typeof value === "string" && /^[a-f\d]{16,64}$/i.test(value) ? value : null;
}
function requireNavbarPlaylistTrack(songHash: string | null, response: Response): songHash is string {
    if (!songHash) {
        response.status(400).json({success: false, message: "歌曲 hash 无效"});
        return false;
    }
    if (songHash && isNavbarPlaylistTrack("default", songHash)) return true;
    response.status(404).json({success: false, message: "歌曲不在选中歌单中"});
    return false;
}

export async function init(app: Express) {
    app.get("/api/music/navbar-playlist", (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const playlist = navbarPlaylist();
        if (!playlist) {
            response.status(404).json({success: false, message: "导航播放器尚未配置已同步歌单"});
            return;
        }
        const pageSize = Math.min(50, Math.max(10, Math.floor(Number(request.query.limit) || 30)));
        const total = playlist.tracks.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(totalPages, Math.max(1, Math.floor(Number(request.query.page) || 1)));
        response.json({success: true, playlist: {id: playlist.id, name: playlist.name, cover: playlist.cover, auto_play: Boolean(getConfig().autoPlay), auto_picture_in_picture: Boolean(getConfig().autoPictureInPicture)}, tracks: playlist.tracks.slice((page - 1) * pageSize, page * pageSize), pagination: {page, page_size: pageSize, total, total_pages: totalPages, has_previous: page > 1, has_next: page < totalPages}});
    });
    app.get("/api/music/navbar-playlist/songs/:hash/play-url", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const playlist = navbarPlaylist();
        const songHash = hash(request.params.hash);
        if (!playlist || !songHash || !isNavbarPlaylistTrack("default", songHash)) {
            response.status(404).json({success: false, message: "歌曲不在导航播放器歌单中"});
            return;
        }
        try {
            const cached = await cachedSongFile("default", songHash, ["128", "high", "320", "flac"]);
            response.json({success: true, url: `/api/music/navbar-playlist/songs/${encodeURIComponent(songHash)}/audio?quality=${cached.quality}`, quality: cached.quality});
        }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "获取播放地址失败"}); }
    });
    app.get("/api/music/navbar-playlist/songs/:hash/audio", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const playlist = navbarPlaylist();
        const songHash = hash(request.params.hash);
        const quality = typeof request.query.quality === "string" && /^(128|high|320|flac)$/.test(request.query.quality) ? request.query.quality : "128";
        if (!playlist || !songHash || !isNavbarPlaylistTrack("default", songHash)) {
            response.status(404).json({success: false, message: "歌曲不在导航播放器歌单中"});
            return;
        }
        try { response.sendFile((await cachedSongFile("default", songHash, [quality])).file); }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "读取歌曲缓存失败"}); }
    });
    app.get("/api/music/navbar-playlist/songs/:hash/lyrics", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const playlist = navbarPlaylist();
        const songHash = hash(request.params.hash);
        if (!playlist || !songHash || !isNavbarPlaylistTrack("default", songHash)) {
            response.status(404).json({success: false, message: "歌曲不在导航播放器歌单中"});
            return;
        }
        try { response.json({success: true, lyrics: await lyrics("default", songHash)}); }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "获取歌词失败"}); }
    });
    app.get("/api/music/navbar-playlist/songs/:hash/mv", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const playlist = navbarPlaylist();
        const songHash = hash(request.params.hash);
        if (!playlist || !songHash || !isNavbarPlaylistTrack("default", songHash)) {
            response.status(404).json({success: false, message: "歌曲不在导航播放器歌单中"});
            return;
        }
        const track = navbarPlaylistTrack("default", songHash);
        const mvhash = String(track?.mvhash ?? track?.mvHash ?? track?.MVHash ?? "").trim();
        if (!mvhash) {
            response.json({success: true, mv: null});
            return;
        }
        try { response.json({success: true, mv: await mvInfo("default", mvhash)}); }
        catch { response.json({success: true, mv: null}); }
    });
    app.get("/api/member/music/playlists", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        try { response.json({success: true, playlists: await playlists()}); }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "获取播放列表失败"}); }
    });
    app.get("/api/member/music/playlists/:playlistId/tracks", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const playlist = navbarPlaylist();
        if (!playlist || String(request.params.playlistId) !== playlist.id) {
            response.status(404).json({success: false, message: "歌单不是当前选中歌单"});
            return;
        }
        response.json({success: true, tracks: playlist.tracks});
    });
    app.get("/api/member/music/songs/:hash/play-url", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const songHash = hash(request.params.hash);
        if (!requireNavbarPlaylistTrack(songHash, response)) return;
        try {
            const quality = typeof request.query.quality === "string" && /^(128|high|320|flac)$/.test(request.query.quality) ? request.query.quality : undefined;
            const cached = await cachedSongFile("default", songHash, quality ? [quality, "320", "flac", "high", "128"].filter((item, index, items) => items.indexOf(item) === index) : ["320", "flac", "high", "128"]);
            response.json({success: true, url: `/api/member/music/songs/${encodeURIComponent(songHash)}/audio?quality=${cached.quality}`, quality: cached.quality});
        } catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "获取播放地址失败"}); }
    });
    app.get("/api/member/music/songs/:hash/audio", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const songHash = hash(request.params.hash);
        const quality = typeof request.query.quality === "string" && /^(128|high|320|flac)$/.test(request.query.quality) ? request.query.quality : "128";
        if (!requireNavbarPlaylistTrack(songHash, response)) return;
        try { response.sendFile((await cachedSongFile("default", songHash, [quality])).file); }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "读取歌曲缓存失败"}); }
    });
    app.get("/api/member/music/songs/:hash/lyrics", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const songHash = hash(request.params.hash);
        if (!requireNavbarPlaylistTrack(songHash, response)) return;
        try { response.json({success: true, lyrics: await lyrics("default", songHash)}); }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "获取歌词失败"}); }
    });
    app.get("/api/member/music/songs/:hash/mv", async (request: Request, response: Response) => {
        if (!requireMember(request, response)) return;
        const songHash = hash(request.params.hash);
        if (!requireNavbarPlaylistTrack(songHash, response)) return;
        const track = songHash ? navbarPlaylistTrack("default", songHash) : null;
        const mvhash = String(track?.mvhash ?? track?.mvHash ?? track?.MVHash ?? "").trim();
        if (!mvhash) {
            response.json({success: true, url: null, mv: null});
            return;
        }
        try {
            const mv = await mvInfo("default", mvhash);
            response.json({success: true, url: mv.downurl, mv});
        }
        catch (error) { response.status(502).json({success: false, message: error instanceof Error ? error.message : "获取 MV 失败"}); }
    });
}
