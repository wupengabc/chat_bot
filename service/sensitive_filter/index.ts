import fs from "node:fs";
import path from "node:path";
import {get_storage} from "../../storage/index.js";
import {path_utils} from "../../utils/path_utils.js";

export interface SensitiveActor {
    /** QQ/CQ sender ID. This is resolved through chat_permission_storage. */
    user_id?: string | number | null;
    /** Authenticated game account name for web and server-side callers. */
    game_id?: string | null;
    username?: string | null;
}

export interface GameIdentity {
    game_id: string;
    role: string;
    owner: boolean;
}

export interface TextCheckResult {
    blocked: boolean;
    bypassed: boolean;
    match_count: number;
}

export interface StreamFilter {
    push(chunk: string): string;
    finish(): string;
}

export const SENSITIVE_INPUT_MESSAGE = "该消息包含敏感内容，无法处理。";

interface SensitiveConfig {
    enabled?: boolean;
    sensitive_words?: unknown;
}

interface NormalizedText {
    value: string;
    starts: number[];
    ends: number[];
}

interface BlockedWord {
    word: string;
    reversed: boolean;
}

/** Scripts and directional-control characters that actually render right-to-left. */
const RTL_INDICATOR_PATTERN = /[\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/u;

const CONFIG_PATH = path.join(path_utils.get_project_root_path(), "service", "sensitive_filter", "config.json");
const FILTERABLE_KEYS = new Set([
    "text", "content", "prompt", "message", "query", "keyword", "comment", "description", "reason",
    "title", "caption", "summary", "label", "display", "question", "answer", "value",
]);
const EXCLUDED_KEYS = /^(?:url|uri|href|link|file|path|id|ids|uuid|qq|key|user_id|userId|sender_id|senderId|group_id|groupId|channel_id|channelId|conversation_id|conversationId|message_id|messageId|run_id|runId|slug|public_slug|token|secret|password|passwd|apikey|api_key|authorization|cookie|base64|binary|hash|signature|source_url|sources|urls|links|username|owner_username|game_id|gameId|player_name|playerName|sensitive_words)$/i;
const EXCLUDED_KEY_PARTS = /token|secret|password|passwd|apikey|api_key|authorization|cookie|credential|(?:^|[_-])(pw|base64|binary|hash|signature|ids?)(?:$|[_-])|(?:^|[_-])(url|uri|href|link)(?:$|[_-])/i;
const SEPARATOR_PATTERN = /[^\p{L}\p{N}\p{M}]/u;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>{}"'`]+/gi;

let config: Required<Pick<SensitiveConfig, "enabled">> & {sensitive_words: string[]} = {
    enabled: true,
    sensitive_words: [],
};
let blockedWords: BlockedWord[] = [];
let maxBlockedWordLength = 0;

function readConfig(): SensitiveConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as SensitiveConfig;
    } catch {
        return {};
    }
}

function normalizeConfig(source: SensitiveConfig): typeof config {
    const words = Array.isArray(source.sensitive_words)
        ? [...new Set(source.sensitive_words.filter((word): word is string => typeof word === "string").map(word => word.trim()).filter(Boolean))]
        : [];
    return {
        enabled: source.enabled !== false,
        sensitive_words: words,
    };
}

function normalizeText(value: string): NormalizedText {
    let normalized = "";
    const starts: number[] = [];
    const ends: number[] = [];

    for (let offset = 0; offset < value.length;) {
        const codePoint = value.codePointAt(offset);
        if (codePoint === undefined) break;
        const end = offset + (codePoint > 0xffff ? 2 : 1);
        const sourceCharacter = value.slice(offset, end);
        const transformed = sourceCharacter.normalize("NFKC").toLocaleLowerCase();
        for (const character of transformed) {
            if (SEPARATOR_PATTERN.test(character)) continue;
            normalized += character;
            starts.push(offset);
            ends.push(end);
        }
        offset = end;
    }

    return {value: normalized, starts, ends};
}

function rebuildWordList(): void {
    const words = config.sensitive_words
        .map(word => normalizeText(word).value)
        .filter(Boolean);
    // Text intended for right-to-left display is often submitted in reverse
    // character order. Treat that direct reversal as the same blocked word — but
    // only when the message actually carries RTL rendering clues, otherwise a
    // plain command like "/pw" would hit the reversed English word "pw".
    const actualWords = new Set(words);
    const entries = new Map<string, BlockedWord>();
    for (const word of words) {
        const reversed = [...word].reverse().join("");
        if (!entries.has(word)) entries.set(word, {word, reversed: false});
        if (reversed !== word && !entries.has(reversed)) entries.set(reversed, {word: reversed, reversed: !actualWords.has(reversed)});
    }
    blockedWords = [...entries.values()].sort((left, right) => right.word.length - left.word.length);
    maxBlockedWordLength = blockedWords.reduce((max, entry) => Math.max(max, entry.word.length), 0);
}

