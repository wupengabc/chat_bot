import fs from "node:fs";
import path from "node:path";
import {message as Structs} from "@snowluma/sdk";
import {running_chat_adapters, send_message} from "../../../chat_adapter/index.js";
import {get_chat_adapter_prefix, plugin_logger} from "../../index.js";
import {help} from "../../type.js";
import {path_utils} from "../../../utils/path_utils.js";

const OWNER_ONLINE_EVENT = "owner_online" as const;
const PLAYER_TRADE_INTENT_EVENT = "player_trade_intent" as const;
type SubscribableEvent = typeof OWNER_ONLINE_EVENT | typeof PLAYER_TRADE_INTENT_EVENT;

const SUBSCRIBABLE_EVENTS: ReadonlyArray<{name: SubscribableEvent; description: string}> = [{
    name: OWNER_ONLINE_EVENT,
    description: "服主上线提醒",
}, {
    name: PLAYER_TRADE_INTENT_EVENT,
    description: "玩家购买物品意图提醒",
}];

const TRADE_SINGLE_KEYWORDS = ["收", "买", "求"] as const;
const TRADE_PHRASES = [
    "求购",
    "收购",
    "有偿收",
    "高价收",
    "长期收",
    "大量收",
    "急收",
    "想买",
    "要买",
    "购买",
    "有人卖",
    "有没有卖",
    "有卖吗",
    "谁有卖",
    "谁卖",
    "收吗",
    "收不收",
    "收一个",
    "收几个",
    "收一些",
    "收点",
    "收个",
    "收一组",
    "收一盒",
    "收一车",
    "卖吗",
    "卖不卖",
] as const;
const TRADE_EXCLUSION_PHRASES = [
    "收到",
    "收到了",
    "收工",
    "收摊",
    "收拾",
    "收藏",
    "收费",
    "收徒",
    "收人",
    "收队",
    "收尾",
    "收盘",
    "求关注",
    "求点赞",
    "求带",
    "求助",
    "求婚",
    "求解",
    "求问",
    "求生",
    "求职",
    "求学",
    "买了",
    "买过",
    "买到",
    "买完",
    "买错",
    "买成",
    "买好了",
    "买到了",
    "全买",
    "都买",
    "已经买",
    "购买了",
    "购买过",
    "购买到",
    "购买完",
    "买饭",
    "买菜",
    "买票",
    "买水",
    "买药",
    "卖完",
    "卖了",
    "卖过",
    "卖到",
    "卖掉",
    "出售了",
    "出售过",
    "出售完",
    "卖萌",
    "卖惨",
    "卖关子",
    "卖力",
    "卖艺",
] as const;
const TRADE_QUANTITY_PATTERN = /(?:\d+(?:\.\d+)?|[一二两三四五六七八九十百千万]+)\s*(?:个|组|盒|车|套|块|张|本|只|颗|份|件|箱|枚|斤|吨)/;
const TRADE_PRICE_PATTERN = /(?:\d+(?:\.\d+)?\s*(?:金|金币|元)|(?:价格|价钱|单价|出价|预算|多少钱|多少金|便宜|高价|低价|好商量))/;
const TRADE_QUESTION_PATTERN = /(?:吗|么|嘛|有没有|有无|谁有|需要|想要|来点|来个|多少)/;
const TRADE_CONTEXT_NOISE_PATTERN = /(?:我|你|他|她|它|有人|有没有|有无|谁|想|要|需要|可以|能不能|吗|么|嘛|呢|啊|呀|吧|了|过|已|已经|的|在|是|都|今天|现在|暂时|一共|多少)/g;
const BUYER_SELLER_QUESTION_PATTERN = /(?:有人|有没有|谁有|有)卖([^吗么嘛?！!。]{1,24})(?:吗|么|嘛)/;
const SELLER_INTENT_PATTERNS = [
    /(?:那么|那|所以|请问)?谁(?:收|要|买)(?=[A-Za-z0-9\u3400-\u9fff])/,
    /(?:有人|有没有|有无|谁有)(?:收|要|买)(?=[A-Za-z0-9\u3400-\u9fff])/,
    /(?:^|[，。！？!?、；;])(?:我|本人|咱|这边)(?:想|要|准备|打算)?(?:卖|出售|出)(?=[A-Za-z0-9\u3400-\u9fff])/,
    /(?:^|[，。！？!?、；;])[A-Za-z0-9\u3400-\u9fff]{0,32}(?:收不收|收吗)(?:[A-Za-z0-9\u3400-\u9fff]{0,32})?(?:$|[，。！？!?、；;])/,
] as const;
const TRADE_ADVERTISEMENT_PATTERNS = [
    /(?:^|[》>])\/(?:pw|shop|warp)/,
    /(?:出售|售卖|收购)(?:各类|各种|多种|各式)?(?:物品|商品)/,
    /(?:商店|店铺|商城|商场).{0,20}(?:出售|售卖|收购)/,
    /(?:出售|售卖|收购).{0,20}(?:商店|店铺|商城|商场)/,
    /出售.{0,12}收购|收购.{0,12}出售/,
] as const;

