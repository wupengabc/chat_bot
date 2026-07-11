import net from 'node:net';
import dns from 'node:dns';
import { performance } from 'node:perf_hooks';

const TIMEOUT = 3000;
const MOTD_RETRY_COUNT = 3;
const DEFAULT_PORT = 25565;
const HANDSHAKE_PROTOCOL = 763;

interface DnsProvider {
    name: string;
    servers: string[];
}

interface SrvRecordResult {
    target: string;
    port: number;
    priority: number;
    weight: number;
    dnsList: Set<string>;
}

interface ResolvedTarget {
    ip: string;
    port: number;
    dnsList: Set<string>;
    /**
     * 实际用于解析 IP 的域名。
     * SRV 模式下为 SRV target。
     */
    targetHost: string;
}

export interface MinecraftPlayerSample {
    id: string;
    name: string;
}

export interface MinecraftMotdInfo {
    status: 'online';
    host: string;
    ip: string;
    port: number;
    motd: string;
    motd_html: string;
    agreement: number;
    version: string;
    online: number;
    max: number;
    sample: MinecraftPlayerSample[];
    favicon: string;
    delay: number;
}

export interface MinecraftQueryResult {
    ip: string;
    port: number;
    dns_list: string[];
    motd: MinecraftMotdInfo | Record<string, never>;
}

interface ParsedMotd {
    text: string;
    html: string;
}

interface TextStyle {
    color: string | null;
    bold: boolean;
    italic: boolean;
    underlined: boolean;
    strikethrough: boolean;
    obfuscated: boolean;
}

interface MinecraftTextComponent {
    text?: string | number | boolean;
    translate?: string;
    with?: MinecraftComponent[];
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    strikethrough?: boolean;
    obfuscated?: boolean;
    extra?: MinecraftComponent[];
    selector?: string;
    keybind?: string;
    score?: {
        name?: string;
        objective?: string;
        value?: string | number;
    };
}

type MinecraftComponent =
    | string
    | number
    | boolean
    | MinecraftTextComponent
    | MinecraftComponent[]
    | null;

interface MinecraftStatusResponse {
    version?: {
        name?: string;
        protocol?: number;
    };
    players?: {
        max?: number;
        online?: number;
        sample?: Array<{
            id?: string;
            name?: string;
        }>;
    };
    description?: MinecraftComponent;
    favicon?: string;
    enforcesSecureChat?: boolean;
    previewsChat?: boolean;
}

interface VarIntResult {
    value: number;
    size: number;
}

const CHINA_DNS_SERVERS: ReadonlyArray<DnsProvider> = Object.freeze([
    {
        name: '阿里 DNS',
        servers: ['223.5.5.5', '223.6.6.6'],
    },
    {
        name: 'DNSPod',
        servers: ['119.29.29.29'],
    },
    {
        name: '百度 DNS',
        servers: ['180.76.76.76'],
    },
    {
        name: '114 DNS',
        servers: ['114.114.114.114', '114.114.115.115'],
    },
]);

const MINECRAFT_COLORS: Readonly<Record<string, string>> = Object.freeze({
    black: '#000000',
    dark_blue: '#0000AA',
    dark_green: '#00AA00',
    dark_aqua: '#00AAAA',
    dark_red: '#AA0000',
    dark_purple: '#AA00AA',
    gold: '#FFAA00',
    gray: '#AAAAAA',
    dark_gray: '#555555',
    blue: '#5555FF',
    green: '#55FF55',
    aqua: '#55FFFF',
    red: '#FF5555',
    light_purple: '#FF55FF',
    yellow: '#FFFF55',
    white: '#FFFFFF',
});

const LEGACY_COLORS: Readonly<Record<string, string>> = Object.freeze({
    '0': '#000000',
    '1': '#0000AA',
    '2': '#00AA00',
    '3': '#00AAAA',
    '4': '#AA0000',
    '5': '#AA00AA',
    '6': '#FFAA00',
    '7': '#AAAAAA',
    '8': '#555555',
    '9': '#5555FF',
    a: '#55FF55',
    b: '#55FFFF',
    c: '#FF5555',
    d: '#FF55FF',
    e: '#FFFF55',
    f: '#FFFFFF',
});

function withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string,
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(message));
        }, timeout);

        timer.unref();
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getMinecraftColor(color: unknown): string | null {
    if (typeof color !== 'string') {
        return null;
    }

    const normalized = color.toLowerCase();

    if (MINECRAFT_COLORS[normalized]) {
        return MINECRAFT_COLORS[normalized];
    }

    if (/^#[0-9a-f]{6}$/i.test(normalized)) {
        return normalized;
    }

    return null;
}

function createDefaultStyle(
    initialStyle: Partial<TextStyle> = {},
): TextStyle {
    return {
        color: initialStyle.color ?? null,
        bold: initialStyle.bold ?? false,
        italic: initialStyle.italic ?? false,
        underlined: initialStyle.underlined ?? false,
        strikethrough: initialStyle.strikethrough ?? false,
        obfuscated: initialStyle.obfuscated ?? false,
    };
}

function renderHtml(
    text: string,
    style: Partial<TextStyle> = {},
): string {
    let html = escapeHtml(text);

    if (!html) {
        return '';
    }

    if (style.obfuscated) {
        html = `<span class="minecraft-obfuscated">${html}</span>`;
    }

    if (style.strikethrough) {
        html = `<s>${html}</s>`;
    }

    if (style.underlined) {
        html = `<u>${html}</u>`;
    }

    if (style.italic) {
        html = `<i>${html}</i>`;
    }

    if (style.bold) {
        html = `<b>${html}</b>`;
    }

    const color = getMinecraftColor(style.color);

    if (color) {
        html = `<span style="color: ${color}">${html}</span>`;
    }

    return html;
}

function parseLegacyMotd(
    input: string,
    initialStyle: Partial<TextStyle> = {},
): ParsedMotd {
    const defaultStyle = createDefaultStyle(initialStyle);

    let style: TextStyle = { ...defaultStyle };
    let segment = '';
    let text = '';
    let html = '';

    const flush = (): void => {
        if (!segment) {
            return;
        }

        text += segment;
        html += renderHtml(segment, style);
        segment = '';
    };

    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];

        if (
            (character !== '§' && character !== '&') ||
            index + 1 >= input.length
        ) {
            segment += character;
            continue;
        }

        const code = input[index + 1].toLowerCase();

        // §x§F§F§0§0§A§A 或 &x&F&F&0&0&A&A
        if (code === 'x') {
            const remaining = input.slice(index);
            const match = remaining.match(
                /^[§&]x(?:[§&][0-9a-f]){6}/i,
            );

            if (match) {
                flush();

                const hexColor = match[0]
                    .slice(2)
                    .replace(/[§&]/g, '');

                style = {
                    color: `#${hexColor}`,
                    bold: false,
                    italic: false,
                    underlined: false,
                    strikethrough: false,
                    obfuscated: false,
                };

                index += match[0].length - 1;
                continue;
            }
        }

        const legacyColor = LEGACY_COLORS[code];

        if (legacyColor) {
            flush();

            // Minecraft 颜色代码会重置后续格式
            style = {
                color: legacyColor,
                bold: false,
                italic: false,
                underlined: false,
                strikethrough: false,
                obfuscated: false,
            };

            index += 1;
            continue;
        }

        if ('klmnor'.includes(code)) {
            flush();

            switch (code) {
                case 'k':
                    style.obfuscated = true;
                    break;

                case 'l':
                    style.bold = true;
                    break;

                case 'm':
                    style.strikethrough = true;
                    break;

                case 'n':
                    style.underlined = true;
                    break;

                case 'o':
                    style.italic = true;
                    break;

                case 'r':
                    style = { ...defaultStyle };
                    break;
            }

            index += 1;
            continue;
        }

        // 不认识的代码按普通字符处理
        segment += character;
    }

    flush();

    return { text, html };
}