function findRanges(value: string): Array<{start: number; end: number}> {
    if (!config.enabled || !blockedWords.length || !value) return [];
    const normalized = normalizeText(value);
    const ranges: Array<{start: number; end: number}> = [];
    for (const entry of blockedWords) {
        if (entry.reversed && !RTL_INDICATOR_PATTERN.test(value)) continue;
        let offset = normalized.value.indexOf(entry.word);
        while (offset >= 0) {
            const endIndex = offset + entry.word.length - 1;
            if (normalized.starts[offset] !== undefined && normalized.ends[endIndex] !== undefined) {
                ranges.push({start: normalized.starts[offset], end: normalized.ends[endIndex]});
            }
            offset = normalized.value.indexOf(entry.word, offset + Math.max(1, entry.word.length));
        }
    }
    return ranges;
}

function mergeRanges(ranges: Array<{start: number; end: number}>): Array<{start: number; end: number}> {
    if (ranges.length < 2) return ranges;
    const sorted = [...ranges].sort((left, right) => left.start - right.start || right.end - left.end);
    const merged: Array<{start: number; end: number}> = [];
    for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && range.start < previous.end) {
            previous.end = Math.max(previous.end, range.end);
        } else {
            merged.push({...range});
        }
    }
    return merged;
}

function textValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function getStorageMethod(storageName: string, methodName: string): ((...args: any[]) => any) | null {
    const storage = get_storage(storageName) as Record<string, any> | undefined;
    const method = storage?.[methodName];
    return typeof method === "function" ? method.bind(storage) : null;
}

/** Resolve a current game account. The QQ sender role and JWT role are intentionally ignored. */
export function resolve_game_identity(actor?: SensitiveActor | null): GameIdentity | null {
    const userId = actor?.user_id === undefined || actor?.user_id === null ? "" : String(actor.user_id).trim();
    let gameId = "";
    if (userId) {
        const permission = getStorageMethod("chat_permission_storage", "find_user_info")
            || getStorageMethod("chat_permission_storage", "get_user_info");
        const bound = permission?.(userId);
        gameId = textValue(bound?.game_id).trim();
    } else {
        gameId = textValue(actor?.game_id || actor?.username).trim();
    }
    if (!gameId) return null;

    const getUserInfo = getStorageMethod("bangxi_server_storage", "get_user_info");
    const player = getUserInfo?.(gameId);
    if (!player) return {game_id: gameId, role: "member", owner: false};
    const role = typeof player.role === "string" ? player.role : "member";
    return {game_id: textValue(player.username).trim() || gameId, role, owner: role === "owner"};
}

export function is_owner(actor?: SensitiveActor | null): boolean {
    return resolve_game_identity(actor)?.owner === true;
}

export function check_text(value: unknown, actor?: SensitiveActor | null): TextCheckResult {
    const text = textValue(value);
    const bypassed = is_owner(actor);
    if (!text || bypassed) return {blocked: false, bypassed, match_count: 0};
    const ranges = findRanges(text);
    return {blocked: ranges.length > 0, bypassed: false, match_count: ranges.length};
}

export function filter_text(value: string, actor?: SensitiveActor | null): string {
    if (!value || is_owner(actor)) return value;
    const ranges = mergeRanges(findRanges(value));
    if (!ranges.length) return value;
    const urlRanges = [...value.matchAll(HTTP_URL_PATTERN)].flatMap(match => match.index === undefined ? [] : [{start: match.index, end: match.index + match[0].length}]);
    const redactRanges = ranges.filter(range => !urlRanges.some(url => range.start < url.end && range.end > url.start));
    if (!redactRanges.length) return value;
    let result = "";
    let offset = 0;
    for (const range of redactRanges) {
        result += value.slice(offset, range.start);
        result += "***";
        offset = range.end;
    }
    return result + value.slice(offset);
}