export interface TradeIntentMatch {
    matched: boolean;
    keyword?: string;
    score: number;
}

function normalize_trade_text(value: unknown): string {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function is_excluded_trade_keyword(text: string, index: number, keyword_length: number): boolean {
    return TRADE_EXCLUSION_PHRASES.some(exclusion => {
        let start = text.indexOf(exclusion);
        while (start !== -1) {
            if (index < start + exclusion.length && start < index + keyword_length) return true;
            start = text.indexOf(exclusion, start + 1);
        }
        return false;
    });
}

function get_trade_context(text: string, index: number, keyword_length: number): string {
    const start = Math.max(0, index - 12);
    const end = Math.min(text.length, index + keyword_length + 12);
    return text.slice(start, end)
        .replace(text.slice(index, index + keyword_length), "")
        .replace(/[，。！？!?、,.；;：:（）()【】\[\]「」"“”‘’]/g, "");
}

function has_trade_object_context(context: string): boolean {
    const useful = context.replace(TRADE_CONTEXT_NOISE_PATTERN, "").match(/[A-Za-z0-9\u3400-\u9fff]/g);
    return Boolean(useful && useful.length >= 1);
}

function score_trade_context(context: string): number {
    let score = 0;
    if (has_trade_object_context(context)) score += 2;
    if (TRADE_QUANTITY_PATTERN.test(context)) score += 2;
    if (TRADE_PRICE_PATTERN.test(context)) score += 2;
    if (TRADE_QUESTION_PATTERN.test(context)) score += 1;
    return score;
}

export function detect_trade_intent(value: unknown): TradeIntentMatch {
    const text = normalize_trade_text(value);
    if (!text) return {matched: false, score: 0};
    if (TRADE_ADVERTISEMENT_PATTERNS.some(pattern => pattern.test(text))) return {matched: false, score: 0};
    if (SELLER_INTENT_PATTERNS.some(pattern => pattern.test(text))) return {matched: false, score: 0};

    const buyer_seller_question = text.match(BUYER_SELLER_QUESTION_PATTERN);
    if (buyer_seller_question && has_trade_object_context(buyer_seller_question[1].replace(/的$/, ""))) {
        return {matched: true, keyword: "有卖某物吗", score: 5};
    }

    let best_match: TradeIntentMatch = {matched: false, score: 0};
    for (const phrase of TRADE_PHRASES) {
        let index = text.indexOf(phrase);
        while (index !== -1) {
            if (!is_excluded_trade_keyword(text, index, phrase.length)) {
                const context = get_trade_context(text, index, phrase.length);
                const score = 4 + score_trade_context(context);
                if (has_trade_object_context(context) && score > best_match.score) {
                    best_match = {matched: true, keyword: phrase, score};
                }
            }
            index = text.indexOf(phrase, index + 1);
        }
    }

    for (const keyword of TRADE_SINGLE_KEYWORDS) {
        let index = text.indexOf(keyword);
        while (index !== -1) {
            if (!is_excluded_trade_keyword(text, index, keyword.length)) {
                const context = get_trade_context(text, index, keyword.length);
                const score = 1 + score_trade_context(context);
                if (has_trade_object_context(context) && score > best_match.score) {
                    best_match = {matched: score >= 3, keyword, score};
                }
            }
            index = text.indexOf(keyword, index + keyword.length);
        }
    }

    return best_match.matched ? best_match : {matched: false, score: best_match.score};
}

function is_subscribable_event(value: string | undefined): value is SubscribableEvent {
    return Boolean(value && SUBSCRIBABLE_EVENTS.some(item => item.name === value));
}

interface EventSubscription {
    event: SubscribableEvent;
    group_id: string;
    user_id: string;
    adapter?: string;
    instance_name?: string;
}

interface SubscriberRoute {
    group_id: string;
    adapter?: string;
    instance_name?: string;
    user_ids: string[];
}

interface GroupMessageData {
    adapter_platform: string;
    adapter: string;
    instance_name: string;
    receiver: {id: string | number; type: "group" | "private"};
    sender: {id: string | number; user_id: string | number};
    raw_message: string;
    origin_object: any;
}

export class init {
    public readonly adapters = ["chat_adapter", "game_adapter"];
    private readonly allowed_group_ids: Set<string>;
    private readonly server_owner_list: string[];
    private readonly config_name: string;
    private readonly config_path: string;
    private subscriptions: EventSubscription[];
    private readonly command_start = get_chat_adapter_prefix() + "event_submit";
    private owner_online_announced = false;
    private awaiting_reconnect_player_list = false;
    private trade_intent_last_notified = new Map<string, number>();
    private readonly trade_intent_cooldown_ms = 30_000;

    public help: help = {
        name: "event_submit",
        keyword: "event_submit",
        description: "订阅服务器事件（仅允许的群聊可用）",
        permission: 0,
        args: [
            {
                key: "sub",
                description: "使用 sub event_name 订阅事件",
                permission: 0,
                args: [
                    {key: OWNER_ONLINE_EVENT, description: "订阅事件 owner_online", permission: 0, args: []},
                    {key: PLAYER_TRADE_INTENT_EVENT, description: "订阅玩家买卖物品意图提醒", permission: 0, args: []},
                ],
            },
            {
                key: "unsub",
                description: "使用 unsub event_name 取消订阅",
                permission: 0,
                args: [
                    {key: OWNER_ONLINE_EVENT, description: "取消订阅事件 owner_online", permission: 0, args: []},
                    {key: PLAYER_TRADE_INTENT_EVENT, description: "取消订阅玩家买卖物品意图提醒", permission: 0, args: []},
                ],
            },
            {
                key: "status",
                description: "查看事件订阅状态；不填事件名时返回全部订阅",
                permission: 0,
                args: [
                    {key: OWNER_ONLINE_EVENT, description: "可选；查看事件 owner_online 状态", permission: 0, args: []},
                    {key: PLAYER_TRADE_INTENT_EVENT, description: "可选；查看事件 player_trade_intent 状态", permission: 0, args: []},
                ],
            },
            {
                key: "get",
                description: "获取可订阅的事件列表",
                permission: 0,
                args: [],
            },
        ],
        platform: "chat_adapter",
        is_visible: (data: any) => this.is_allowed_group_message(data),
    };

    constructor(config: any) {
        const configured_groups = Array.isArray(config.allowed_group_ids) ? config.allowed_group_ids : [];
        this.allowed_group_ids = new Set(
            configured_groups
                .filter((group_id: unknown) => typeof group_id === "string" || typeof group_id === "number")
                .map((group_id: string | number) => String(group_id))
                .filter(Boolean),
        );
        this.config_name = typeof config.name === "string" ? config.name : "default";
        this.config_path = path.join(
            path_utils.get_project_root_path(),
            "plugin/chat_adapter_plugin/event_submit/config.json",
        );
        this.server_owner_list = Array.isArray(config.server_owner_list)
            ? config.server_owner_list
                .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
                .map((name: string) => name.trim())
            : [];
        this.subscriptions = this.load_subscriptions(config.subscribers);
    }

    event_handler(event: string, data: any) {
        if (data.adapter_platform === "chat_adapter") {
            this.handle_chat_command(data as GroupMessageData);
            return;
        }

        if (data.adapter_platform === "game_adapter") {
            if (event === "login") {
                // A reconnect is only resolved after its first complete player list.
                this.awaiting_reconnect_player_list = true;
                this.trade_intent_last_notified.clear();
                return;
            }
            if (event === "disconnect" || event === "kicked") {
                // Keep the announced state: a disconnect may be caused by the owner
                // joining and should not produce a leave notification by itself.
                this.trade_intent_last_notified.clear();
                return;
            }
            if (event === "player_list") this.handle_player_list(data);
            if (event === "message") this.handle_game_message(data);
        }
    }

    on_unload() {
        this.owner_online_announced = false;
        this.awaiting_reconnect_player_list = false;
        this.trade_intent_last_notified.clear();
    }

    private is_allowed_group_message(data: any): boolean {
        const group_id = this.get_group_id(data);
        return group_id !== null && this.allowed_group_ids.has(group_id);
    }

    private handle_chat_command(data: GroupMessageData): void {
        const command = String(data.raw_message || "").trim().split(/\s+/);
        if (command[0] !== this.command_start) return;

        if (data.receiver.type !== "group") {
            this.reply(data, "event_submit 仅允许在群聊中使用，禁止私聊");
            return;
        }

        const group_id = this.get_group_id(data);
        if (group_id === null || !this.allowed_group_ids.has(group_id)) {
            this.reply(data, "当前群不在允许订阅事件的群列表中");
            return;
        }

        const action = command[1]?.toLowerCase();
        const event_name = command[2]?.toLowerCase();
        if (action === "get" && command.length === 2) {
            this.reply(data, this.format_subscribable_events());
            return;
        }
        if (action === "status" && command.length === 2) {
            const user_id = this.get_user_id(data);
            if (user_id === null) {
                this.reply(data, "无法识别当前用户，暂时不能查询订阅");
                return;
            }
            this.reply(data, this.format_user_subscriptions(group_id, user_id));
            return;
        }
        if (!["sub", "unsub", "status"].includes(action) || !is_subscribable_event(event_name)) {
            this.reply(data, `${this.command_start} get、${this.command_start} status 或 ${this.command_start} sub|unsub|status owner_online|player_trade_intent`);
            return;
        }

        const user_id = this.get_user_id(data);
        if (user_id === null) {
            this.reply(data, "无法识别当前用户，暂时不能修改订阅");
            return;
        }
        const subscribed = this.subscriptions.some(subscription =>
            subscription.event === event_name &&
            subscription.group_id === group_id &&
            subscription.user_id === user_id,
        );
        if (action === "sub") {
            if (!subscribed) {
                const next: EventSubscription[] = [...this.subscriptions, {
                    event: event_name,
                    group_id,
                    user_id,
                    adapter: data.adapter,
                    instance_name: data.instance_name,
                }];
                if (!this.save_subscriptions(next)) return;
            }
            this.reply(data, subscribed ? `你已经订阅事件 ${event_name}` : `你已订阅事件 ${event_name}`);
            return;
        }

        if (action === "unsub") {
            if (subscribed) {
                const next = this.subscriptions.filter(subscription =>
                    !(subscription.event === event_name &&
                        subscription.group_id === group_id &&
                        subscription.user_id === user_id),
                );
                if (!this.save_subscriptions(next)) return;
            }
            this.reply(data, subscribed ? `你已取消订阅事件 ${event_name}` : `你尚未订阅事件 ${event_name}`);
            return;
        }

        this.reply(data, subscribed ? `你已订阅事件 ${event_name}` : `你未订阅事件 ${event_name}`);
    }

    private handle_player_list(data: any): void {
        if (data.adapter !== "mineflayer" || data.instance_name !== "bangxi") return;

        const players = Array.isArray(data.players) ? data.players : [];
        const current_players = new Set<string>(
            players
                .map((player: any): string => String(player?.username || "").trim())
                .filter(Boolean),
        );
        const online_owners = this.server_owner_list.filter(owner_name =>
            [...current_players].some(player_name => player_name.toLowerCase() === owner_name.toLowerCase()),
        );
        if (online_owners.length > 0) {
            this.awaiting_reconnect_player_list = false;
            if (this.owner_online_announced) return;
            this.owner_online_announced = true;
            for (const route of this.get_subscriber_routes(OWNER_ONLINE_EVENT)) {
                this.send_group_message(route.group_id, route.user_ids, online_owners, route.adapter, route.instance_name);
            }
            return;
        }

        if (!this.awaiting_reconnect_player_list || !this.owner_online_announced) return;
        this.awaiting_reconnect_player_list = false;
        this.owner_online_announced = false;
        for (const route of this.get_subscriber_routes(OWNER_ONLINE_EVENT)) {
            this.send_group_text_message(route.group_id, route.user_ids, "服主已离开服务器", route.adapter, route.instance_name);
        }
    }

    private handle_game_message(data: any): void {
        if (data.adapter !== "mineflayer" || data.instance_name !== "bangxi" || data.position !== "chat") return;

        const message = data.message || {};
        const text = String(message.message || message.plainText || "").trim();
        const match = detect_trade_intent(text);
        if (!match.matched || !text) return;

        const event_player_name = String(data.player_name || "").trim();
        const parsed_player_name = String(message.username || "").trim();
        const player_name = event_player_name && event_player_name.toLowerCase() !== "unknown"
            ? event_player_name
            : parsed_player_name || "未知玩家";
        const player_key = player_name.toLowerCase();
        const now = Date.now();
        for (const [key, last_notified_at] of this.trade_intent_last_notified) {
            if (now - last_notified_at >= this.trade_intent_cooldown_ms) this.trade_intent_last_notified.delete(key);
        }
        const last_notified_at = this.trade_intent_last_notified.get(player_key);
        if (last_notified_at !== undefined && now - last_notified_at < this.trade_intent_cooldown_ms) return;

        const routes = this.get_subscriber_routes(PLAYER_TRADE_INTENT_EVENT);
        if (routes.length === 0) return;

        this.trade_intent_last_notified.set(player_key, now);
        const content = `玩家 ${player_name} 可能有购买物品意图：\n${text.slice(0, 200)}`;
        for (const route of routes) {
            this.send_group_text_message(route.group_id, route.user_ids, content, route.adapter, route.instance_name);
        }
    }

    private get_subscriber_routes(event: SubscribableEvent): SubscriberRoute[] {
        const subscribers_by_route = new Map<string, SubscriberRoute>();
        for (const subscription of this.subscriptions) {
            if (subscription.event !== event || !this.allowed_group_ids.has(subscription.group_id)) continue;
            const route_key = [subscription.group_id, subscription.adapter || "*", subscription.instance_name || "*"].join("\u0000");
            const route = subscribers_by_route.get(route_key) || {
                group_id: subscription.group_id,
                adapter: subscription.adapter,
                instance_name: subscription.instance_name,
                user_ids: [],
            };
            if (!route.user_ids.includes(subscription.user_id)) route.user_ids.push(subscription.user_id);
            subscribers_by_route.set(route_key, route);
        }
        return [...subscribers_by_route.values()];
    }

    private send_group_message(group_id: string, user_ids: string[], owners: string[], adapter_name?: string, instance_name?: string): void {
        this.send_group_text_message(group_id, user_ids, `服主 ${owners.join("、")} 已上线`, adapter_name, instance_name);
    }

    private send_group_text_message(group_id: string, user_ids: string[], text: string, adapter_name?: string, instance_name?: string): void {
        const origin_object = {message_type: "group", group_id};
        if (adapter_name) {
            const config_map = running_chat_adapters.get(adapter_name);
            if (!config_map) {
                plugin_logger("event_submit", `订阅目标适配器不存在: ${adapter_name}`, "warn");
                return;
            }
            const instance_names = instance_name ? [instance_name] : [...config_map.keys()];
            if (instance_name && !config_map.has(instance_name)) {
                plugin_logger("event_submit", `订阅目标适配器实例不存在: ${adapter_name}/${instance_name}`, "warn");
                return;
            }
            const message = this.build_group_message(user_ids, text, adapter_name);
            if (!message) return;
            for (const target_instance_name of instance_names) {
                send_message(adapter_name, target_instance_name, "group", group_id, message, origin_object);
            }
            return;
        }
        for (const [adapter_name, config_map] of running_chat_adapters) {
            for (const instance_name of config_map.keys()) {
                const message = this.build_group_message(user_ids, text, adapter_name);
                if (!message) continue;
                send_message(adapter_name, instance_name, "group", group_id, message, origin_object);
            }
        }
    }

    private build_group_message(user_ids: string[], text: string, adapter_name: string): any[] | null {
        const mention_ids = adapter_name === "napcat"
            ? user_ids
                .map(user_id => Number(user_id))
                .filter(user_id => Number.isSafeInteger(user_id))
            : user_ids.filter(user_id => user_id.trim().length > 0);
        if (mention_ids.length === 0) {
            plugin_logger("event_submit", `适配器 ${adapter_name} 没有有效的订阅用户 ID，跳过发送`, "warn");
            return null;
        }
        return [
            ...mention_ids.map(user_id => Structs.at(user_id as any)),
            Structs.text(`\n${text}`),
        ];
    }

    private reply(data: GroupMessageData, text: string): void {
        const target_id = data.receiver.type === "group" ? this.get_group_id(data) : String(data.sender.id);
        if (target_id === null) return;
        send_message(data.adapter, data.instance_name, data.receiver.type, target_id,
            [Structs.at(data.sender.user_id), Structs.text(`\n${text}`)], data.origin_object);
    }

    private get_group_id(data: any): string | null {
        if (data?.receiver?.type !== "group") return null;
        const group_id = data.origin_object?.group_id ?? data.receiver?.id ?? data.sender?.id;
        return group_id === undefined || group_id === null ? null : String(group_id);
    }

    private get_user_id(data: GroupMessageData): string | null {
        const user_id = data.sender?.user_id;
        if (user_id === undefined || user_id === null || String(user_id).trim() === "") return null;
        return String(user_id);
    }

    private format_subscribable_events(): string {
        return `可订阅事件：\n${SUBSCRIBABLE_EVENTS.map(item => [
            `- ${item.name}：${item.description}`,
            `  订阅：${this.command_start} sub ${item.name}`,
            `  取消：${this.command_start} unsub ${item.name}`,
        ].join("\n")).join("\n")}`;
    }

    private format_user_subscriptions(group_id: string, user_id: string): string {
        const subscribed_events = [...new Set(
            this.subscriptions
                .filter(subscription => subscription.group_id === group_id && subscription.user_id === user_id)
                .map(subscription => subscription.event),
        )];
        if (subscribed_events.length === 0) return "你当前没有订阅任何事件";
        return `你当前已订阅事件：\n${subscribed_events.map(event => `- ${event}`).join("\n")}`;
    }

    private load_subscriptions(value: unknown): EventSubscription[] {
        if (!Array.isArray(value)) return [];
        return value.flatMap((item: any): EventSubscription[] => {
            if (!item || typeof item !== "object") return [];
            const event = String(item.event || "").trim();
            const group_id = String(item.group_id ?? "").trim();
            const user_id = String(item.user_id ?? "").trim();
            const normalized_event = event === "server_owner_online" ? OWNER_ONLINE_EVENT : event;
            if (!is_subscribable_event(normalized_event) || !group_id || !user_id) return [];
            return [{
                event: normalized_event,
                group_id,
                user_id,
                adapter: typeof item.adapter === "string" ? item.adapter.trim() || undefined : undefined,
                instance_name: typeof item.instance_name === "string" ? item.instance_name.trim() || undefined : undefined,
            }];
        });
    }

    private save_subscriptions(next: EventSubscription[]): boolean {
        try {
            const content = JSON.parse(fs.readFileSync(this.config_path, "utf8"));
            if (!Array.isArray(content.configs)) throw new Error("event_submit 配置实例格式无效");
            const index = content.configs.findIndex((item: any) => item?.name === this.config_name);
            if (index < 0) throw new Error(`未找到配置实例 ${this.config_name}`);
            content.configs[index] = {...content.configs[index], subscribers: next};
            const temporary = `${this.config_path}.tmp-${process.pid}`;
            fs.writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`, "utf8");
            fs.renameSync(temporary, this.config_path);
            this.subscriptions = next;
            return true;
        } catch (error: any) {
            plugin_logger("event_submit", `保存订阅数据失败: ${error?.message || error}`, "error");
            return false;
        }
    }
}