function mergeStyle(
    component: MinecraftTextComponent,
    parentStyle: Partial<TextStyle>,
): TextStyle {
    const getBooleanStyle = (
        property: keyof Pick<
            TextStyle,
            | 'bold'
            | 'italic'
            | 'underlined'
            | 'strikethrough'
            | 'obfuscated'
        >,
    ): boolean => {
        const componentValue = component[property];

        if (typeof componentValue === 'boolean') {
            return componentValue;
        }

        return Boolean(parentStyle[property]);
    };

    return {
        color:
            typeof component.color === 'string'
                ? component.color
                : parentStyle.color ?? null,

        bold: getBooleanStyle('bold'),
        italic: getBooleanStyle('italic'),
        underlined: getBooleanStyle('underlined'),
        strikethrough: getBooleanStyle('strikethrough'),
        obfuscated: getBooleanStyle('obfuscated'),
    };
}

function getComponentOwnText(
    component: MinecraftTextComponent,
): string {
    if (component.text !== undefined && component.text !== null) {
        return String(component.text);
    }

    if (typeof component.translate === 'string') {
        if (Array.isArray(component.with) && component.with.length > 0) {
            const argumentsText = component.with
                .map((item) => parseComponent(item).text)
                .join(' ');

            return `${component.translate} ${argumentsText}`;
        }

        return component.translate;
    }

    if (component.selector !== undefined) {
        return String(component.selector);
    }

    if (component.keybind !== undefined) {
        return String(component.keybind);
    }

    if (component.score?.value !== undefined) {
        return String(component.score.value);
    }

    if (component.score?.name !== undefined) {
        return String(component.score.name);
    }

    return '';
}

function parseComponent(
    component: MinecraftComponent,
    parentStyle: Partial<TextStyle> = {},
): ParsedMotd {
    if (component === null || component === undefined) {
        return {
            text: '',
            html: '',
        };
    }

    if (Array.isArray(component)) {
        let text = '';
        let html = '';

        for (const child of component) {
            const parsed = parseComponent(child, parentStyle);
            text += parsed.text;
            html += parsed.html;
        }

        return { text, html };
    }

    if (
        typeof component === 'string' ||
        typeof component === 'number' ||
        typeof component === 'boolean'
    ) {
        const value = String(component);

        if (value.includes('§') || value.includes('&')) {
            return parseLegacyMotd(value, parentStyle);
        }

        return {
            text: value,
            html: renderHtml(value, parentStyle),
        };
    }

    const style = mergeStyle(component, parentStyle);
    const ownText = getComponentOwnText(component);

    let text = ownText;
    let html: string;

    if (ownText.includes('§') || ownText.includes('&')) {
        html = parseLegacyMotd(ownText, style).html;
    } else {
        html = renderHtml(ownText, style);
    }

    const extra = Array.isArray(component.extra)
        ? component.extra
        : [];

    for (const child of extra) {
        const parsed = parseComponent(child, style);
        text += parsed.text;
        html += parsed.html;
    }

    return { text, html };
}

function parseDescription(
    description: MinecraftComponent | undefined,
): ParsedMotd {
    if (description === undefined || description === null) {
        return {
            text: '',
            html: '',
        };
    }

    return parseComponent(description);
}

function encodeVarInt(value: number): Buffer {
    let currentValue = value >>> 0;
    const result: number[] = [];

    do {
        let currentByte = currentValue & 0x7f;
        currentValue >>>= 7;

        if (currentValue !== 0) {
            currentByte |= 0x80;
        }

        result.push(currentByte);
    } while (currentValue !== 0);

    return Buffer.from(result);
}

