import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';

/* =========================================================
 * 类型定义
 * ======================================================= */

export interface MinecraftPlayerSample {
    id?: string;
    name?: string;
}

export interface MinecraftMotdInfo {
    status?: string;
    host?: string;
    ip?: string;
    port?: number;

    motd?: string;
    motd_html?: string;

    agreement?: number;
    version?: string;

    online?: number;
    max?: number;

    sample?: MinecraftPlayerSample[];

    favicon?: string;
    delay?: number;
}

export interface MinecraftMotdQueryResult {
    ip: string;
    port: number;
    dns_list: string[];

    motd:
        | MinecraftMotdInfo
        | Record<string, never>;
}

export interface RenderMinecraftMotdOptions {
    /**
     * 图片宽度。
     *
     * 默认：900
     * 范围：720～2400
     */
    width?: number;

    /**
     * 主标题。
     *
     * 默认：MINECRAFT SERVER STATUS
     */
    title?: string;

    /**
     * 副标题。
     *
     * 默认：Minecraft 服务器节点检测
     */
    subtitle?: string;

    /**
     * 原始查询地址。
     */
    host?: string;

    /**
     * 自定义字体文件路径。
     */
    fontPath?: string;

    /**
     * 字体文件内部的 Family 名称。
     *
     * 默认：Noto Sans CJK SC
     */
    fontFamily?: string;

    /**
     * PNG 输出缩放倍率。
     *
     * 默认：1
     * 范围：0.5～4
     */
    scale?: number;

    /**
     * 是否显示玩家样例。
     *
     * 默认：true
     */
    showPlayers?: boolean;

    /**
     * 最多显示多少名样例玩家。
     *
     * 默认：3
     * 范围：0～10
     */
    maxPlayers?: number;
}

/* =========================================================
 * 深色主题
 * ======================================================= */

const THEME = {
    pageBackground: '#0d1117',
    pageBackgroundSecondary: '#151b24',

    primary: '#ff745e',
    primaryLight: '#ff9a87',
    primaryDark: '#d75140',

    cardBackground: '#171d26',
    cardBackgroundSecondary: '#1d2530',
    cardBorder: '#35404f',
    cardTopLine: '#ff745e',

    title: '#f5f7fa',
    subtitle: '#9aa8b8',

    text: '#e8edf3',
    textSecondary: '#b2bdca',
    textLight: '#7f8c9c',

    separator: '#303a47',

    online: '#55d68b',
    onlineBackground: '#152c24',
    onlineBorder: '#2c6b4a',

    offline: '#ff6b6b',
    offlineBackground: '#321d22',
    offlineBorder: '#74343e',

    warning: '#f5bd55',
    warningBackground: '#302816',
    warningBorder: '#6f5927',

    info: '#6bb8f0',
    infoBackground: '#172937',
    infoBorder: '#315d78',

    iconBackground: '#202936',
    iconBorder: '#455466',

    progressBackground: '#293340',
    progressFill: '#ff745e',

    sampleBackground: '#121820',
    sampleBorder: '#303b49',
    sampleLabelBackground: '#202a36',

    footer: '#778596'
} as const;

/* =========================================================
 * 基础工具
 * ======================================================= */

function clamp(
    value: number,
    min: number,
    max: number
): number {
    return Math.min(
        max,
        Math.max(min, value)
    );
}

function toNumber(
    value: unknown,
    fallback: number
): number {
    const result = Number(value);

    return Number.isFinite(result)
        ? result
        : fallback;
}

