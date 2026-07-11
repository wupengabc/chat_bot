import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';

/* =========================================================
 * 对外类型
 * ======================================================= */

export interface ChatMessageItem {
    id: string | number;
    username: string;
    content: string;
    address?: string | null;
    area?: string | null;
    message_type?: string | null;
    position?: string | null;
    create_time: string | number | Date;
}

export interface RenderChatHistoryOptions {
    /**
     * 图片宽度，限制为 620～2000。
     *
     * 默认值：900
     */
    width?: number;

    /**
     * 最多渲染的消息数量，限制为 1～200。
     *
     * 默认值：50
     */
    maxItems?: number;

    /**
     * 当前页码。
     *
     * 默认值：1
     */
    page?: number;

    /**
     * 总页数。
     *
     * 默认值：当前页码
     */
    totalPage?: number;

    /**
     * 主标题。
     */
    title?: string;

    /**
     * 副标题。
     */
    subtitle?: string;

    /**
     * 字体文件路径。
     *
     * 推荐提供 NotoSansCJKsc-Regular.otf、
     * SourceHanSansSC-Regular.otf 等中文字体。
     */
    fontPath?: string;

    /**
     * SVG 中使用的字体名称。
     *
     * 默认值：Noto Sans CJK SC
     */
    fontFamily?: string;

    /**
     * 是否显示地址。
     *
     * 默认值：true
     */
    showAddress?: boolean;

    /**
     * 是否显示区域。
     *
     * 默认值：true
     */
    showArea?: boolean;

    /**
     * 是否直接显示数据库中的原始 content。
     *
     * 默认值：false
     */
    showOriginalContent?: boolean;

    /**
     * 是否在渲染前按时间倒序排序。
     *
     * 默认值：true
     *
     * 如果数据库已经完成 ORDER BY 和分页，建议设置为 false。
     */
    sortByTime?: boolean;

    /**
     * 是否显示顶部标题。
     *
     * 默认值：true
     */
    showHeader?: boolean;

    /**
     * 是否显示底部信息。
     *
     * 默认值：true
     */
    showFooter?: boolean;

    /**
     * 单条消息最多显示多少行。
     *
     * 设置为 0 表示不限制。
     *
     * 默认值：8
     */
    maxMessageLines?: number;

    /**
     * PNG 输出缩放倍率。
     *
     * 1 表示原始尺寸，2 表示二倍图。
     *
     * 默认值：1
     */
    scale?: number;
}

export interface ParsedChatContent {
    server: string;
    role: string;
    username: string;
    message: string;
}

/* =========================================================
 * 内部类型
 * ======================================================= */

interface PreparedChatMessage {
    id: string;
    server: string;
    role: string;
    username: string;
    message: string;
    locationText: string;
    time: string;
    lines: string[];
    messageHeight: number;
    height: number;
}

/* =========================================================
 * 主题
 * ======================================================= */

const THEME = {
    pageBackground: '#f3ebe2',
    frame: '#d9c1aa',

    headerBackground: '#fff8f1',
    headerAccent: '#c45c26',
    headerLine: '#e7d2bf',

    title: '#3b2a1f',
    subtitle: '#8a6a55',

    cardBackground: '#fffdf9',
    cardBorder: '#e6d3c2',
    cardShadow: '#e9d8c7',
    cardMessageBackground: '#f7efe6',

    username: '#6b3b2a',
    message: '#3f3128',
    secondaryText: '#9a7b66',

    timeBackground: '#f0e0d0',
    timeText: '#7a5340',

    roleBackground: '#f4e4d4',
    roleText: '#8a4b2f',

    footerBackground: '#fff8f1',
    footerText: '#8a6a55',
    emptyText: '#9a7b66',

    defaultServer: '#8a7364'
} as const;

const SERVER_COLORS: Record<string, string> = {
    主城: '#c45c26',
    一区: '#2f8f74',
    二区: '#a64b6b',
    三区: '#7a5ea7',
    四区: '#b0783a',
    资源: '#c49a3c',
    登录: '#6f7d3d',
    未知: '#8a7364'
};

const ROLE_COLORS: Record<string, string> = {
    玩家: '#8a4b2f',
    管理员: '#a13d3d',
    管理: '#a13d3d',
    服主: '#8a3d6b',
    风华绝代: '#7a5ea7',
    洞灵主宰: '#2f8f74',
    赫影之辉: '#a64b6b',
    冰翼携尘: '#3d7ea6',
    幻翼终结者: '#8a5a2b'
};

const chinaTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

/* =========================================================
 * XML 工具
 * ======================================================= */