function tryReadVarInt(
    buffer: Buffer,
    offset = 0,
): VarIntResult | null {
    let value = 0;
    let position = 0;

    while (position < 5) {
        const index = offset + position;

        if (index >= buffer.length) {
            return null;
        }

        const currentByte = buffer[index];

        value |= (currentByte & 0x7f) << (7 * position);
        position += 1;

        if ((currentByte & 0x80) === 0) {
            return {
                value: value >>> 0,
                size: position,
            };
        }
    }

    throw new Error('无效 VarInt：长度超过 5 字节');
}

function encodeString(value: string): Buffer {
    const data = Buffer.from(value, 'utf8');

    return Buffer.concat([
        encodeVarInt(data.length),
        data,
    ]);
}

function createPacket(
    packetId: number,
    payload: Buffer = Buffer.alloc(0),
): Buffer {
    const body = Buffer.concat([
        encodeVarInt(packetId),
        payload,
    ]);

    return Buffer.concat([
        encodeVarInt(body.length),
        body,
    ]);
}

function createHandshakePacket(
    handshakeHost: string,
    port: number,
): Buffer {
    const portBuffer = Buffer.allocUnsafe(2);
    portBuffer.writeUInt16BE(port, 0);

    const payload = Buffer.concat([
        encodeVarInt(HANDSHAKE_PROTOCOL),
        encodeString(handshakeHost),
        portBuffer,
        encodeVarInt(1),
    ]);

    return createPacket(0x00, payload);
}

function readPacket(socket: net.Socket): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        let data = Buffer.alloc(0);
        let completed = false;

        const cleanup = (): void => {
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('end', onEnd);
            socket.off('close', onClose);
        };

        const succeed = (packet: Buffer): void => {
            if (completed) {
                return;
            }

            completed = true;
            cleanup();
            resolve(packet);
        };

        const fail = (error: Error): void => {
            if (completed) {
                return;
            }

            completed = true;
            cleanup();
            reject(error);
        };

        const onData = (chunk: Buffer): void => {
            data = Buffer.concat([data, chunk]);

            let packetLength: VarIntResult | null;

            try {
                packetLength = tryReadVarInt(data);
            } catch (error) {
                fail(toError(error));
                return;
            }

            if (!packetLength) {
                return;
            }

            const start = packetLength.size;
            const end = start + packetLength.value;

            if (data.length < end) {
                return;
            }

            succeed(data.subarray(start, end));
        };

        const onError = (error: Error): void => {
            fail(error);
        };

        const onEnd = (): void => {
            fail(new Error('服务器提前关闭连接'));
        };

        const onClose = (): void => {
            fail(new Error('服务器连接已关闭'));
        };

        socket.on('data', onData);
        socket.once('error', onError);
        socket.once('end', onEnd);
        socket.once('close', onClose);
    });
}

function parseStatusPacket(
    packet: Buffer,
): MinecraftStatusResponse {
    const packetId = tryReadVarInt(packet, 0);

    if (!packetId || packetId.value !== 0x00) {
        throw new Error('无效的 Minecraft Status 响应');
    }

    const jsonLengthOffset = packetId.size;
    const jsonLength = tryReadVarInt(packet, jsonLengthOffset);

    if (!jsonLength) {
        throw new Error('Status 响应中缺少 JSON 长度');
    }

    const jsonStart = jsonLengthOffset + jsonLength.size;
    const jsonEnd = jsonStart + jsonLength.value;

    if (packet.length < jsonEnd) {
        throw new Error('Status 响应 JSON 数据不完整');
    }

    const jsonText = packet
        .subarray(jsonStart, jsonEnd)
        .toString('utf8');

    const parsed: unknown = JSON.parse(jsonText);

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error('Status 响应 JSON 不是对象');
    }

    return parsed as MinecraftStatusResponse;
}

function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(String(error));
}

/**
 * 单次查询一个 IP 的 Minecraft MOTD。
 */
