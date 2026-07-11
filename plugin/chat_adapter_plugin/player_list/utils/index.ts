import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';

/* =========================================================
 * 类型定义
 * ======================================================= */

export interface PlayerListItem {
    name: string;
    ping?: string | number;
}

export interface RenderPlayerListOptions {
    /**
     * 图片宽度。
     *
     * 默认：820
     */
    width?: number;

    /**
     * 主标题。
     *
     * 默认：ONLINE PLAYERS
     */
    title?: string;

    /**
     * 副标题。
     *
     * 默认：在线玩家列表
     */
    subtitle?: string;

    /**
     * 自定义字体文件路径。
     */
    fontPath?: string;

    /**
     * 字体文件内部声明的字体家族名称。
     *
     * 默认：Noto Sans CJK SC
     */
    fontFamily?: string;

    /**
     * 分组显示顺序。
     */
    groupOrder?: string[];

    /**
     * 每行显示的玩家数量。
     *
     * 最小：1
     * 最大：4
     * 默认：2
     */
    columns?: number;

    /**
     * 分组标题文字垂直偏移。
     *
     * 正数向下，负数向上。
     *
     * 默认：-1
     */
    groupTextOffsetY?: number;

    /**
     * 分组标题竖线垂直偏移。
     *
     * 正数向下，负数向上。
     *
     * 默认：0
     */
    groupBarOffsetY?: number;

    /**
     * PNG 输出缩放倍率。
     *
     * 最小：0.5
     * 最大：4
     * 默认：1
     */
    scale?: number;
}

export interface ParsedPlayer {
    group: string;
    username: string;
    ping: string;
    pingNumber: number;
}

interface PreparedGroup {
    group: string;
    players: ParsedPlayer[];
    rowCount: number;
    height: number;
    color: string;
}

interface SvgTextOptions {
    fontFamily: string;
    fontSize: number;
    fontWeight?: number;
    fill: string;
    anchor?: 'start' | 'middle' | 'end';
}

/* =========================================================
 * 排序器
 * ======================================================= */

const usernameCollator = new Intl.Collator('en', {
    numeric: true,
    sensitivity: 'base'
});