function isBinaryValue(value: unknown): boolean {
    return Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function shouldFilterKey(key: string | undefined): boolean {
    if (key === undefined) return true;
    if (EXCLUDED_KEYS.test(key) || EXCLUDED_KEY_PARTS.test(key)) return false;
    const normalized = key.toLowerCase();
    if (["type", "role", "event", "method", "status", "action", "token_type"].includes(normalized)) return false;
    return FILTERABLE_KEYS.has(normalized) || true;
}

function filterValue(value: unknown, actor: SensitiveActor | null | undefined, key?: string, segmentType?: string): unknown {
    if (typeof value === "string") {
        if (["image", "record", "video", "file"].includes(segmentType || "") && key === "name") {
            return filter_text(value, actor);
        }
        return shouldFilterKey(key) ? filter_text(value, actor) : value;
    }
    if (Array.isArray(value)) return value.map(item => filterValue(item, actor, key, segmentType));
    if (!value || typeof value !== "object" || isBinaryValue(value)) return value;

    const object = value as Record<string, unknown>;
    const type = typeof object.type === "string" ? object.type : segmentType;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(object)) {
        if (["image", "record", "video", "file"].includes(type || "") && childKey === "name" && typeof childValue === "string") {
            result[childKey] = filter_text(childValue, actor);
        } else {
            result[childKey] = filterValue(childValue, actor, childKey, type);
        }
    }
    return result;
}

export function filter_segments<T>(value: T, actor?: SensitiveActor | null): T {
    return filterValue(value, actor) as T;
}

export function filter_json<T>(value: T, actor?: SensitiveActor | null): T {
    if (typeof value === "string") return filter_text(value, actor) as T;
    return filterValue(value, actor) as T;
}

export function contains_sensitive_segments(value: unknown, actor?: SensitiveActor | null): boolean {
    return containsSensitiveValue(value, actor);
}

function containsSensitiveValue(value: unknown, actor: SensitiveActor | null | undefined, key?: string, segmentType?: string): boolean {
    if (typeof value === "string") {
        if (!(key === undefined || (segmentType && ["image", "record", "video", "file"].includes(segmentType) && key === "name") || shouldFilterKey(key))) return false;
        return check_text(value, actor).blocked;
    }
    if (Array.isArray(value)) return value.some(item => containsSensitiveValue(item, actor, key, segmentType));
    if (!value || typeof value !== "object" || isBinaryValue(value)) return false;
    const object = value as Record<string, unknown>;
    const type = typeof object.type === "string" ? object.type : undefined;
    return Object.entries(object).some(([key, child]) => {
        return containsSensitiveValue(child, actor, key, type);
    });
}

export function is_sensitive_chat_message(message: {raw_message?: unknown; message?: unknown; sender?: SensitiveActor}): boolean {
    const actor = message.sender;
    return check_text(message.raw_message, actor).blocked || contains_sensitive_segments(message.message, actor);
}

export function get_chat_actor(event: any): SensitiveActor | null {
    const sender = event?.sender;
    if (sender?.user_id !== undefined && sender?.user_id !== null) return sender as SensitiveActor;
    if (event?.user_id !== undefined && event?.user_id !== null) return {user_id: event.user_id};
    return null;
}

/**
 * Buffer a text stream so a later sensitive match cannot leak an earlier prefix.
 * push() 实时放行已通过检查的前缀，仅保留可能构成敏感词后缀的尾部缓冲；
 * finish() 过滤并放行剩余缓冲。这样既能流式输出，又不会泄露跨 chunk 的敏感词。
 */
export function create_stream_filter(actor?: SensitiveActor | null): StreamFilter {
    let pending = "";
    function safePrefixLength(value: string): number {
        if (!config.enabled || !blockedWords.length || is_owner(actor)) return value.length;
        const normalized = normalizeText(value);
        let protectedStart = normalized.value.length;
        for (const entry of blockedWords) {
            for (let length = Math.min(entry.word.length, normalized.value.length); length > 0; length -= 1) {
                if (!entry.word.startsWith(normalized.value.slice(-length))) continue;
                protectedStart = Math.min(protectedStart, normalized.starts[normalized.value.length - length] ?? value.length);
                break;
            }
        }
        return protectedStart;
    }
    return {
        push(chunk: string): string {
            pending += chunk;
            const safeLength = safePrefixLength(pending);
            if (safeLength <= 0) return "";
            const filtered = filter_text(pending.slice(0, safeLength), actor);
            pending = pending.slice(safeLength);
            return filtered;
        },
        finish(): string {
            const result = filter_text(pending, actor);
            pending = "";
            return result;
        },
    };
}

export function get_config_snapshot(): {enabled: boolean; sensitive_words: string[]; count: number} {
    return {
        enabled: config.enabled,
        sensitive_words: [...config.sensitive_words],
        count: config.sensitive_words.length,
    };
}

export function reload(source?: SensitiveConfig): void {
    config = normalizeConfig(source || readConfig());
    rebuildWordList();
}

reload();