function queryMotdOnce(
    ip: string,
    port: number,
    handshakeHost: string,
): Promise<MinecraftMotdInfo> {
    return new Promise<MinecraftMotdInfo>((resolve, reject) => {
        const startedAt = performance.now();

        const socket = net.createConnection({
            host: ip,
            port,
            family: net.isIP(ip) as 4 | 6,
        });

        let settled = false;

        const finish = (
            error?: Error,
            result?: MinecraftMotdInfo,
        ): void => {
            if (settled) {
                return;
            }

            settled = true;
            socket.destroy();

            if (error) {
                reject(error);
                return;
            }

            if (!result) {
                reject(new Error('MOTD 查询未返回结果'));
                return;
            }

            resolve(result);
        };

        socket.setTimeout(TIMEOUT);

        socket.once('timeout', () => {
            finish(
                new Error(`MOTD 查询超时：${TIMEOUT}ms`),
            );
        });

        socket.once('error', (error: Error) => {
            finish(error);
        });

        socket.once('connect', () => {
            void (async (): Promise<void> => {
                try {
                    const responsePromise = readPacket(socket);

                    const handshake = createHandshakePacket(
                        handshakeHost,
                        port,
                    );

                    const statusRequest = createPacket(0x00);

                    socket.write(
                        Buffer.concat([
                            handshake,
                            statusRequest,
                        ]),
                    );

                    const packet = await responsePromise;
                    const response = parseStatusPacket(packet);
                    const parsedMotd = parseDescription(
                        response.description,
                    );

                    const sample: MinecraftPlayerSample[] =
                        Array.isArray(response.players?.sample)
                            ? response.players.sample.map((player) => ({
                                id: String(player.id ?? ''),
                                name: String(player.name ?? ''),
                            }))
                            : [];

                    finish(undefined, {
                        status: 'online',
                        host: handshakeHost,
                        ip,
                        port,
                        motd: parsedMotd.text,
                        motd_html: parsedMotd.html,
                        agreement: Number(
                            response.version?.protocol ?? 0,
                        ),
                        version: String(
                            response.version?.name ?? '',
                        ),
                        online: Number(
                            response.players?.online ?? 0,
                        ),
                        max: Number(response.players?.max ?? 0),
                        sample,
                        favicon: String(response.favicon ?? ''),
                        delay: Math.round(
                            performance.now() - startedAt,
                        ),
                    });
                } catch (error) {
                    finish(toError(error));
                }
            })();
        });
    });
}

/**
 * 一个 IP 最多尝试三次。
 */
async function queryMotdWithRetry(
    ip: string,
    port: number,
    handshakeHost: string,
): Promise<MinecraftMotdInfo | Record<string, never>> {
    for (
        let attempt = 1;
        attempt <= MOTD_RETRY_COUNT;
        attempt += 1
    ) {
        try {
            return await queryMotdOnce(
                ip,
                port,
                handshakeHost,
            );
        } catch {
            // 本次失败，继续下一次
        }
    }

    return {};
}

function createResolver(
    provider: DnsProvider,
): dns.promises.Resolver {
    /*
     * Node.js 新版本支持：
     *
     * new Resolver({
     *   timeout: TIMEOUT,
     *   tries: 1,
     * })
     *
     * 为兼容更多 Node/@types/node 版本，这里不向构造函数传选项，
     * 超时由 withTimeout 控制。
     */
    const resolver = new dns.promises.Resolver();
    resolver.setServers(provider.servers);

    return resolver;
}

async function resolveAddressByProvider(
    hostname: string,
    provider: DnsProvider,
): Promise<string[]> {
    const resolver = createResolver(provider);

    const [ipv4Result, ipv6Result] =
        await Promise.allSettled([
            withTimeout(
                resolver.resolve4(hostname),
                TIMEOUT,
                `${provider.name} A 查询超时`,
            ),
            withTimeout(
                resolver.resolve6(hostname),
                TIMEOUT,
                `${provider.name} AAAA 查询超时`,
            ),
        ]);

    const addresses: string[] = [];

    if (ipv4Result.status === 'fulfilled') {
        addresses.push(...ipv4Result.value);
    }

    if (ipv6Result.status === 'fulfilled') {
        addresses.push(...ipv6Result.value);
    }

    return addresses;
}