const groupCollator = new Intl.Collator('zh-CN', {
    numeric: true,
    sensitivity: 'base'
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

/**
 * 生成可用于 SVG id 的安全字符串。
 */
function sanitizeSvgId(value: unknown): string {
    return String(value ?? '')
        .replace(/[^a-zA-Z0-9_-]/g, '-');
}

/* =========================================================
 * SVG 基础工具
 * ======================================================= */

function svgRect(
    x: number,
    y: number,
    width: number,
    height: number,
    options: {
        fill?: string;
        stroke?: string;
        strokeWidth?: number;
        rx?: number;
    } = {}
): string {
    const output = [
        `<rect x="${x}"`,
        ` y="${y}"`,
        ` width="${Math.max(0, width)}"`,
        ` height="${Math.max(0, height)}"`
    ];

    if (options.rx !== undefined) {
        output.push(` rx="${options.rx}"`);
    }

    output.push(
        ` fill="${options.fill ?? 'none'}"`
    );

    if (options.stroke) {
        output.push(
            ` stroke="${options.stroke}"`
        );

        output.push(
            ` stroke-width="${options.strokeWidth ?? 1}"`
        );
    }

    output.push('/>');

    return output.join('');
}

/**
 * 使用顶部基线绘制文字。
 */
function svgTopText(
    text: string,
    x: number,
    y: number,
    options: SvgTextOptions
): string {
    return [
        `<text x="${x}" y="${y}"`,
        ` font-family="${escapeXml(options.fontFamily)}"`,
        ` font-size="${options.fontSize}"`,
        ` font-weight="${options.fontWeight ?? 400}"`,
        ` fill="${options.fill}"`,
        ` text-anchor="${options.anchor ?? 'start'}"`,
        ' dominant-baseline="text-before-edge">',
        escapeXml(text),
        '</text>'
    ].join('');
}

/**
 * 使用垂直居中基线绘制文字。
 */
function svgMiddleText(
    text: string,
    x: number,
    y: number,
    options: SvgTextOptions
): string {
    return [
        `<text x="${x}" y="${y}"`,
        ` font-family="${escapeXml(options.fontFamily)}"`,
        ` font-size="${options.fontSize}"`,
        ` font-weight="${options.fontWeight ?? 400}"`,
        ` fill="${options.fill}"`,
        ` text-anchor="${options.anchor ?? 'start'}"`,
        ' dominant-baseline="central">',
        escapeXml(text),
        '</text>'
    ].join('');
}

function svgClipPath(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number
): string {
    return [
        `<clipPath id="${sanitizeSvgId(id)}">`,
        `<rect x="${x}"`,
        ` y="${y}"`,
        ` width="${Math.max(0, width)}"`,
        ` height="${Math.max(0, height)}"/>`,
        '</clipPath>'
    ].join('');
}

/* =========================================================
 * 无 Canvas 文本宽度估算
 * ======================================================= */

function isFullWidthCharacter(
    character: string
): boolean {
    const codePoint =
        character.codePointAt(0) ?? 0;

    return (
        codePoint >= 0x1100 &&
        (
            codePoint <= 0x115f ||
            codePoint === 0x2329 ||
            codePoint === 0x232a ||
            (
                codePoint >= 0x2e80 &&
                codePoint <= 0xa4cf
            ) ||
            (
                codePoint >= 0xac00 &&
                codePoint <= 0xd7a3
            ) ||
            (
                codePoint >= 0xf900 &&
                codePoint <= 0xfaff
            ) ||
            (
                codePoint >= 0xfe10 &&
                codePoint <= 0xfe19
            ) ||
            (
                codePoint >= 0xfe30 &&
                codePoint <= 0xfe6f
            ) ||
            (
                codePoint >= 0xff00 &&
                codePoint <= 0xff60
            ) ||
            (
                codePoint >= 0xffe0 &&
                codePoint <= 0xffe6
            ) ||
            (
                codePoint >= 0x1f300 &&
                codePoint <= 0x1faff
            )
        )
    );
}

function getFontWeightFactor(
    fontWeight: number
): number {
    if (fontWeight >= 700) {
        return 1.1;
    }

    if (fontWeight >= 600) {
        return 1.08;
    }

    if (fontWeight >= 500) {
        return 1.04;
    }

    return 1;
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
        return fontSize * 0.94;
    }

    if (/[A-Z0-9]/u.test(character)) {
        return fontSize * 0.66;
    }

    if (/[a-z]/u.test(character)) {
        return fontSize * 0.56;
    }

    if (/[,.;:'"`!|ilI()[\]{}]/u.test(character)) {
        return fontSize * 0.34;
    }

    return fontSize * 0.58;
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

    return (
        width *
        getFontWeightFactor(fontWeight)
    );
}

/**
 * 对文字执行保守截断。
 *
 * 最后的 clipPath 仍会保证实际渲染结果不会溢出。
 */
function ellipsizeText(
    value: unknown,
    maxWidth: number,
    fontSize: number,
    fontWeight = 400
): string {
    const text = String(value ?? '');

    if (!text || maxWidth <= 0) {
        return '';
    }

    if (
        estimateTextWidth(
            text,
            fontSize,
            fontWeight
        ) <= maxWidth
    ) {
        return text;
    }

    const characters = Array.from(text);
    const suffix = '…';

    const suffixWidth = estimateTextWidth(
        suffix,
        fontSize,
        fontWeight
    );

    if (suffixWidth > maxWidth) {
        return '';
    }

    const weightFactor =
        getFontWeightFactor(fontWeight);

    let result = '';
    let currentWidth = 0;

    for (const character of characters) {
        const characterWidth =
            estimateCharacterWidth(
                character,
                fontSize
            ) * weightFactor;

        if (
            currentWidth +
            characterWidth +
            suffixWidth >
            maxWidth
        ) {
            break;
        }

        result += character;
        currentWidth += characterWidth;
    }

    return `${result}${suffix}`;
}

/* =========================================================
 * 玩家数据处理
 * ======================================================= */

/**
 * 支持：
 *
 * [资源] PlayerName
 * [资源]PlayerName
 */
function parsePlayerName(rawValue: unknown): {
    group: string;
    username: string;
} {
    const text = String(rawValue ?? '').trim();

    if (!text) {
        return {
            group: '未知',
            username: 'unknown'
        };
    }

    const match =
        /^\[([^\]]+)\]\s*(.*)$/u.exec(text);

    if (!match) {
        return {
            group: '未知',
            username: text
        };
    }

    const group =
        match[1].trim() || '未知';

    const username =
        match[2].trim() || text;

    return {
        group,
        username
    };
}

function comparePlayers(
    left: ParsedPlayer,
    right: ParsedPlayer
): number {
    return usernameCollator.compare(
        left.username,
        right.username
    );
}

function getPingColor(ping: number): string {
    if (
        !Number.isFinite(ping) ||
        ping <= 0
    ) {
        return '#8a93a3';
    }

    if (ping < 80) {
        return '#2b6cb0';
    }

    if (ping < 150) {
        return '#b7791f';
    }

    return '#c53030';
}

function getGroupColor(
    group: string,
    index: number
): string {
    switch (group) {
        case '主城':
            return '#c05621';

        case '一区':
            return '#2b6cb0';

        case '二区':
            return '#4c51bf';

        case '资源':
            return '#805ad5';

        case '登录':
            return '#b7791f';

        default: {
            const colors = [
                '#2b6cb0',
                '#4c51bf',
                '#805ad5',
                '#c05621',
                '#b7791f'
            ];

            return colors[
            index % colors.length
                ];
        }
    }
}

/* =========================================================
 * 分组与排序
 * ======================================================= */

export function groupAndSortPlayers(
    players: PlayerListItem[],
    groupOrder: string[] = [
        '主城',
        '一区',
        '二区',
        '资源',
        '登录'
    ]
): Array<{
    group: string;
    players: ParsedPlayer[];
}> {
    if (!Array.isArray(players)) {
        throw new TypeError(
            'players 必须是数组'
        );
    }

    const groupMap = new Map<
        string,
        ParsedPlayer[]
    >();

    for (const source of players) {
        const parsedName = parsePlayerName(
            source.name
        );

        const pingText = String(
            source.ping ?? '0'
        ).trim() || '0';

        const parsedPing = Number(pingText);

        const player: ParsedPlayer = {
            group: parsedName.group,
            username: parsedName.username,
            ping: pingText,
            pingNumber:
                Number.isFinite(parsedPing)
                    ? parsedPing
                    : 0
        };

        const currentGroup =
            groupMap.get(player.group);

        if (currentGroup) {
            currentGroup.push(player);
        } else {
            groupMap.set(
                player.group,
                [player]
            );
        }
    }

    for (const list of groupMap.values()) {
        list.sort(comparePlayers);
    }

    const orderMap =
        new Map<string, number>();

    for (
        let index = 0;
        index < groupOrder.length;
        index++
    ) {
        orderMap.set(
            groupOrder[index],
            index
        );
    }

    const groups = Array.from(
        groupMap.keys()
    );

    groups.sort((left, right) => {
        const leftIndex =
            orderMap.get(left);

        const rightIndex =
            orderMap.get(right);

        const leftOrder =
            leftIndex === undefined
                ? Number.MAX_SAFE_INTEGER
                : leftIndex;

        const rightOrder =
            rightIndex === undefined
                ? Number.MAX_SAFE_INTEGER
                : rightIndex;

        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }

        return groupCollator.compare(
            left,
            right
        );
    });

    return groups.map((group) => ({
        group,
        players: groupMap.get(group) ?? []
    }));
}