function escapeXml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function sanitizeFontFamily(
    value: unknown
): string {
    return String(value ?? '')
        .replace(/[\\'"`;{}<>]/g, '')
        .trim();
}

function isMotdAvailable(
    motd:
        | MinecraftMotdInfo
        | Record<string, never>
        | null
        | undefined
): motd is MinecraftMotdInfo {
    return Boolean(
        motd &&
        typeof motd === 'object' &&
        Object.keys(motd).length > 0
    );
}

/**
 * 只允许可信的 Base64 图片 Data URL。
 */
function normalizeFavicon(
    favicon: unknown
): string | null {
    if (typeof favicon !== 'string') {
        return null;
    }

    const value = favicon.trim();

    if (
        /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(
            value
        )
    ) {
        return value.replace(/\s+/g, '');
    }

    return null;
}

/* =========================================================
 * 文本宽度估算
 * ======================================================= */

function isFullWidthCharacter(
    character: string
): boolean {
    const code =
        character.codePointAt(0) ?? 0;

    return (
        (code >= 0x2e80 && code <= 0x9fff) ||
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0x1f300 && code <= 0x1faff)
    );
}

function estimateCharacterWidth(
    character: string,
    fontSize: number
): number {
    if (/\s/u.test(character)) {
        return fontSize * 0.35;
    }

    if (isFullWidthCharacter(character)) {
        return fontSize;
    }

    if (/[MW@#%&]/u.test(character)) {
        return fontSize * 0.9;
    }

    if (/[A-Z0-9]/u.test(character)) {
        return fontSize * 0.64;
    }

    if (/[a-z]/u.test(character)) {
        return fontSize * 0.54;
    }

    if (/[,.;:'"`!|ilI()[\]{}]/u.test(character)) {
        return fontSize * 0.32;
    }

    return fontSize * 0.56;
}

function estimateTextWidth(
    text: string,
    fontSize: number,
    fontWeight = 400
): number {
    let width = 0;

    for (const character of Array.from(text)) {
        width += estimateCharacterWidth(
            character,
            fontSize
        );
    }

    if (fontWeight >= 700) {
        width *= 1.04;
    } else if (fontWeight >= 600) {
        width *= 1.02;
    }

    return width;
}

function ellipsisText(
    value: unknown,
    maxWidth: number,
    fontSize: number,
    fontWeight = 400
): string {
    const text = String(value ?? '');

    if (
        estimateTextWidth(
            text,
            fontSize,
            fontWeight
        ) <= maxWidth
    ) {
        return text;
    }

    const ellipsis = '…';

    const ellipsisWidth =
        estimateTextWidth(
            ellipsis,
            fontSize,
            fontWeight
        );

    let result = '';
    let currentWidth = 0;

    for (const character of Array.from(text)) {
        const characterWidth =
            estimateCharacterWidth(
                character,
                fontSize
            );

        if (
            currentWidth +
            characterWidth +
            ellipsisWidth >
            maxWidth
        ) {
            break;
        }

        result += character;
        currentWidth += characterWidth;
    }

    return result + ellipsis;
}

function wrapText(
    value: unknown,
    maxWidth: number,
    fontSize: number,
    maxLines: number,
    fontWeight = 400
): string[] {
    const text = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

    if (!text) {
        return [''];
    }

    const result: string[] = [];
    const paragraphs = text.split('\n');

    let truncated = false;

    for (let paragraphIndex = 0;
         paragraphIndex < paragraphs.length;
         paragraphIndex++
    ) {
        const paragraph =
            paragraphs[paragraphIndex];

        let currentLine = '';
        let currentWidth = 0;

        for (const character of Array.from(paragraph)) {
            const characterWidth =
                estimateCharacterWidth(
                    character,
                    fontSize
                );

            if (
                currentLine &&
                currentWidth + characterWidth >
                maxWidth
            ) {
                result.push(currentLine);

                if (result.length >= maxLines) {
                    truncated = true;
                    break;
                }

                currentLine = character;
                currentWidth = characterWidth;
            } else {
                currentLine += character;
                currentWidth += characterWidth;
            }
        }

        if (truncated) {
            break;
        }

        if (
            currentLine &&
            result.length < maxLines
        ) {
            result.push(currentLine);
        }

        if (
            result.length >= maxLines &&
            paragraphIndex <
            paragraphs.length - 1
        ) {
            truncated = true;
            break;
        }
    }

    if (
        truncated &&
        result.length > 0
    ) {
        result[result.length - 1] =
            ellipsisText(
                `${result[result.length - 1]}…`,
                maxWidth,
                fontSize,
                fontWeight
            );
    }

    return result.slice(0, maxLines);
}

/* =========================================================
 * SVG 工具
 * ======================================================= */

interface RectOptions {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
}

interface TextOptions {
    fontFamily: string;
    fontSize: number;
    fontWeight?: number;
    fill: string;
    anchor?: 'start' | 'middle' | 'end';
    letterSpacing?: number;
}

function svgRect(
    x: number,
    y: number,
    width: number,
    height: number,
    options: RectOptions = {}
): string {
    const attributes = [
        `<rect x="${x}"`,
        ` y="${y}"`,
        ` width="${Math.max(0, width)}"`,
        ` height="${Math.max(0, height)}"`,
        ` fill="${options.fill ?? 'none'}"`
    ];

    if (options.stroke) {
        attributes.push(
            ` stroke="${options.stroke}"`,
            ` stroke-width="${options.strokeWidth ?? 1}"`
        );
    }

    if (options.opacity !== undefined) {
        attributes.push(
            ` opacity="${options.opacity}"`
        );
    }

    attributes.push('/>');

    return attributes.join('');
}

/**
 * 顶部对齐文本。
 */
function svgText(
    text: unknown,
    x: number,
    y: number,
    options: TextOptions
): string {
    const attributes = [
        `<text x="${x}"`,
        ` y="${y}"`,
        ` font-family="${escapeXml(options.fontFamily)}"`,
        ` font-size="${options.fontSize}"`,
        ` font-weight="${options.fontWeight ?? 400}"`,
        ` fill="${options.fill}"`,
        ` text-anchor="${options.anchor ?? 'start'}"`,
        ' dominant-baseline="text-before-edge"'
    ];

    if (options.letterSpacing !== undefined) {
        attributes.push(
            ` letter-spacing="${options.letterSpacing}"`
        );
    }

    attributes.push(
        '>',
        escapeXml(text),
        '</text>'
    );

    return attributes.join('');
}

/**
 * 垂直居中文本。
 *
 * 标签和值需要对齐时统一使用此函数。
 */
function svgMiddleText(
    text: unknown,
    x: number,
    centerY: number,
    options: TextOptions
): string {
    const attributes = [
        `<text x="${x}"`,
        ` y="${centerY}"`,
        ` font-family="${escapeXml(options.fontFamily)}"`,
        ` font-size="${options.fontSize}"`,
        ` font-weight="${options.fontWeight ?? 400}"`,
        ` fill="${options.fill}"`,
        ` text-anchor="${options.anchor ?? 'start'}"`,
        ' dominant-baseline="middle"'
    ];

    if (options.letterSpacing !== undefined) {
        attributes.push(
            ` letter-spacing="${options.letterSpacing}"`
        );
    }

    attributes.push(
        '>',
        escapeXml(text),
        '</text>'
    );

    return attributes.join('');
}

function drawMultilineText(
    lines: string[],
    x: number,
    y: number,
    lineHeight: number,
    options: TextOptions
): string {
    return lines
        .map((line, index) =>
            svgText(
                line,
                x,
                y + index * lineHeight,
                options
            )
        )
        .join('');
}

/* =========================================================
 * 信息卡片
 * ======================================================= */

function drawInfoBox(
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    fontFamily: string,
    colors: {
        background: string;
        border: string;
        label: string;
        value: string;
    }
): string {
    const height = 54;

    return [
        svgRect(
            x,
            y,
            width,
            height,
            {
                fill: colors.background,
                stroke: colors.border,
                strokeWidth: 1
            }
        ),

        svgText(
            label,
            x + 12,
            y + 7,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 500,
                fill: colors.label
            }
        ),

        svgText(
            ellipsisText(
                value,
                width - 24,
                17,
                600
            ),
            x + 12,
            y + 27,
            {
                fontFamily,
                fontSize: 17,
                fontWeight: 600,
                fill: colors.value
            }
        )
    ].join('');
}

/* =========================================================
 * 玩家样例栏
 * ======================================================= */

/**
 * 绘制玩家样例信息栏。
 *
 * 修复对齐的关键：
 *
 * 1. 标签和值使用同一个 centerY。
 * 2. 两者都使用 svgMiddleText。
 * 3. dominant-baseline 统一为 middle。
 * 4. 标签区域使用固定宽度。
 */
function drawPlayerSampleBar(
    playersText: string,
    x: number,
    y: number,
    width: number,
    fontFamily: string
): string {
    const height = 34;
    const labelWidth = 84;
    const centerY = y + height / 2;

    return [
        // 整体背景
        svgRect(
            x,
            y,
            width,
            height,
            {
                fill: THEME.sampleBackground,
                stroke: THEME.sampleBorder,
                strokeWidth: 1
            }
        ),

        // 标签背景
        svgRect(
            x,
            y,
            labelWidth,
            height,
            {
                fill: THEME.sampleLabelBackground
            }
        ),

        // 标签右侧分隔线
        svgRect(
            x + labelWidth,
            y,
            1,
            height,
            {
                fill: THEME.sampleBorder
            }
        ),

        // 标签：垂直居中
        svgMiddleText(
            '玩家样例',
            x + 12,
            centerY,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 600,
                fill: THEME.primaryLight
            }
        ),

        // 内容：与标签共用同一个 centerY
        svgMiddleText(
            ellipsisText(
                playersText,
                width - labelWidth - 24,
                13,
                500
            ),
            x + labelWidth + 12,
            centerY,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 500,
                fill: THEME.textSecondary
            }
        )
    ].join('');
}