/**
 * 返回：
 *
 * Map<IP, 解析到该 IP 的 DNS 名称集合>
 */
async function resolveAllAddresses(
    hostname: string,
): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();

    await Promise.all(
        CHINA_DNS_SERVERS.map(
            async (provider): Promise<void> => {
                try {
                    const addresses =
                        await resolveAddressByProvider(
                            hostname,
                            provider,
                        );

                    for (const ip of addresses) {
                        let dnsList = result.get(ip);

                        if (!dnsList) {
                            dnsList = new Set<string>();
                            result.set(ip, dnsList);
                        }

                        dnsList.add(provider.name);
                    }
                } catch {
                    // 单个 DNS 失败不影响其他 DNS
                }
            },
        ),
    );

    return result;
}

async function resolveSrvByProvider(
    hostname: string,
    provider: DnsProvider,
): Promise<dns.SrvRecord[]> {
    const resolver = createResolver(provider);

    return withTimeout(
        resolver.resolveSrv(
            `_minecraft._tcp.${hostname}`,
        ),
        TIMEOUT,
        `${provider.name} SRV 查询超时`,
    );
}

async function resolveAllSrv(
    hostname: string,
): Promise<SrvRecordResult[]> {
    const srvMap = new Map<string, SrvRecordResult>();

    await Promise.all(
        CHINA_DNS_SERVERS.map(
            async (provider): Promise<void> => {
                try {
                    const records = await resolveSrvByProvider(
                        hostname,
                        provider,
                    );

                    for (const record of records) {
                        const target = record.name
                            .replace(/\.$/, '')
                            .toLowerCase();

                        if (
                            !target ||
                            !Number.isInteger(record.port) ||
                            record.port < 1 ||
                            record.port > 65535
                        ) {
                            continue;
                        }

                        const key = `${target}|${record.port}`;

                        let result = srvMap.get(key);

                        if (!result) {
                            result = {
                                target,
                                port: record.port,
                                priority: record.priority,
                                weight: record.weight,
                                dnsList: new Set<string>(),
                            };

                            srvMap.set(key, result);
                        }

                        result.dnsList.add(provider.name);
                    }
                } catch {
                    // 单个 DNS SRV 失败不影响其他 DNS
                }
            },
        ),
    );

    return [...srvMap.values()].sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }

        return b.weight - a.weight;
    });
}

function normalizePort(port: number | string): number {
    const normalized = Number(port);

    if (
        !Number.isInteger(normalized) ||
        normalized < 1 ||
        normalized > 65535
    ) {
        throw new TypeError(`无效端口：${port}`);
    }

    return normalized;
}

function normalizeHost(host: string): string {
    const value = host.trim();

    // [::1] 转换为 ::1
    if (
        value.startsWith('[') &&
        value.endsWith(']')
    ) {
        return value.slice(1, -1);
    }

    return value;
}

function mergeTarget(
    targetMap: Map<string, ResolvedTarget>,
    target: ResolvedTarget,
): void {
    /*
     * 根据 IP + 端口去重。
     *
     * 同一个 IP 对应不同端口时，视为不同的 Minecraft 服务。
     */
    const key = `${target.ip}|${target.port}`;
    const existing = targetMap.get(key);

    if (!existing) {
        targetMap.set(key, target);
        return;
    }

    for (const dnsName of target.dnsList) {
        existing.dnsList.add(dnsName);
    }
}

async function queryResolvedTargets(
    targets: ResolvedTarget[],
    handshakeHost: string,
): Promise<MinecraftQueryResult[]> {
    return Promise.all(
        targets.map(
            async (
                target,
            ): Promise<MinecraftQueryResult> => ({
                ip: target.ip,
                port: target.port,
                dns_list: [...target.dnsList],
                motd: await queryMotdWithRetry(
                    target.ip,
                    target.port,
                    handshakeHost,
                ),
            }),
        ),
    );
}