/* =========================================================
 * 装饰图形
 * ======================================================= */

function drawCompass(
    x: number,
    y: number,
    size: number
): string {
    const pixel = Math.max(
        2,
        Math.floor(size / 8)
    );

    return [
        svgRect(
            x,
            y,
            size,
            size,
            {
                fill: '#4a5568'
            }
        ),

        svgRect(
            x + pixel,
            y + pixel,
            size - pixel * 2,
            size - pixel * 2,
            {
                fill: '#718096'
            }
        ),

        svgRect(
            x + pixel * 2,
            y + pixel * 2,
            size - pixel * 4,
            size - pixel * 4,
            {
                fill: '#e2e8f0'
            }
        ),

        `<path d="M ${x + size / 2} ${y + pixel * 2}`,
        ` L ${x + size / 2 + pixel} ${y + size / 2}`,
        ` L ${x + size / 2 - pixel} ${y + size / 2}`,
        ' Z" fill="#c53030"/>',

        `<path d="M ${x + size / 2} ${y + size - pixel * 2}`,
        ` L ${x + size / 2 + pixel} ${y + size / 2}`,
        ` L ${x + size / 2 - pixel} ${y + size / 2}`,
        ' Z" fill="#2b4c7e"/>'
    ].join('');
}

function drawDiamond(
    x: number,
    y: number,
    size: number
): string {
    const half = size / 2;

    return [
        `<path d="M ${x + half} ${y}`,
        ` L ${x + size} ${y + half * 0.7}`,
        ` L ${x + half} ${y + size}`,
        ` L ${x} ${y + half * 0.7}`,
        ' Z" fill="#3b82c4"/>',

        `<path d="M ${x + half} ${y}`,
        ` L ${x + half} ${y + half}`,
        ` L ${x + size * 0.22} ${y + half * 0.7}`,
        ' Z" fill="#93c5fd"/>',

        `<path d="M ${x + half} ${y + half}`,
        ` L ${x + size} ${y + half * 0.7}`,
        ` L ${x + half} ${y + size}`,
        ' Z" fill="#1e4f8c"/>'
    ].join('');
}