function escapeXml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function sanitizeFontFamily(value: unknown): string {
    return String(value ?? '')
        .replace(/[\\'"`;{}<>]/g, '')
        .trim();
}

function svgText(
    text: string,
    x: number,
    y: number,
    options: {
        fontSize: number;
        fontWeight?: number;
        fill: string;
        anchor?: 'start' | 'middle' | 'end';
        dominantBaseline?: 'middle' | 'hanging' | 'alphabetic';
        fontFamily: string;
    }
): string {
    return [
        '<text',
        ` x="${x}"`,
        ` y="${y}"`,
        ` font-family="${escapeXml(options.fontFamily)}"`,
        ` font-size="${options.fontSize}"`,
        ` font-weight="${options.fontWeight ?? 400}"`,
        ` fill="${options.fill}"`,
        ` text-anchor="${options.anchor ?? 'start'}"`,
        ` dominant-baseline="${options.dominantBaseline ?? 'middle'}"`,
        '>',
        escapeXml(text),
        '</text>'
    ].join('');
}

/* =========================================================
 * 顶部装饰图标
 * ======================================================= */

/**
 * 绘制左上角消息气泡图标。
 *
 * x、y 为图标左上角坐标。
 */
function drawMessageIcon(
    x: number,
    y: number,
    size: number
): string {
    const scale = size / 36;

    const shadowOffset = 2 * scale;
    const strokeWidth = Math.max(1, 1.3 * scale);

    const bodyX = x + 3 * scale;
    const bodyY = y + 3 * scale;
    const bodyWidth = 30 * scale;
    const bodyHeight = 21 * scale;
    const bodyRadius = 5 * scale;

    const tailStartX = x + 9 * scale;
    const tailStartY = y + 22 * scale;
    const tailBottomX = x + 7 * scale;
    const tailBottomY = y + 31 * scale;
    const tailEndX = x + 17 * scale;
    const tailEndY = y + 24 * scale;

    return [
        /*
         * 气泡阴影。
         */
        `<rect`,
        ` x="${bodyX}"`,
        ` y="${bodyY + shadowOffset}"`,
        ` width="${bodyWidth}"`,
        ` height="${bodyHeight}"`,
        ` rx="${bodyRadius}"`,
        ` fill="${THEME.headerLine}"`,
        ` opacity="0.9"`,
        `/>`,

        /*
         * 尾部阴影。
         */
        `<path`,
        ` d="M ${tailStartX} ${tailStartY + shadowOffset}`,
        ` L ${tailBottomX} ${tailBottomY + shadowOffset}`,
        ` L ${tailEndX} ${tailEndY + shadowOffset}`,
        ` Z"`,
        ` fill="${THEME.headerLine}"`,
        ` opacity="0.9"`,
        `/>`,

        /*
         * 气泡主体。
         */
        `<rect`,
        ` x="${bodyX}"`,
        ` y="${bodyY}"`,
        ` width="${bodyWidth}"`,
        ` height="${bodyHeight}"`,
        ` rx="${bodyRadius}"`,
        ` fill="${THEME.headerAccent}"`,
        ` stroke="#a94721"`,
        ` stroke-width="${strokeWidth}"`,
        `/>`,

        /*
         * 气泡尾部。
         */
        `<path`,
        ` d="M ${tailStartX} ${tailStartY}`,
        ` L ${tailBottomX} ${tailBottomY}`,
        ` L ${tailEndX} ${tailEndY}`,
        ` Z"`,
        ` fill="${THEME.headerAccent}"`,
        ` stroke="#a94721"`,
        ` stroke-width="${strokeWidth}"`,
        ` stroke-linejoin="round"`,
        `/>`,

        /*
         * 覆盖尾部与主体连接位置的边线。
         */
        `<rect`,
        ` x="${x + 8 * scale}"`,
        ` y="${y + 20 * scale}"`,
        ` width="${11 * scale}"`,
        ` height="${5 * scale}"`,
        ` fill="${THEME.headerAccent}"`,
        `/>`,

        /*
         * 第一条消息线。
         */
        `<rect`,
        ` x="${x + 9 * scale}"`,
        ` y="${y + 9 * scale}"`,
        ` width="${18 * scale}"`,
        ` height="${2.5 * scale}"`,
        ` rx="${1.25 * scale}"`,
        ` fill="${THEME.headerBackground}"`,
        `/>`,

        /*
         * 第二条消息线。
         */
        `<rect`,
        ` x="${x + 9 * scale}"`,
        ` y="${y + 15 * scale}"`,
        ` width="${13 * scale}"`,
        ` height="${2.5 * scale}"`,
        ` rx="${1.25 * scale}"`,
        ` fill="${THEME.headerBackground}"`,
        `/>`
    ].join('');
}

/**
 * 绘制右上角钻石图标。
 *
 * x、y 为图标左上角坐标。
 */
function drawDiamondIcon(
    x: number,
    y: number,
    size: number
): string {
    const centerX = x + size / 2;

    const topY = y + size * 0.05;
    const shoulderY = y + size * 0.36;
    const bottomY = y + size;

    const leftX = x;
    const rightX = x + size;

    const leftTopX = x + size * 0.24;
    const leftMiddleX = x + size * 0.39;
    const rightMiddleX = x + size * 0.61;
    const rightTopX = x + size * 0.76;

    const shadowOffset = Math.max(1, size * 0.06);
    const strokeWidth = Math.max(1, size * 0.035);

    return [
        /*
         * 钻石阴影。
         */
        `<path`,
        ` d="M ${leftX} ${shoulderY + shadowOffset}`,
        ` L ${leftTopX} ${topY + shadowOffset}`,
        ` L ${rightTopX} ${topY + shadowOffset}`,
        ` L ${rightX} ${shoulderY + shadowOffset}`,
        ` L ${centerX} ${bottomY + shadowOffset}`,
        ` Z"`,
        ` fill="${THEME.headerLine}"`,
        ` opacity="0.95"`,
        `/>`,

        /*
         * 钻石整体轮廓。
         */
        `<path`,
        ` d="M ${leftX} ${shoulderY}`,
        ` L ${leftTopX} ${topY}`,
        ` L ${rightTopX} ${topY}`,
        ` L ${rightX} ${shoulderY}`,
        ` L ${centerX} ${bottomY}`,
        ` Z"`,
        ` fill="${THEME.headerAccent}"`,
        ` stroke="#9f421f"`,
        ` stroke-width="${strokeWidth}"`,
        ` stroke-linejoin="round"`,
        `/>`,

        /*
         * 左上切面。
         */
        `<path`,
        ` d="M ${leftX} ${shoulderY}`,
        ` L ${leftTopX} ${topY}`,
        ` L ${leftMiddleX} ${shoulderY}`,
        ` Z"`,
        ` fill="#efad79"`,
        `/>`,

        /*
         * 上方中央切面。
         */
        `<path`,
        ` d="M ${leftTopX} ${topY}`,
        ` L ${rightTopX} ${topY}`,
        ` L ${rightMiddleX} ${shoulderY}`,
        ` L ${leftMiddleX} ${shoulderY}`,
        ` Z"`,
        ` fill="#f5c099"`,
        `/>`,

        /*
         * 右上切面。
         */
        `<path`,
        ` d="M ${rightTopX} ${topY}`,
        ` L ${rightX} ${shoulderY}`,
        ` L ${rightMiddleX} ${shoulderY}`,
        ` Z"`,
        ` fill="#d97945"`,
        `/>`,

        /*
         * 左下切面。
         */
        `<path`,
        ` d="M ${leftX} ${shoulderY}`,
        ` L ${leftMiddleX} ${shoulderY}`,
        ` L ${centerX} ${bottomY}`,
        ` Z"`,
        ` fill="#d78655"`,
        `/>`,

        /*
         * 中央下切面。
         */
        `<path`,
        ` d="M ${leftMiddleX} ${shoulderY}`,
        ` L ${rightMiddleX} ${shoulderY}`,
        ` L ${centerX} ${bottomY}`,
        ` Z"`,
        ` fill="${THEME.headerAccent}"`,
        `/>`,

        /*
         * 右下切面。
         */
        `<path`,
        ` d="M ${rightMiddleX} ${shoulderY}`,
        ` L ${rightX} ${shoulderY}`,
        ` L ${centerX} ${bottomY}`,
        ` Z"`,
        ` fill="#a94721"`,
        `/>`,

        /*
         * 顶部高光。
         */
        `<path`,
        ` d="M ${leftTopX + size * 0.07} ${topY + size * 0.05}`,
        ` L ${centerX - size * 0.03} ${topY + size * 0.05}`,
        ` L ${leftMiddleX + size * 0.03} ${shoulderY - size * 0.07}`,
        ` Z"`,
        ` fill="#ffe4d0"`,
        ` opacity="0.9"`,
        `/>`,

        /*
         * 钻石内部横向分割线。
         */
        `<path`,
        ` d="M ${leftX} ${shoulderY}`,
        ` L ${rightX} ${shoulderY}"`,
        ` fill="none"`,
        ` stroke="#a94721"`,
        ` stroke-width="${Math.max(0.7, strokeWidth * 0.7)}"`,
        ` opacity="0.7"`,
        `/>`
    ].join('');
}

/* =========================================================
 * 文本清理
 * ======================================================= */

function removeMinecraftFormatCodes(value: unknown): string {
    return String(value ?? '').replace(
        /[§&][0-9a-fk-or]/gi,
        ''
    );
}

function stripDecorativeGlyphs(value: string): string {
    return value
        .replace(/[\uE000-\uF8FF]/g, '')
        .replace(/[\u{F0000}-\u{FFFFD}]/gu, '')
        .replace(/[\u{100000}-\u{10FFFD}]/gu, '')
        .replace(
            /[\uFFFD\u25A0\u25A1\u25AA\u25AB\u25FB\u25FC\u25FD\u25FE\u2B1B\u2B1C\uFFEE]/g,
            ''
        )
        .replace(/[\u2000-\u200D\u2060\uFEFF]/g, '')
        .replace(/[◈◆◇❖✦✧★☆❀❁꧁꧂丨｜·•]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeChatText(value: unknown): string {
    return removeMinecraftFormatCodes(value)
        .replace(/\u00a0/g, ' ')
        .replace(/\u3000/g, ' ')
        .replace(/[\u2000-\u200D\u2060\uFEFF]/g, '')
        .replace(/\r\n?/g, '\n')
        .trim();
}

/* =========================================================
 * 服务器名称
 * ======================================================= */

function getServerFromArea(area: unknown): string {
    const text = normalizeChatText(area);

    if (!text) return '未知';

    if (text.includes('主城') || text.includes('大厅')) {
        return '主城';
    }

    if (text.includes('生存一区') || text.includes('一区')) {
        return '一区';
    }

    if (text.includes('生存二区') || text.includes('二区')) {
        return '二区';
    }

    if (text.includes('生存三区') || text.includes('三区')) {
        return '三区';
    }

    if (text.includes('生存四区') || text.includes('四区')) {
        return '四区';
    }

    if (text.includes('资源世界') || text.includes('资源')) {
        return '资源';
    }

    if (text.includes('登录')) {
        return '登录';
    }

    return (
        text
            .replace(/大区$/u, '')
            .replace(/服务器$/u, '')
            .trim() || '未知'
    );
}

function normalizeServerName(
    server: unknown,
    area: unknown
): string {
    const text = normalizeChatText(server);

    if (!text) {
        return getServerFromArea(area);
    }

    if (text.includes('主城') || text.includes('大厅')) {
        return '主城';
    }

    if (text.includes('资源')) return '资源';
    if (text.includes('登录')) return '登录';
    if (text.includes('一区')) return '一区';
    if (text.includes('二区')) return '二区';
    if (text.includes('三区')) return '三区';
    if (text.includes('四区')) return '四区';

    return (
        text
            .replace(/大区$/u, '')
            .replace(/服务器$/u, '')
            .trim() || getServerFromArea(area)
    );
}

/* =========================================================
 * 聊天内容解析
 * ======================================================= */

function takeLeadingBracket(
    input: string
): { value: string; rest: string } | null {
    const text = input.trimStart();

    const bracketPairs: Record<string, string> = {
        '[': ']',
        '［': '］',
        '【': '】',
        '「': '」',
        '『': '』'
    };

    const closingBracket = bracketPairs[text[0]];

    if (!closingBracket) {
        return null;
    }

    const closingIndex = text.indexOf(closingBracket, 1);

    if (closingIndex < 0) {
        return null;
    }

    const value = text.slice(1, closingIndex).trim();

    if (!value) {
        return null;
    }

    return {
        value,
        rest: text.slice(closingIndex + 1).trimStart()
    };
}

function findMessageSeparator(
    text: string
): { index: number; length: number } | null {
    const separators = [
        '➜',
        '→',
        '»',
        '›',
        '＞',
        '≫',
        '=>',
        '->',
        '：',
        '>',
        ':'
    ];

    let result: { index: number; length: number } | null = null;

    for (const separator of separators) {
        const index = text.indexOf(separator);

        if (
            index >= 0 &&
            (
                result === null ||
                index < result.index ||
                (
                    index === result.index &&
                    separator.length > result.length
                )
            )
        ) {
            result = {
                index,
                length: separator.length
            };
        }
    }

    return result;
}

function stripLeadingSeparator(text: string): string {
    return text
        .trimStart()
        .replace(/^(?:➜|→|»|›|＞|≫|=>|->|：|>|:)\s*/u, '')
        .trim();
}

function normalizeRole(value: unknown): string {
    let role = normalizeChatText(value);

    role = role
        .replace(
            /^(?:\[|［|【|「|『|\(|（)|(?:\]|］|】|」|』|\)|）)$/gu,
            ''
        )
        .trim();

    role = stripDecorativeGlyphs(role);

    return role || '玩家';
}

export function parseChatContent(
    content: unknown,
    fallbackUsername: unknown,
    area: unknown
): ParsedChatContent {
    const originalText = normalizeChatText(content);
    const databaseUsername = normalizeChatText(fallbackUsername);

    let rest = originalText;
    let server = '';
    let role = '';

    const firstTag = takeLeadingBracket(rest);

    if (firstTag) {
        server = firstTag.value;
        rest = firstTag.rest;

        const secondTag = takeLeadingBracket(rest);

        if (secondTag) {
            role = secondTag.value;
            rest = secondTag.rest;
        }
    }

    let username = databaseUsername;
    let message = rest;

    if (databaseUsername) {
        const usernameIndex = rest
            .toLocaleLowerCase()
            .lastIndexOf(databaseUsername.toLocaleLowerCase());

        if (usernameIndex >= 0) {
            const beforeUsername = rest
                .slice(0, usernameIndex)
                .trim();

            const afterUsername = rest.slice(
                usernameIndex + databaseUsername.length
            );

            if (beforeUsername && !role) {
                const roleTag = takeLeadingBracket(beforeUsername);

                role =
                    roleTag && !roleTag.rest
                        ? roleTag.value
                        : beforeUsername;
            }

            username = rest.slice(
                usernameIndex,
                usernameIndex + databaseUsername.length
            );

            message = stripLeadingSeparator(afterUsername);
        }
    }

    if (!databaseUsername || message === rest) {
        const separator = findMessageSeparator(rest);

        if (separator) {
            const sender = rest
                .slice(0, separator.index)
                .trim();

            message = rest
                .slice(separator.index + separator.length)
                .trim();

            const senderRole = takeLeadingBracket(sender);

            if (senderRole) {
                role ||= senderRole.value;
                username ||= senderRole.rest;
            } else {
                username ||= sender;
            }
        }
    }

    return {
        server: normalizeServerName(server, area),
        role: normalizeRole(role),
        username: normalizeChatText(username) || 'unknown',
        message: normalizeChatText(message)
    };
}

/* =========================================================
 * 时间处理
 * ======================================================= */

function getTimestamp(
    value: string | number | Date
): number {
    const timestamp =
        value instanceof Date
            ? value.getTime()
            : new Date(value).getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatChinaTime(
    value: string | number | Date
): string {
    const timestamp = getTimestamp(value);

    if (!timestamp) {
        return '时间未知';
    }

    const values: Record<string, string> = {};

    for (
        const part of chinaTimeFormatter.formatToParts(
        new Date(timestamp)
    )
        ) {
        if (part.type !== 'literal') {
            values[part.type] = part.value;
        }
    }

    return [
        values.year,
        '-',
        values.month,
        '-',
        values.day,
        ' ',
        values.hour,
        ':',
        values.minute,
        ':',
        values.second
    ].join('');
}

/* =========================================================
 * 无 Canvas 文本宽度估算
 * ======================================================= */

function isFullWidthCharacter(character: string): boolean {
    const codePoint = character.codePointAt(0) ?? 0;

    return (
        codePoint >= 0x1100 &&
        (
            codePoint <= 0x115f ||
            codePoint === 0x2329 ||
            codePoint === 0x232a ||
            (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
            (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
            (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
            (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
            (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
            (codePoint >= 0xff00 && codePoint <= 0xff60) ||
            (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
            (codePoint >= 0x1f300 && codePoint <= 0x1faff)
        )
    );
}

function estimateCharacterWidth(
    character: string,
    fontSize: number
): number {
    if (character === '\t') {
        return fontSize * 2;
    }

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
        return fontSize * 0.62;
    }

    if (/[a-z]/u.test(character)) {
        return fontSize * 0.54;
    }

    if (/[,.;:'"`!|ilI()[\]{}]/u.test(character)) {
        return fontSize * 0.32;
    }

    return fontSize * 0.55;
}

function estimateTextWidth(
    text: string,
    fontSize: number,
    fontWeight = 400
): number {
    let width = 0;

    for (const character of text) {
        width += estimateCharacterWidth(character, fontSize);
    }

    if (fontWeight >= 700) {
        width *= 1.04;
    }

    return width;
}

function ellipsisText(
    text: string,
    maxWidth: number,
    fontSize: number,
    fontWeight = 400
): string {
    if (estimateTextWidth(text, fontSize, fontWeight) <= maxWidth) {
        return text;
    }

    const suffix = '…';
    const suffixWidth = estimateTextWidth(
        suffix,
        fontSize,
        fontWeight
    );

    const characters = Array.from(text);

    let width = 0;
    let result = '';

    for (const character of characters) {
        const characterWidth = estimateCharacterWidth(
            character,
            fontSize
        );

        if (width + characterWidth + suffixWidth > maxWidth) {
            break;
        }

        result += character;
        width += characterWidth;
    }

    return result + suffix;
}

function wrapText(
    text: string,
    maxWidth: number,
    fontSize: number,
    maxLines: number
): string[] {
    const paragraphs = String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split('\n');

    const lines: string[] = [];

    for (const paragraph of paragraphs) {
        if (!paragraph) {
            lines.push('');
            continue;
        }

        let currentLine = '';
        let currentWidth = 0;

        for (const character of Array.from(paragraph)) {
            const characterWidth = estimateCharacterWidth(
                character,
                fontSize
            );

            if (
                currentLine &&
                currentWidth + characterWidth > maxWidth
            ) {
                lines.push(currentLine);
                currentLine = character;
                currentWidth = characterWidth;
            } else {
                currentLine += character;
                currentWidth += characterWidth;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }
    }

    if (lines.length === 0) {
        lines.push('');
    }

    if (maxLines > 0 && lines.length > maxLines) {
        const limitedLines = lines.slice(0, maxLines);

        limitedLines[maxLines - 1] = ellipsisText(
            limitedLines[maxLines - 1] + '…',
            maxWidth,
            fontSize
        );

        return limitedLines;
    }

    return lines;
}

/* =========================================================
 * 颜色和徽章
 * ======================================================= */

function getServerColor(server: string): string {
    return SERVER_COLORS[server] ?? THEME.defaultServer;
}

function getRoleColor(role: string): string {
    if (ROLE_COLORS[role]) {
        return ROLE_COLORS[role];
    }

    for (const [name, color] of Object.entries(ROLE_COLORS)) {
        if (role.includes(name)) {
            return color;
        }
    }

    return THEME.roleText;
}

function createBadge(
    text: string,
    x: number,
    centerY: number,
    options: {
        maxWidth: number;
        height: number;
        fontSize: number;
        fontWeight: number;
        background: string;
        foreground: string;
        fontFamily: string;
    }
): {
    svg: string;
    width: number;
} {
    const horizontalPadding = 9;

    const safeText = ellipsisText(
        text,
        Math.max(
            1,
            options.maxWidth - horizontalPadding * 2
        ),
        options.fontSize,
        options.fontWeight
    );

    const width = Math.min(
        options.maxWidth,
        Math.ceil(
            estimateTextWidth(
                safeText,
                options.fontSize,
                options.fontWeight
            ) +
            horizontalPadding * 2
        )
    );

    const y = centerY - options.height / 2;

    return {
        width,
        svg: [
            `<rect x="${x}" y="${y}" width="${width}"`,
            ` height="${options.height}" rx="3"`,
            ` fill="${options.background}"/>`,
            svgText(
                safeText,
                x + width / 2,
                centerY,
                {
                    fontSize: options.fontSize,
                    fontWeight: options.fontWeight,
                    fill: options.foreground,
                    anchor: 'middle',
                    fontFamily: options.fontFamily
                }
            )
        ].join('')
    };
}

/* =========================================================
 * SVG 主渲染
 * ======================================================= */

export function renderChatHistorySvg(
    inputItems: ChatMessageItem[],
    options: RenderChatHistoryOptions = {}
): string {
    if (!Array.isArray(inputItems)) {
        throw new TypeError('inputItems 必须是数组');
    }

    const width = Math.max(
        620,
        Math.min(
            2000,
            Math.floor(options.width ?? 900)
        )
    );

    const maxItems = Math.max(
        1,
        Math.min(
            200,
            Math.floor(options.maxItems ?? 50)
        )
    );

    const page = Math.max(
        1,
        Math.floor(options.page ?? 1)
    );

    const totalPage = Math.max(
        page,
        Math.floor(options.totalPage ?? page)
    );

    const maxMessageLines = Math.max(
        0,
        Math.floor(options.maxMessageLines ?? 8)
    );

    const title =
        options.title ?? '服务器聊天记录';

    const subtitle =
        options.subtitle ?? 'SERVER CHAT HISTORY';

    const fontFamily =
        sanitizeFontFamily(options.fontFamily) ||
        'Noto Sans CJK SC';

    const showAddress =
        options.showAddress !== false;

    const showArea =
        options.showArea !== false;

    const showOriginalContent =
        options.showOriginalContent === true;

    const sortByTime =
        options.sortByTime !== false;

    const showHeader =
        options.showHeader !== false;

    const showFooter =
        options.showFooter !== false;

    let items: ChatMessageItem[];

    if (sortByTime) {
        items = inputItems
            .slice()
            .sort(
                (left, right) =>
                    getTimestamp(right.create_time) -
                    getTimestamp(left.create_time)
            )
            .slice(0, maxItems);
    } else {
        items = inputItems.slice(0, maxItems);
    }

    const outerPadding = 16;
    const headerHeight = showHeader ? 96 : 0;
    const footerHeight = showFooter ? 52 : 0;
    const cardGap = 12;

    const cardWidth =
        width - outerPadding * 2;

    const cardPaddingX = 16;
    const cardPaddingTop = 14;
    const cardPaddingBottom = 12;

    const contentWidth =
        cardWidth - cardPaddingX * 2;

    const metaRowHeight = 26;
    const metaMessageGap = 12;
    const messageFontSize = 17;
    const lineHeight = 26;
    const messageTopPad = 8;
    const messageBottomPad = 8;
    const locationGap = 12;
    const locationLineHeight = 20;

    const preparedItems: PreparedChatMessage[] = items.map(
        (source) => {
            const parsed = parseChatContent(
                source.content,
                source.username,
                source.area
            );

            const message = showOriginalContent
                ? normalizeChatText(source.content)
                : parsed.message || '（空消息）';

            const lines = wrapText(
                message,
                contentWidth - 12,
                messageFontSize,
                maxMessageLines
            );

            const messageHeight =
                messageTopPad +
                lines.length * lineHeight +
                messageBottomPad;

            const locationParts: string[] = [];

            if (showArea) {
                const area = normalizeChatText(
                    source.area
                );

                if (area) {
                    locationParts.push(area);
                }
            }

            if (showAddress) {
                const address = normalizeChatText(
                    source.address
                );

                if (address) {
                    locationParts.push(address);
                }
            }

            const locationText =
                locationParts.join(' · ');

            const height =
                cardPaddingTop +
                metaRowHeight +
                metaMessageGap +
                messageHeight +
                (
                    locationText
                        ? locationGap + locationLineHeight
                        : 0
                ) +
                cardPaddingBottom;

            return {
                id: String(source.id ?? ''),
                server: parsed.server,
                role: parsed.role,
                username: parsed.username,
                message,
                locationText,
                time: formatChinaTime(
                    source.create_time
                ),
                lines,
                messageHeight,
                height
            };
        }
    );

    const cardsHeight = preparedItems.reduce(
        (total, item) => total + item.height,
        0
    );

    const gapsHeight =
        Math.max(
            0,
            preparedItems.length - 1
        ) * cardGap;

    const emptyStateHeight =
        preparedItems.length === 0
            ? 96
            : 0;

    const height =
        outerPadding +
        headerHeight +
        cardsHeight +
        gapsHeight +
        emptyStateHeight +
        footerHeight +
        outerPadding;

    const svg: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` width="${width}"`,
        ` height="${height}"`,
        ` viewBox="0 0 ${width} ${height}">`,
        `<rect`,
        ` width="${width}"`,
        ` height="${height}"`,
        ` fill="${THEME.pageBackground}"`,
        `/>`,
        `<rect`,
        ` x="${outerPadding - 0.5}"`,
        ` y="${outerPadding - 0.5}"`,
        ` width="${width - outerPadding * 2 + 1}"`,
        ` height="${height - outerPadding * 2 + 1}"`,
        ` fill="none"`,
        ` stroke="${THEME.frame}"`,
        `/>`
    ];
    let currentY = outerPadding;
    /* =====================================================
     * 顶部标题
     * =================================================== */
    if (showHeader) {
        const headerContentHeight =
            headerHeight - 10;
        const messageIconSize = 34;
        const diamondIconSize = 31;
        const horizontalIconPadding = 20;
        const messageIconX =
            outerPadding + horizontalIconPadding;
        const messageIconY =
            currentY + 19;
        const diamondIconX =
            outerPadding +
            cardWidth -
            horizontalIconPadding -
            diamondIconSize;
        const diamondIconY =
            currentY + 20;
        /*
         * 为左右图标预留空间，防止标题覆盖图标。
         */
        const titleLeftBoundary =
            messageIconX +
            messageIconSize +
            18;
        const titleRightBoundary =
            diamondIconX - 18;
        const titleMaxWidth = Math.max(
            80,
            titleRightBoundary - titleLeftBoundary
        );
        const displayTitle = ellipsisText(
            title,
            titleMaxWidth,
            28,
            700
        );
        const subtitleText =
            `${subtitle} · 第 ${page} / ${totalPage} 页 · ` +
            `本页 ${preparedItems.length} 条`;
        const subtitleMaxWidth = Math.max(
            80,
            cardWidth -
            horizontalIconPadding * 2 -
            20
        );
        const displaySubtitle = ellipsisText(
            subtitleText,
            subtitleMaxWidth,
            12,
            500
        );
        svg.push(
            /*
             * Header 背景。
             */
            `<rect`,
            ` x="${outerPadding}"`,
            ` y="${currentY}"`,
            ` width="${cardWidth}"`,
            ` height="${headerContentHeight}"`,
            ` fill="${THEME.headerBackground}"`,
            `/>`,
            /*
             * 顶部强调线。
             */
            `<rect`,
            ` x="${outerPadding}"`,
            ` y="${currentY}"`,
            ` width="${cardWidth}"`,
            ` height="4"`,
            ` fill="${THEME.headerAccent}"`,
            `/>`,
            /*
             * 左上角消息图标。
             */
            drawMessageIcon(
                messageIconX,
                messageIconY,
                messageIconSize
            ),
            /*
             * 右上角钻石图标。
             */
            drawDiamondIcon(
                diamondIconX,
                diamondIconY,
                diamondIconSize
            ),
            /*
             * 主标题。
             */
            svgText(
                displayTitle,
                width / 2,
                currentY + 38,
                {
                    fontSize: 28,
                    fontWeight: 700,
                    fill: THEME.title,
                    anchor: 'middle',
                    fontFamily
                }
            ),
            /*
             * 标题下方浅色长线。
             */
            `<rect`,
            ` x="${width / 2 - 90}"`,
            ` y="${currentY + 56}"`,
            ` width="180"`,
            ` height="2"`,
            ` fill="${THEME.headerLine}"`,
            `/>`,
            /*
             * 标题下方强调短线。
             */
            `<rect`,
            ` x="${width / 2 - 14}"`,
            ` y="${currentY + 55}"`,
            ` width="28"`,
            ` height="4"`,
            ` fill="${THEME.headerAccent}"`,
            `/>`,
            /*
             * 副标题和分页信息。
             */
            svgText(
                displaySubtitle,
                width / 2,
                currentY + 74,
                {
                    fontSize: 12,
                    fontWeight: 500,
                    fill: THEME.subtitle,
                    anchor: 'middle',
                    fontFamily
                }
            )
        );
        currentY += headerHeight;
    }
    /* =====================================================
     * 空状态
     * =================================================== */
    if (preparedItems.length === 0) {
        svg.push(
            `<rect`,
            ` x="${outerPadding}"`,
            ` y="${currentY}"`,
            ` width="${cardWidth}"`,
            ` height="84"`,
            ` fill="${THEME.cardBackground}"`,
            ` stroke="${THEME.cardBorder}"`,
            `/>`,
            svgText(
                '当前页面没有聊天记录',
                width / 2,
                currentY + 42,
                {
                    fontSize: 17,
                    fontWeight: 600,
                    fill: THEME.emptyText,
                    anchor: 'middle',
                    fontFamily
                }
            )
        );
        currentY += emptyStateHeight;
    }
    /* =====================================================
     * 消息卡片
     * =================================================== */
    for (
        let itemIndex = 0;
        itemIndex < preparedItems.length;
        itemIndex++
    ) {
        const item = preparedItems[itemIndex];
        const cardX = outerPadding;
        const cardY = currentY;
        const contentX =
            cardX + cardPaddingX;
        const contentRight =
            cardX +
            cardWidth -
            cardPaddingX;
        const serverColor =
            getServerColor(item.server);
        const roleColor =
            getRoleColor(item.role);
        svg.push(
            /*
             * 卡片阴影。
             */
            `<rect`,
            ` x="${cardX}"`,
            ` y="${cardY + 2}"`,
            ` width="${cardWidth}"`,
            ` height="${item.height}"`,
            ` fill="${THEME.cardShadow}"`,
            `/>`,
            /*
             * 卡片主体。
             */
            `<rect`,
            ` x="${cardX}"`,
            ` y="${cardY}"`,
            ` width="${cardWidth}"`,
            ` height="${item.height}"`,
            ` fill="${THEME.cardBackground}"`,
            ` stroke="${THEME.cardBorder}"`,
            `/>`,
            /*
             * 卡片左侧服务器色条。
             */
            `<rect`,
            ` x="${cardX}"`,
            ` y="${cardY}"`,
            ` width="5"`,
            ` height="${item.height}"`,
            ` fill="${serverColor}"`,
            `/>`
        );
        const metaY =
            cardY + cardPaddingTop;
        const metaCenterY =
            metaY + metaRowHeight / 2;
        const timeWidth = Math.ceil(
            estimateTextWidth(
                item.time,
                13,
                500
            ) + 18
        );
        const timeX =
            contentRight - timeWidth;
        const availableMetaRight =
            timeX - 12;
        let metaX = contentX;
        /*
         * 服务器徽章。
         */
        const serverBadge = createBadge(
            item.server,
            metaX,
            metaCenterY,
            {
                maxWidth: 86,
                height: 24,
                fontSize: 13,
                fontWeight: 700,
                background: serverColor,
                foreground: '#fffdf9',
                fontFamily
            }
        );
        svg.push(serverBadge.svg);
        metaX +=
            serverBadge.width + 8;
        /*
         * 身份徽章。
         */
        const roleMaxWidth = Math.max(
            48,
            Math.min(
                160,
                availableMetaRight -
                metaX -
                78
            )
        );
        const roleBadge = createBadge(
            item.role,
            metaX,
            metaCenterY,
            {
                maxWidth: roleMaxWidth,
                height: 24,
                fontSize: 13,
                fontWeight: 700,
                background: THEME.roleBackground,
                foreground: roleColor,
                fontFamily
            }
        );
        svg.push(roleBadge.svg);
        metaX +=
            roleBadge.width + 11;
        /*
         * 用户名。
         */
        const username = ellipsisText(
            item.username,
            Math.max(
                20,
                availableMetaRight - metaX
            ),
            17,
            700
        );
        svg.push(
            svgText(
                username,
                metaX,
                metaCenterY,
                {
                    fontSize: 17,
                    fontWeight: 700,
                    fill: THEME.username,
                    fontFamily
                }
            ),
            /*
             * 时间徽章背景。
             */
            `<rect`,
            ` x="${timeX}"`,
            ` y="${metaCenterY - 12}"`,
            ` width="${timeWidth}"`,
            ` height="24"`,
            ` rx="3"`,
            ` fill="${THEME.timeBackground}"`,
            `/>`,
            /*
             * 时间文本。
             */
            svgText(
                item.time,
                timeX + timeWidth / 2,
                metaCenterY,
                {
                    fontSize: 13,
                    fontWeight: 500,
                    fill: THEME.timeText,
                    anchor: 'middle',
                    fontFamily
                }
            )
        );
        /*
         * 消息内容区域。
         */
        const messageBlockY =
            metaY +
            metaRowHeight +
            metaMessageGap;
        svg.push(
            `<rect`,
            ` x="${contentX}"`,
            ` y="${messageBlockY}"`,
            ` width="${contentWidth}"`,
            ` height="${item.messageHeight}"`,
            ` fill="${THEME.cardMessageBackground}"`,
            `/>`
        );
        /*
         * 消息文本。
         */
        for (
            let lineIndex = 0;
            lineIndex < item.lines.length;
            lineIndex++
        ) {
            svg.push(
                svgText(
                    item.lines[lineIndex],
                    contentX + 6,
                    messageBlockY +
                    messageTopPad +
                    lineIndex * lineHeight +
                    lineHeight / 2,
                    {
                        fontSize: messageFontSize,
                        fontWeight: 500,
                        fill: THEME.message,
                        fontFamily
                    }
                )
            );
        }
        /*
         * 区域和地址。
         */
        if (item.locationText) {
            const location = ellipsisText(
                item.locationText,
                contentWidth,
                13,
                500
            );
            svg.push(
                svgText(
                    location,
                    contentRight,
                    messageBlockY +
                    item.messageHeight +
                    locationGap +
                    locationLineHeight / 2,
                    {
                        fontSize: 13,
                        fontWeight: 500,
                        fill: THEME.secondaryText,
                        anchor: 'end',
                        fontFamily
                    }
                )
            );
        }
        currentY += item.height;
        if (
            itemIndex <
            preparedItems.length - 1
        ) {
            currentY += cardGap;
        }
    }
    /* =====================================================
     * 底部信息
     * =================================================== */
    if (showFooter) {
        const footerY =
            height -
            outerPadding -
            footerHeight +
            8;
        const footerHeightInner =
            footerHeight - 8;
        const footerCenterY =
            footerY +
            footerHeightInner / 2;
        svg.push(
            /*
             * Footer 背景。
             */
            `<rect`,
            ` x="${outerPadding}"`,
            ` y="${footerY}"`,
            ` width="${cardWidth}"`,
            ` height="${footerHeightInner}"`,
            ` fill="${THEME.footerBackground}"`,
            `/>`,
            /*
             * Footer 顶部强调线。
             */
            `<rect`,
            ` x="${outerPadding}"`,
            ` y="${footerY}"`,
            ` width="${cardWidth}"`,
            ` height="2"`,
            ` fill="${THEME.headerAccent}"`,
            `/>`,
            /*
             * Footer 左侧文本。
             */
            svgText(
                '服务器实时聊天',
                outerPadding + 16,
                footerCenterY,
                {
                    fontSize: 13,
                    fontWeight: 600,
                    fill: THEME.footerText,
                    fontFamily
                }
            ),
            /*
             * Footer 右侧文本。
             */
            svgText(
                `北京时间 · 第 ${page} / ${totalPage} 页 · ` +
                `${preparedItems.length} 条消息`,
                width - outerPadding - 16,
                footerCenterY,
                {
                    fontSize: 13,
                    fontWeight: 600,
                    fill: THEME.footerText,
                    anchor: 'end',
                    fontFamily
                }
            )
        );
    }
    svg.push('</svg>');

    return svg.join('');
}

/* =========================================================
 * PNG 渲染
 * ======================================================= */

export function renderChatHistory(
    inputItems: ChatMessageItem[],
    options: RenderChatHistoryOptions = {}
): Buffer {
    const svg = renderChatHistorySvg(
        inputItems,
        options
    );

    const scale = Math.max(
        0.5,
        Math.min(
            4,
            Number(options.scale) || 1
        )
    );

    const fontFiles: string[] = [];

    if (
        options.fontPath &&
        existsSync(options.fontPath)
    ) {
        fontFiles.push(options.fontPath);
    }

    const renderer = new Resvg(svg, {
        fitTo: {
            mode: 'zoom',
            value: scale
        },
        font: {
            fontFiles,
            loadSystemFonts:
                fontFiles.length === 0,
            defaultFontFamily:
                sanitizeFontFamily(
                    options.fontFamily
                ) ||
                'Noto Sans CJK SC'
        }
    });

    return Buffer.from(
        renderer.render().asPng()
    );
}