/**
 * 查询 Minecraft Java 服务器。
 *
 * @example
 * queryMinecraftMotd('mc.example.com')
 * queryMinecraftMotd('mc.example.com', 25565)
 * queryMinecraftMotd('1.2.3.4')
 * queryMinecraftMotd('1.2.3.4', 25565)
 * queryMinecraftMotd('2400:3200::1', 25565)
 */
export async function queryMinecraftMotd(
    host: string,
    port?: number | string,
): Promise<MinecraftQueryResult[]> {
    if (typeof host !== 'string' || !host.trim()) {
        return [];
    }

    const normalizedHost = normalizeHost(host);
    const ipFamily = net.isIP(normalizedHost);

    const hasExplicitPort =
        port !== undefined &&
        port !== null &&
        port !== '';

    /*
     * 直接传入 IP：
     * 不解析 DNS，不查询 SRV。
     */
    if (ipFamily !== 0) {
        const targetPort = hasExplicitPort
            ? normalizePort(port)
            : DEFAULT_PORT;

        const motd = await queryMotdWithRetry(
            normalizedHost,
            targetPort,
            normalizedHost,
        );

        return [
            {
                ip: normalizedHost,
                port: targetPort,
                dns_list: [],
                motd,
            },
        ];
    }

    /*
     * 域名 + 明确端口：
     * 不查询 SRV，直接使用多个国内 DNS 解析。
     */
    if (hasExplicitPort) {
        const targetPort = normalizePort(port);
        const addressMap =
            await resolveAllAddresses(normalizedHost);

        if (addressMap.size === 0) {
            return [];
        }

        const targets: ResolvedTarget[] = [
            ...addressMap.entries(),
        ].map(([ip, dnsList]) => ({
            ip,
            port: targetPort,
            dnsList,
            targetHost: normalizedHost,
        }));

        return queryResolvedTargets(
            targets,
            normalizedHost,
        );
    }

    /*
     * 只有域名：
     * 先查询 _minecraft._tcp SRV。
     */
    const srvRecords = await resolveAllSrv(
        normalizedHost,
    );

    /*
     * SRV 失败：
     * 解析原始域名并使用默认端口 25565。
     */
    if (srvRecords.length === 0) {
        const addressMap =
            await resolveAllAddresses(normalizedHost);

        if (addressMap.size === 0) {
            return [];
        }

        const targets: ResolvedTarget[] = [
            ...addressMap.entries(),
        ].map(([ip, dnsList]) => ({
            ip,
            port: DEFAULT_PORT,
            dnsList,
            targetHost: normalizedHost,
        }));

        return queryResolvedTargets(
            targets,
            normalizedHost,
        );
    }

    /*
     * SRV 成功：
     * 解析所有 SRV target 的 A/AAAA。
     */
    const targetMap = new Map<string, ResolvedTarget>();

    await Promise.all(
        srvRecords.map(
            async (srvRecord): Promise<void> => {
                const addressMap =
                    await resolveAllAddresses(srvRecord.target);

                for (const [ip, addressDnsList] of addressMap) {
                    const dnsList = new Set<string>();

                    for (const dnsName of srvRecord.dnsList) {
                        dnsList.add(dnsName);
                    }

                    for (const dnsName of addressDnsList) {
                        dnsList.add(dnsName);
                    }

                    mergeTarget(targetMap, {
                        ip,
                        port: srvRecord.port,
                        dnsList,
                        targetHost: srvRecord.target,
                    });
                }
            },
        ),
    );

    if (targetMap.size === 0) {
        return [];
    }

    /*
     * TCP 连接使用解析出来的 IP。
     * Minecraft 握手地址保留用户输入的原始域名，
     * 以兼容 Velocity、BungeeCord 等虚拟主机路由。
     */
    return queryResolvedTargets(
        [...targetMap.values()],
        normalizedHost,
    );
}

export default queryMinecraftMotd;