/* =========================================================
 * 分组标题
 * ======================================================= */

interface DrawGroupHeaderOptions {
    x: number;
    y: number;
    cardWidth: number;
    cardPaddingX: number;

    group: string;
    count: number;
    color: string;

    titleColor: string;
    badgeBackground: string;
    badgeBorder: string;
    badgeTextColor: string;

    fontFamily: string;
    groupFontSize: number;
    badgeFontSize: number;

    textOffsetY: number;
    barOffsetY: number;
}

function drawGroupHeader(
    options: DrawGroupHeaderOptions
): string {
    const rowHeight = 22;

    const barWidth = 4;
    const barHeight = 18;
    const barGap = 8;

    const rowY = Math.round(options.y);
    const centerY =
        rowY + rowHeight / 2;

    const contentX = Math.round(
        options.x + options.cardPaddingX
    );

    const barY = Math.round(
        centerY -
        barHeight / 2 +
        options.barOffsetY
    );

    const countText =
        String(options.count);

    const badgeWidth =
        Math.ceil(
            estimateTextWidth(
                countText,
                options.badgeFontSize,
                700
            )
        ) + 14;

    const badgeX = Math.round(
        options.x +
        options.cardWidth -
        options.cardPaddingX -
        badgeWidth
    );

    return [
        svgRect(
            contentX,
            barY,
            barWidth,
            barHeight,
            {
                fill: options.color
            }
        ),

        svgMiddleText(
            `[${options.group}]`,
            contentX + barWidth + barGap,
            Math.round(
                centerY +
                options.textOffsetY
            ),
            {
                fontFamily:
                options.fontFamily,
                fontSize:
                options.groupFontSize,
                fontWeight: 700,
                fill: options.titleColor
            }
        ),

        svgRect(
            badgeX,
            rowY,
            badgeWidth,
            rowHeight,
            {
                fill:
                options.badgeBackground,
                stroke:
                options.badgeBorder
            }
        ),

        svgMiddleText(
            countText,
            badgeX + badgeWidth / 2,
            centerY,
            {
                fontFamily:
                options.fontFamily,
                fontSize:
                options.badgeFontSize,
                fontWeight: 700,
                fill:
                options.badgeTextColor,
                anchor: 'middle'
            }
        )
    ].join('');
}

/* =========================================================
 * SVG 主渲染
 * ======================================================= */

/**
 * 将玩家列表渲染为 SVG。
 */