/* =========================================================
 * 服务器图标
 * ======================================================= */

function drawServerIcon(
    favicon: string | null,
    x: number,
    y: number,
    size: number,
    fontFamily: string,
    online: boolean
): string {
    const output: string[] = [];

    output.push(
        svgRect(
            x,
            y,
            size,
            size,
            {
                fill: THEME.iconBackground,
                stroke: THEME.iconBorder,
                strokeWidth: 2
            }
        )
    );

    if (favicon) {
        output.push(
            [
                `<image x="${x + 4}"`,
                ` y="${y + 4}"`,
                ` width="${size - 8}"`,
                ` height="${size - 8}"`,
                ` href="${escapeXml(favicon)}"`,
                ' preserveAspectRatio="xMidYMid meet"/>'
            ].join('')
        );
    } else {
        output.push(
            svgMiddleText(
                online ? 'MC' : '!',
                x + size / 2,
                y + size / 2,
                {
                    fontFamily,
                    fontSize: online ? 25 : 30,
                    fontWeight: 700,
                    fill: online
                        ? THEME.primary
                        : THEME.offline,
                    anchor: 'middle'
                }
            )
        );
    }

    // 右下角状态方块
    output.push(
        svgRect(
            x + size - 14,
            y + size - 14,
            10,
            10,
            {
                fill: online
                    ? THEME.online
                    : THEME.offline,
                stroke: THEME.cardBackground,
                strokeWidth: 2
            }
        )
    );

    return output.join('');
}