export function renderPlayerListSvg(
    players: PlayerListItem[],
    options: RenderPlayerListOptions = {}
): string {
    if (!Array.isArray(players)) {
        throw new TypeError(
            'players 必须是数组'
        );
    }

    const width = Math.max(
        640,
        Math.min(
            2400,
            Math.floor(
                Number(options.width) || 820
            )
        )
    );

    const title = String(
        options.title ?? 'ONLINE PLAYERS'
    );

    const subtitle = String(
        options.subtitle ?? '在线玩家列表'
    );

    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) || 'Noto Sans CJK SC';

    const groupOrder =
        options.groupOrder ?? [
            '主城',
            '一区',
            '二区',
            '资源',
            '登录'
        ];

    const columns = Math.max(
        1,
        Math.min(
            4,
            Math.floor(
                Number(options.columns) || 2
            )
        )
    );

    const groupTextOffsetY =
        Number.isFinite(
            options.groupTextOffsetY
        )
            ? Math.round(
                Number(
                    options.groupTextOffsetY
                )
            )
            : -1;

    const groupBarOffsetY =
        Number.isFinite(
            options.groupBarOffsetY
        )
            ? Math.round(
                Number(
                    options.groupBarOffsetY
                )
            )
            : 0;

    const colors = {
        background: '#eef1f6',
        frame: '#b8c0d0',

        bar: '#3d5a80',
        barLight: '#6b8cbe',

        title: '#1e2a3a',
        subtitle: '#5c6b7e',

        card: '#ffffff',
        cardBorder: '#c9d0dc',
        cardSoft: '#f3f5f9',

        name: '#2b4c7e',
        muted: '#6a7585',
        footer: '#3d4a5c',

        badgeBackground: '#e8eef7',
        badgeBorder: '#a8b6cc',
        badgeText: '#3d5a80',

        line: '#3d5a80'
    } as const;

    /* -------------------------
     * 布局
     * ----------------------- */

    const outerPadding = 28;
    const headerHeight = 104;
    const footerHeight = 48;
    const cardGap = 12;

    const cardPaddingX = 16;
    const cardPaddingY = 14;

    const cardWidth =
        width - outerPadding * 2;

    const contentWidth =
        cardWidth - cardPaddingX * 2;

    const titleSize = 34;
    const subtitleSize = 15;
    const groupSize = 18;
    const badgeSize = 13;
    const nameSize = 16;
    const pingSize = 13;
    const footerSize = 14;

    const headerRowHeight = 22;
    const playerRowHeight = 28;

    const columnGap = 12;

    const columnWidth =
        (
            contentWidth -
            columnGap * (columns - 1)
        ) / columns;

    /*
     * 玩家单元格内部布局。
     */
    const cellHorizontalPadding = 8;
    const namePingGap = 8;
    const pingReservedWidth = 68;

    /* -------------------------
     * 玩家分组
     * ----------------------- */

    const groupedPlayers =
        groupAndSortPlayers(
            players,
            groupOrder
        );

    const preparedGroups:
        PreparedGroup[] =
        new Array(groupedPlayers.length);

    let allCardsHeight = 0;

    for (
        let index = 0;
        index < groupedPlayers.length;
        index++
    ) {
        const current =
            groupedPlayers[index];

        const rowCount = Math.max(
            1,
            Math.ceil(
                current.players.length /
                columns
            )
        );

        const cardHeight =
            cardPaddingY * 2 +
            headerRowHeight +
            8 +
            rowCount * playerRowHeight;

        preparedGroups[index] = {
            group: current.group,
            players: current.players,
            rowCount,
            height: cardHeight,
            color: getGroupColor(
                current.group,
                index
            )
        };

        allCardsHeight += cardHeight;
    }

    const allCardGapsHeight =
        Math.max(
            0,
            preparedGroups.length - 1
        ) * cardGap;

    const emptyAreaHeight =
        preparedGroups.length === 0
            ? 90
            : 0;

    const height =
        outerPadding +
        headerHeight +
        allCardsHeight +
        allCardGapsHeight +
        emptyAreaHeight +
        footerHeight +
        outerPadding;

    /*
     * clipPath 单独收集，统一放入 defs。
     */
    const definitions: string[] = [];

    /*
     * 主体内容。
     */
    const body: string[] = [
        svgRect(
            0,
            0,
            width,
            height,
            {
                fill: colors.background
            }
        ),

        svgRect(
            outerPadding / 2 + 0.5,
            outerPadding / 2 + 0.5,
            width - outerPadding + 1,
            height - outerPadding + 1,
            {
                fill: 'none',
                stroke: colors.frame,
                strokeWidth: 2
            }
        ),

        svgRect(
            outerPadding / 2,
            outerPadding / 2,
            width - outerPadding,
            8,
            {
                fill: colors.bar
            }
        ),

        svgRect(
            outerPadding / 2,
            outerPadding / 2,
            width - outerPadding,
            3,
            {
                fill: colors.barLight
            }
        ),

        drawCompass(
            outerPadding + 4,
            outerPadding + 18,
            30
        ),

        drawDiamond(
            width - outerPadding - 34,
            outerPadding + 20,
            26
        ),

        svgTopText(
            title,
            width / 2,
            outerPadding + 14,
            {
                fontFamily,
                fontSize: titleSize,
                fontWeight: 700,
                fill: colors.title,
                anchor: 'middle'
            }
        )
    ];

    const measuredTitleWidth = Math.min(
        320,
        Math.ceil(
            estimateTextWidth(
                title,
                titleSize,
                700
            )
        )
    );

    body.push(
        svgRect(
            Math.round(
                width / 2 -
                measuredTitleWidth / 2
            ),
            outerPadding + 54,
            measuredTitleWidth,
            3,
            {
                fill: colors.bar
            }
        ),

        svgRect(
            Math.round(width / 2 - 22),
            outerPadding + 52,
            44,
            7,
            {
                fill: colors.barLight
            }
        ),

        svgTopText(
            `${subtitle} · ${players.length} 人在线`,
            width / 2,
            outerPadding + 68,
            {
                fontFamily,
                fontSize: subtitleSize,
                fontWeight: 400,
                fill: colors.subtitle,
                anchor: 'middle'
            }
        )
    );

    let currentY =
        outerPadding + headerHeight;

    /* -------------------------
     * 空状态
     * ----------------------- */

    if (preparedGroups.length === 0) {
        body.push(
            svgRect(
                outerPadding,
                currentY,
                cardWidth,
                74,
                {
                    fill: colors.card,
                    stroke:
                    colors.cardBorder
                }
            ),

            svgTopText(
                '当前没有在线玩家',
                outerPadding + 16,
                currentY + 16,
                {
                    fontFamily,
                    fontSize: 18,
                    fontWeight: 600,
                    fill: colors.title
                }
            ),

            svgTopText(
                '稍后再来看看吧',
                outerPadding + 16,
                currentY + 44,
                {
                    fontFamily,
                    fontSize: 15,
                    fontWeight: 400,
                    fill: colors.muted
                }
            )
        );

        currentY += emptyAreaHeight;
    }

    /* -------------------------
     * 分组卡片
     * ----------------------- */

    for (
        let groupIndex = 0;
        groupIndex < preparedGroups.length;
        groupIndex++
    ) {
        const prepared =
            preparedGroups[groupIndex];

        const cardX = outerPadding;
        const cardY = currentY;

        const contentX =
            cardX + cardPaddingX;

        body.push(
            svgRect(
                cardX,
                cardY,
                cardWidth,
                prepared.height,
                {
                    fill: colors.card,
                    stroke:
                    colors.cardBorder
                }
            ),

            svgRect(
                cardX,
                cardY,
                cardWidth,
                3,
                {
                    fill: prepared.color
                }
            )
        );

        const groupHeaderY = Math.round(
            cardY + cardPaddingY
        );

        body.push(
            drawGroupHeader({
                x: cardX,
                y: groupHeaderY,
                cardWidth,
                cardPaddingX,

                group: prepared.group,
                count:
                prepared.players.length,
                color: prepared.color,

                titleColor: colors.title,

                badgeBackground:
                colors.badgeBackground,

                badgeBorder:
                colors.badgeBorder,

                badgeTextColor:
                colors.badgeText,

                fontFamily,
                groupFontSize: groupSize,
                badgeFontSize: badgeSize,

                textOffsetY:
                groupTextOffsetY,

                barOffsetY:
                groupBarOffsetY
            })
        );

        const playerRowY =
            groupHeaderY +
            headerRowHeight +
            8;

        for (
            let playerIndex = 0;
            playerIndex <
            prepared.players.length;
            playerIndex++
        ) {
            const player =
                prepared.players[
                    playerIndex
                    ];

            const rowIndex = Math.floor(
                playerIndex / columns
            );

            const columnIndex =
                playerIndex % columns;

            const cellX = Math.round(
                contentX +
                columnIndex *
                (
                    columnWidth +
                    columnGap
                )
            );

            const cellY =
                playerRowY +
                rowIndex *
                playerRowHeight;

            const cellWidth =
                Math.floor(columnWidth);

            const cellHeight =
                playerRowHeight - 4;

            /*
             * Ping 区域。
             */
            const pingAreaWidth = Math.min(
                pingReservedWidth,
                Math.max(
                    32,
                    cellWidth * 0.35
                )
            );

            const pingAreaX =
                cellX +
                cellWidth -
                cellHorizontalPadding -
                pingAreaWidth;

            /*
             * 玩家名称区域。
             */
            const nameAreaX =
                cellX +
                cellHorizontalPadding;

            const nameAreaWidth = Math.max(
                1,
                pingAreaX -
                namePingGap -
                nameAreaX
            );

            /*
             * 额外保留 8% 的安全空间，
             * 避免不同字体产生宽度偏差。
             */
            const safeNameWidth = Math.max(
                1,
                nameAreaWidth * 0.92
            );

            const safePingWidth = Math.max(
                1,
                pingAreaWidth * 0.94
            );

            const displayName =
                ellipsizeText(
                    player.username,
                    safeNameWidth,
                    nameSize,
                    600
                );

            const displayPing =
                ellipsizeText(
                    `${player.ping}ms`,
                    safePingWidth,
                    pingSize,
                    600
                );

            /*
             * 玩家名和 Ping 使用独立裁剪区域。
             */
            const nameClipId =
                `player-name-${groupIndex}-${playerIndex}`;

            const pingClipId =
                `player-ping-${groupIndex}-${playerIndex}`;

            definitions.push(
                svgClipPath(
                    nameClipId,
                    nameAreaX,
                    cellY,
                    nameAreaWidth,
                    cellHeight
                ),

                svgClipPath(
                    pingClipId,
                    pingAreaX,
                    cellY,
                    pingAreaWidth,
                    cellHeight
                )
            );

            const centerY =
                cellY + cellHeight / 2;

            body.push(
                /*
                 * 单元格背景。
                 */
                svgRect(
                    cellX,
                    cellY,
                    cellWidth,
                    cellHeight,
                    {
                        fill:
                        colors.cardSoft
                    }
                ),

                /*
                 * 玩家名。
                 *
                 * 在名称区域内水平、垂直居中。
                 */
                `<g clip-path="url(#${nameClipId})">`,

                svgMiddleText(
                    displayName,
                    nameAreaX,
                    centerY,
                    {
                        fontFamily,
                        fontSize: nameSize,
                        fontWeight: 600,
                        fill: colors.name,
                        anchor: 'start'
                    }
                ),

                '</g>',

                /*
                 * Ping。
                 *
                 * 垂直居中，右对齐。
                 */
                `<g clip-path="url(#${pingClipId})">`,

                svgMiddleText(
                    displayPing,
                    cellX +
                    cellWidth -
                    cellHorizontalPadding,
                    centerY,
                    {
                        fontFamily,
                        fontSize: pingSize,
                        fontWeight: 600,

                        fill: getPingColor(
                            player.pingNumber
                        ),

                        anchor: 'end'
                    }
                ),

                '</g>'
            );
        }

        currentY += prepared.height;

        if (
            groupIndex <
            preparedGroups.length - 1
        ) {
            currentY += cardGap;
        }
    }

    /* -------------------------
     * 页脚
     * ----------------------- */

    const footerLineY =
        height - outerPadding - 28;

    const footerTextY =
        footerLineY + 10;

    body.push(
        svgRect(
            outerPadding,
            footerLineY,
            cardWidth,
            2,
            {
                fill: colors.line
            }
        ),

        svgRect(
            Math.round(width / 2 - 4),
            footerLineY - 3,
            8,
            8,
            {
                fill: colors.line
            }
        ),

        svgRect(
            Math.round(width / 2 - 2),
            footerLineY,
            4,
            2,
            {
                fill: colors.background
            }
        ),

        svgTopText(
            'ChatBot Player List',
            outerPadding,
            footerTextY,
            {
                fontFamily,
                fontSize: footerSize,
                fontWeight: 600,
                fill: colors.footer
            }
        ),

        svgTopText(
            `${preparedGroups.length} 组 · ${players.length} 人`,
            width - outerPadding,
            footerTextY,
            {
                fontFamily,
                fontSize: footerSize,
                fontWeight: 600,
                fill: colors.footer,
                anchor: 'end'
            }
        )
    );

    return [
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` width="${width}"`,
        ` height="${height}"`,
        ` viewBox="0 0 ${width} ${height}">`,
        definitions.length > 0
            ? `<defs>${definitions.join('')}</defs>`
            : '',
        body.join(''),
        '</svg>'
    ].join('');
}

/* =========================================================
 * PNG 渲染
 * ======================================================= */

/**
 * 使用 Resvg 将玩家列表渲染为 PNG Buffer。
 */
export function renderPlayerList(
    players: PlayerListItem[],
    options: RenderPlayerListOptions = {}
): Buffer {
    const svg = renderPlayerListSvg(
        players,
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
        fontFiles.push(
            options.fontPath
        );
    }

    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) || 'Noto Sans CJK SC';

    const renderer = new Resvg(svg, {
        fitTo: {
            mode: 'zoom',
            value: scale
        },

        font: {
            fontFiles,
            loadSystemFonts: true,
            defaultFontFamily: fontFamily
        }
    });

    return Buffer.from(
        renderer.render().asPng()
    );
}