/* =========================================================
 * 单个节点卡片
 * ======================================================= */

function drawServerCard(
    result: MinecraftMotdQueryResult,
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    fontFamily: string,
    options: RenderMinecraftMotdOptions
): string {
    const output: string[] = [];

    const motdAvailable =
        isMotdAvailable(result.motd);

    const motd = motdAvailable
        ? result.motd : { status: 'offline' };

    const online =
        motdAvailable &&
        motd.status !== 'offline';

    const favicon =
        normalizeFavicon(motd?.favicon);

    const cardPadding = 20;
    const iconSize = 68;

    // 卡片背景
    output.push(
        svgRect(
            x,
            y,
            width,
            height,
            {
                fill: THEME.cardBackground,
                stroke: THEME.cardBorder,
                strokeWidth: 2
            }
        )
    );

    // 顶部强调线
    output.push(
        svgRect(
            x,
            y,
            width,
            5,
            {
                fill: motdAvailable
                    ? THEME.cardTopLine
                    : THEME.offline
            }
        )
    );

    // 节点编号背景
    output.push(
        svgRect(
            x + 16,
            y + 16,
            36,
            25,
            {
                fill: motdAvailable
                    ? THEME.primary
                    : THEME.offline
            }
        )
    );

    // 节点编号
    output.push(
        svgMiddleText(
            String(index + 1).padStart(2, '0'),
            x + 34,
            y + 28.5,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 700,
                fill: '#ffffff',
                anchor: 'middle'
            }
        )
    );

    const endpoint =
        result.ip.includes(':')
            ? `[${result.ip}]:${result.port}`
            : `${result.ip}:${result.port}`;

    // IP 和端口
    output.push(
        svgText(
            ellipsisText(
                endpoint,
                width - 250,
                20,
                700
            ),
            x + 64,
            y + 16,
            {
                fontFamily,
                fontSize: 20,
                fontWeight: 700,
                fill: THEME.title
            }
        )
    );

    // 状态标签
    const statusWidth =
        motdAvailable ? 82 : 106;

    const statusX =
        x + width - statusWidth - 18;

    output.push(
        svgRect(
            statusX,
            y + 15,
            statusWidth,
            27,
            {
                fill: motdAvailable
                    ? THEME.onlineBackground
                    : THEME.offlineBackground,
                stroke: motdAvailable
                    ? THEME.onlineBorder
                    : THEME.offlineBorder,
                strokeWidth: 1
            }
        )
    );

    output.push(
        svgRect(
            statusX + 9,
            y + 24,
            8,
            8,
            {
                fill: motdAvailable
                    ? THEME.online
                    : THEME.offline
            }
        )
    );

    output.push(
        svgMiddleText(
            motdAvailable
                ? '在线'
                : '查询失败',
            statusX + 25,
            y + 28.5,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 600,
                fill: motdAvailable
                    ? THEME.online
                    : THEME.offline
            }
        )
    );

    // DNS 来源
    const dnsText =
        result.dns_list.length > 0
            ? result.dns_list.join(' / ')
            : '直接 IP，不进行 DNS 查询';

    const dnsCenterY = y + 63;

    output.push(
        svgMiddleText(
            'DNS 来源',
            x + 20,
            dnsCenterY,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 600,
                fill: THEME.textLight
            }
        )
    );

    output.push(
        svgRect(
            x + 78,
            y + 54,
            1,
            18,
            {
                fill: THEME.separator
            }
        )
    );

    output.push(
        svgMiddleText(
            ellipsisText(
                dnsText,
                width - 120,
                13,
                500
            ),
            x + 90,
            dnsCenterY,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 500,
                fill: THEME.textSecondary
            }
        )
    );

    output.push(
        svgRect(
            x + 20,
            y + 81,
            width - 40,
            1,
            {
                fill: THEME.separator
            }
        )
    );

    /* -----------------------------------------------------
     * MOTD 查询失败
     * --------------------------------------------------- */

    if (!motdAvailable) {
        output.push(
            drawServerIcon(
                null,
                x + cardPadding,
                y + 101,
                iconSize,
                fontFamily,
                false
            )
        );

        output.push(
            svgText(
                '该节点连续查询 3 次均失败',
                x + 108,
                y + 103,
                {
                    fontFamily,
                    fontSize: 20,
                    fontWeight: 700,
                    fill: THEME.offline
                }
            )
        );

        output.push(
            svgText(
                '目标 IP 有效，但未能取得 Minecraft MOTD 信息。',
                x + 108,
                y + 138,
                {
                    fontFamily,
                    fontSize: 14,
                    fontWeight: 400,
                    fill: THEME.textSecondary
                }
            )
        );

        output.push(
            svgText(
                '请检查端口、防火墙、服务器状态及协议支持情况。',
                x + 108,
                y + 164,
                {
                    fontFamily,
                    fontSize: 14,
                    fontWeight: 400,
                    fill: THEME.textLight
                }
            )
        );

        return output.join('');
    }

    /* -----------------------------------------------------
     * MOTD 查询成功
     * --------------------------------------------------- */

    output.push(
        drawServerIcon(
            favicon,
            x + cardPadding,
            y + 98,
            iconSize,
            fontFamily,
            online
        )
    );

    const motdText =
        String(motd.motd ?? '').trim() ||
        'Minecraft Server';

    const motdLines = wrapText(
        motdText,
        width - 150,
        18,
        2,
        600
    );

    output.push(
        drawMultilineText(
            motdLines,
            x + 108,
            y + 96,
            25,
            {
                fontFamily,
                fontSize: 18,
                fontWeight: 600,
                fill: THEME.text
            }
        )
    );

    const versionText =
        String(
            motd.version ??
            '未知版本'
        );

    const agreementText =
        motd.agreement !== undefined
            ? `协议 ${motd.agreement}`
            : '协议未知';

    output.push(
        svgText(
            ellipsisText(
                `${versionText} · ${agreementText}`,
                width - 150,
                13,
                400
            ),
            x + 108,
            y + 150,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 400,
                fill: THEME.textSecondary
            }
        )
    );

    // 三个统计卡片
    const infoY = y + 181;
    const infoGap = 10;

    const infoWidth =
        (
            width -
            cardPadding * 2 -
            infoGap * 2
        ) / 3;

    const onlinePlayers = Math.max(
        0,
        toNumber(motd.online, 0)
    );

    const maxPlayers = Math.max(
        0,
        toNumber(motd.max, 0)
    );

    const delay = Math.max(
        0,
        toNumber(motd.delay, 0)
    );

    output.push(
        drawInfoBox(
            '在线玩家',
            `${onlinePlayers} / ${maxPlayers}`,
            x + cardPadding,
            infoY,
            infoWidth,
            fontFamily,
            {
                background: THEME.onlineBackground,
                border: THEME.onlineBorder,
                label: THEME.online,
                value: THEME.online
            }
        )
    );

    output.push(
        drawInfoBox(
            '服务器版本',
            versionText,
            x +
            cardPadding +
            infoWidth +
            infoGap,
            infoY,
            infoWidth,
            fontFamily,
            {
                background: THEME.infoBackground,
                border: THEME.infoBorder,
                label: THEME.info,
                value: THEME.info
            }
        )
    );

    output.push(
        drawInfoBox(
            '网络延迟',
            `${delay} ms`,
            x +
            cardPadding +
            (infoWidth + infoGap) * 2,
            infoY,
            infoWidth,
            fontFamily,
            {
                background: THEME.warningBackground,
                border: THEME.warningBorder,
                label: THEME.warning,
                value: THEME.warning
            }
        )
    );

    // 玩家数量进度条
    const progressY =
        infoY + 65;

    const progressWidth =
        width - cardPadding * 2;

    const playerRatio =
        maxPlayers > 0
            ? clamp(
                onlinePlayers / maxPlayers,
                0,
                1
            )
            : 0;

    output.push(
        svgRect(
            x + cardPadding,
            progressY,
            progressWidth,
            7,
            {
                fill: THEME.progressBackground
            }
        )
    );

    output.push(
        svgRect(
            x + cardPadding,
            progressY,
            progressWidth * playerRatio,
            7,
            {
                fill: THEME.progressFill
            }
        )
    );

    // 玩家样例信息栏
    if (options.showPlayers !== false) {
        const maxSamples = clamp(
            Math.floor(
                toNumber(
                    options.maxPlayers,
                    3
                )
            ),
            0,
            10
        );

        const samples =
            Array.isArray(motd.sample)
                ? motd.sample
                    .filter(
                        player =>
                            player &&
                            typeof player.name === 'string' &&
                            player.name.trim().length > 0
                    )
                    .slice(0, maxSamples)
                : [];

        const playersText =
            samples.length > 0
                ? samples
                    .map(
                        player =>
                            player.name!.trim()
                    )
                    .join(' / ')
                : '服务器未返回玩家样例';

        output.push(
            drawPlayerSampleBar(
                playersText,
                x + cardPadding,
                progressY + 17,
                progressWidth,
                fontFamily
            )
        );
    }

    return output.join('');
}

/* =========================================================
 * 生成 SVG
 * ======================================================= */

export function renderMinecraftMotdSvg(
    results: MinecraftMotdQueryResult[],
    options: RenderMinecraftMotdOptions = {}
): string {
    if (!Array.isArray(results)) {
        throw new TypeError(
            'results 必须是 queryMinecraftMotd 返回的数组'
        );
    }

    const width = clamp(
        Math.floor(
            toNumber(
                options.width,
                900
            )
        ),
        720,
        2400
    );

    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) ||
        'Noto Sans CJK SC';

    const title = String(
        options.title ??
        'MINECRAFT SERVER STATUS'
    );

    const subtitle = String(
        options.subtitle ??
        'Minecraft 服务器节点检测'
    );

    const outerPadding = 26;
    const headerHeight = 105;
    const footerHeight = 54;

    /*
     * 显示玩家样例时，卡片需要更高。
     */
    const onlineCardHeight =
        options.showPlayers === false
            ? 282
            : 318;

    const failedCardHeight = 225;
    const cardGap = 18;
    const emptyHeight = 220;

    const cardHeights =
        results.map(result =>
            isMotdAvailable(result.motd)
                ? onlineCardHeight
                : failedCardHeight
        );

    const contentHeight =
        results.length === 0
            ? emptyHeight
            : cardHeights.reduce(
                (sum, cardHeight) =>
                    sum + cardHeight,
                0
            ) +
            cardGap *
            Math.max(
                0,
                results.length - 1
            );

    const height =
        headerHeight +
        contentHeight +
        footerHeight +
        outerPadding * 2;

    const onlineCount =
        results.filter(result =>
            isMotdAvailable(result.motd)
        ).length;

    const failedCount =
        results.length - onlineCount;

    const svg: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` width="${width}"`,
        ` height="${height}"`,
        ` viewBox="0 0 ${width} ${height}">`,
        '<defs>',
        '<linearGradient',
        ' id="pageGradient"',
        ' x1="0"',
        ' y1="0"',
        ' x2="1"',
        ' y2="1">',
        `<stop offset="0%" stop-color="${THEME.pageBackground}"/>`,
        `<stop offset="100%" stop-color="${THEME.pageBackgroundSecondary}"/>`,
        '</linearGradient>',
        '</defs>',
        // 页面背景
        svgRect(
            0,
            0,
            width,
            height,
            {
                fill: 'url(#pageGradient)'
            }
        ),
        // 顶部强调线
        svgRect(
            0,
            0,
            width,
            6,
            {
                fill: THEME.primary
            }
        ),
        svgRect(
            0,
            6,
            width * 0.6,
            3,
            {
                fill: THEME.primaryLight
            }
        ),
        // 右上角装饰
        svgRect(
            width - 150,
            9,
            150,
            72,
            {
                fill: THEME.primary,
                opacity: 0.06
            }
        ),
        svgRect(
            width - 82,
            9,
            82,
            42,
            {
                fill: THEME.primaryLight,
                opacity: 0.05
            }
        ),
        // 标题左侧标记
        svgRect(
            outerPadding,
            27,
            5,
            54,
            {
                fill: THEME.primary
            }
        ),
        svgRect(
            outerPadding + 9,
            27,
            2,
            54,
            {
                fill: THEME.primaryLight
            }
        ),
        // 主标题
        svgText(
            ellipsisText(
                title,
                width - 310,
                29,
                700
            ),
            outerPadding + 25,
            22,
            {
                fontFamily,
                fontSize: 29,
                fontWeight: 700,
                fill: THEME.title,
                letterSpacing: 1.2
            }
        ),
        // 副标题
        svgText(
            ellipsisText(
                subtitle,
                width - 310,
                14,
                400
            ),
            outerPadding + 26,
            63,
            {
                fontFamily,
                fontSize: 14,
                fontWeight: 400,
                fill: THEME.subtitle
            }
        )
    ];
    /* -----------------------------------------------------
     * 顶部统计
     * --------------------------------------------------- */
    if (results.length > 0) {
        const summaryWidth = 218;
        const summaryX =
            width -
            outerPadding -
            summaryWidth;
        svg.push(
            svgRect(
                summaryX,
                28,
                summaryWidth,
                48,
                {
                    fill: THEME.cardBackground,
                    stroke: THEME.cardBorder,
                    strokeWidth: 1
                }
            ),
            svgText(
                '检测节点',
                summaryX + 12,
                35,
                {
                    fontFamily,
                    fontSize: 11,
                    fontWeight: 500,
                    fill: THEME.textLight
                }
            ),
            svgText(
                String(results.length),
                summaryX + 12,
                51,
                {
                    fontFamily,
                    fontSize: 17,
                    fontWeight: 700,
                    fill: THEME.title
                }
            ),
            svgRect(
                summaryX + 61,
                36,
                1,
                30,
                {
                    fill: THEME.separator
                }
            ),
            svgMiddleText(
                `在线 ${onlineCount}`,
                summaryX + 76,
                52,
                {
                    fontFamily,
                    fontSize: 13,
                    fontWeight: 600,
                    fill: THEME.online
                }
            ),
            svgMiddleText(
                `失败 ${failedCount}`,
                summaryX + 150,
                52,
                {
                    fontFamily,
                    fontSize: 13,
                    fontWeight: 600,
                    fill:
                        failedCount > 0
                            ? THEME.offline
                            : THEME.textLight
                }
            )
        );
    }
    let currentY =
        headerHeight + outerPadding;
    /* -----------------------------------------------------
     * 空结果状态
     * --------------------------------------------------- */
    if (results.length === 0) {
        const emptyCardX = outerPadding;
        const emptyCardWidth =
            width - outerPadding * 2;
        svg.push(
            svgRect(
                emptyCardX,
                currentY,
                emptyCardWidth,
                emptyHeight,
                {
                    fill: THEME.cardBackground,
                    stroke: THEME.cardBorder,
                    strokeWidth: 2
                }
            ),
            svgRect(
                emptyCardX,
                currentY,
                emptyCardWidth,
                5,
                {
                    fill: THEME.offline
                }
            ),
            svgRect(
                width / 2 - 32,
                currentY + 35,
                64,
                64,
                {
                    fill: THEME.offlineBackground,
                    stroke: THEME.offlineBorder,
                    strokeWidth: 2
                }
            ),
            svgMiddleText(
                '!',
                width / 2,
                currentY + 67,
                {
                    fontFamily,
                    fontSize: 34,
                    fontWeight: 700,
                    fill: THEME.offline,
                    anchor: 'middle'
                }
            ),
            svgText(
                '未解析到可用的服务器节点',
                width / 2,
                currentY + 116,
                {
                    fontFamily,
                    fontSize: 21,
                    fontWeight: 700,
                    fill: THEME.title,
                    anchor: 'middle'
                }
            ),
            svgText(
                options.host
                    ? ellipsisText(
                        `${options.host} 的 SRV、A 和 AAAA 记录均未解析成功`,
                        emptyCardWidth - 80,
                        14,
                        400
                    )
                    : 'SRV、A 和 AAAA 记录均未解析成功',
                width / 2,
                currentY + 154,
                {
                    fontFamily,
                    fontSize: 14,
                    fontWeight: 400,
                    fill: THEME.textSecondary,
                    anchor: 'middle'
                }
            )
        );
    } else {
        results.forEach(
            (result, index) => {
                const currentCardHeight =
                    cardHeights[index];
                svg.push(
                    drawServerCard(
                        result,
                        index,
                        outerPadding,
                        currentY,
                        width - outerPadding * 2,
                        currentCardHeight,
                        fontFamily,
                        options
                    )
                );
                currentY +=
                    currentCardHeight +
                    cardGap;
            }
        );
    }
    /* -----------------------------------------------------
     * 页脚
     * --------------------------------------------------- */
    const footerLineY =
        height - 38;
    svg.push(
        svgRect(
            outerPadding,
            footerLineY,
            width - outerPadding * 2,
            1,
            {
                fill: THEME.cardBorder
            }
        ),
        svgRect(
            outerPadding,
            footerLineY,
            82,
            2,
            {
                fill: THEME.primary
            }
        ),
        svgText(
            'Minecraft Node Monitor',
            outerPadding,
            footerLineY + 10,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 500,
                fill: THEME.footer
            }
        ),
        svgText(
            options.host
                ? ellipsisText(
                    options.host,
                    300,
                    12,
                    500
                )
                : 'MOTD QUERY',
            width - outerPadding,
            footerLineY + 10,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 600,
                fill: THEME.footer,
                anchor: 'end',
                letterSpacing: 0.8
            }
        ),
        '</svg>'
    );

    return svg.join('');
}

/* =========================================================
 * 生成 PNG
 * ======================================================= */

export function renderMinecraftMotdPng(
    results: MinecraftMotdQueryResult[],
    options: RenderMinecraftMotdOptions = {}
): Buffer {
    const svg =
        renderMinecraftMotdSvg(
            results,
            options
        );

    const scale = clamp(
        toNumber(
            options.scale,
            1
        ),
        0.5,
        4
    );

    const fontFiles: string[] = [];

    if (
        options.fontPath &&
        existsSync(options.fontPath)
    ) {
        fontFiles.push(
            options.fontPath
        );
    }

    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) ||
        'Noto Sans CJK SC';

    const renderer = new Resvg(
        svg,
        {
            fitTo: {
                mode: 'zoom',
                value: scale
            },
            font: {
                fontFiles,

                loadSystemFonts:
                    fontFiles.length === 0,

                defaultFontFamily:
                fontFamily
            }
        }
    );

    const png =
        renderer.render().asPng();

    return Buffer.from(
        png.buffer,
        png.byteOffset,
        png.byteLength
    );
}