import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';

/* =========================================================
 * 对外类型
 * ======================================================= */

export interface ServerMoneyRankPlayer {
    rank: number;
    name: string | number;
    amount: number | string;
}

export interface RenderRankingOptions {
    /** 图片宽度，默认 920 */
    width?: number;

    /** 单行高度，默认 64 */
    rowHeight?: number;

    /** 主标题 */
    title?: string;

    /** 副标题 */
    subtitle?: string;

    /** 货币单位 */
    currencyName?: string;

    /** 是否固定显示两位小数 */
    fixedDecimals?: boolean;

    /** 是否根据 rank 排序 */
    sortByRank?: boolean;

    /** 自定义字体文件路径 */
    fontPath?: string;

    /** 字体文件内部的 family name */
    fontFamily?: string;

    /** PNG 输出缩放倍率 */
    scale?: number;
}

/* =========================================================
 * 主题
 * ======================================================= */

const THEME = {
    primary: '#147F98',
    primaryDark: '#0E667C',
    secondary: '#66BDD0',

    background: '#F2F9FB',
    card: '#FFFFFF',
    cardAlternate: '#F8FCFD',
    border: '#BCDCE3',

    text: '#204F5D',
    muted: '#718D95',

    barTrack: '#E3F1F4',
    bar: '#35A2B9',

    first: '#DDA636',
    firstBackground: '#FFF8E7',
    firstBorder: '#ECD38D',

    second: '#7B98A0',
    third: '#B77A53',

    status: '#8DE0C2'
} as const;

/* =========================================================
 * 基础工具
 * ======================================================= */

function clamp(
    value: number,
    minimum: number,
    maximum: number
): number {
    return Math.min(
        maximum,
        Math.max(minimum, value)
    );
}

function toFiniteNumber(
    value: unknown,
    fallback: number
): number {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
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

function sanitizeFontFamily(value: unknown): string {
    return String(value ?? '')
        .replace(/[\\'"`;{}<>]/g, '')
        .trim();
}

/* =========================================================
 * 金额工具
 * ======================================================= */

const MONEY_FORMATTER = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
});

const MONEY_FIXED_FORMATTER = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

function parseMoney(value: number | string): number {
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? value
            : 0;
    }

    const normalized = String(value)
        .replace(/,/g, '')
        .replace(/[^\d.-]/g, '')
        .trim();

    const amount = Number(normalized);

    return Number.isFinite(amount)
        ? amount
        : 0;
}

function formatMoney(
    amount: number,
    fixedDecimals: boolean
): string {
    return (
        fixedDecimals
            ? MONEY_FIXED_FORMATTER
            : MONEY_FORMATTER
    ).format(amount);
}

/* =========================================================
 * SVG 图形工具
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
        opacity?: number;
    } = {}
): string {
    const attributes = [
        `<rect x="${x}"`,
        ` y="${y}"`,
        ` width="${width}"`,
        ` height="${height}"`,
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

function svgLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: {
        stroke: string;
        strokeWidth?: number;
    }
): string {
    return [
        `<line x1="${x1}"`,
        ` y1="${y1}"`,
        ` x2="${x2}"`,
        ` y2="${y2}"`,
        ` stroke="${options.stroke}"`,
        ` stroke-width="${options.strokeWidth ?? 1}"`,
        '/>'
    ].join('');
}

interface SvgTextOptions {
    fontFamily: string;
    fontSize: number;
    fontWeight?: number;
    fill: string;
    anchor?: 'start' | 'middle' | 'end';
    letterSpacing?: number;
}

/**
 * 以文本顶部为基准绘制。
 */
function svgTopText(
    text: string,
    x: number,
    y: number,
    options: SvgTextOptions
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
 * 以文字垂直中心为基准绘制。
 */
function svgMiddleText(
    text: string,
    x: number,
    y: number,
    options: SvgTextOptions
): string {
    const attributes = [
        `<text x="${x}"`,
        ` y="${y}"`,
        ` font-family="${escapeXml(options.fontFamily)}"`,
        ` font-size="${options.fontSize}"`,
        ` font-weight="${options.fontWeight ?? 400}"`,
        ` fill="${options.fill}"`,
        ` text-anchor="${options.anchor ?? 'start'}"`,
        ' dominant-baseline="central"'
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

/* =========================================================
 * 文本宽度估算
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
        return fontSize * 0.92;
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
    maximumWidth: number,
    fontSize: number,
    fontWeight = 400
): string {
    const text = String(value ?? '');

    if (
        estimateTextWidth(
            text,
            fontSize,
            fontWeight
        ) <= maximumWidth
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

    let currentWidth = 0;
    let output = '';

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
            maximumWidth
        ) {
            break;
        }

        output += character;
        currentWidth += characterWidth;
    }

    return output + ellipsis;
}

/* =========================================================
 * 排名工具
 * ======================================================= */

function getRankColor(rank: number): string {
    if (rank === 1) {
        return THEME.first;
    }

    if (rank === 2) {
        return THEME.second;
    }

    if (rank === 3) {
        return THEME.third;
    }

    return THEME.primary;
}

function getRankingRange(
    players: Array<{ rank: number }>
): {
    title: string;
    metricLabel: string;
} {
    const ranks = players
        .map((player) => player.rank)
        .filter(
            (rank) =>
                Number.isInteger(rank) &&
                rank > 0
        )
        .sort((a, b) => a - b);

    if (ranks.length === 0) {
        return {
            title: '暂无排行数据',
            metricLabel: '当前列表'
        };
    }

    const minimum = ranks[0];
    const maximum = ranks[ranks.length - 1];

    const continuous = ranks.every(
        (rank, index) =>
            index === 0 ||
            rank === ranks[index - 1] + 1
    );

    if (continuous && minimum === 1) {
        return {
            title: `TOP ${maximum} · 玩家资产排名`,
            metricLabel: `TOP ${maximum}`
        };
    }

    if (continuous) {
        return {
            title: `RANK ${minimum}–${maximum} · 玩家资产排名`,
            metricLabel: `第 ${minimum}–${maximum} 名`
        };
    }

    return {
        title: 'SELECTED RANKINGS · 玩家资产排名',
        metricLabel: '当前列表'
    };
}

/* =========================================================
 * 汇总卡片
 * ======================================================= */

function drawSummaryCard(params: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    value: string;
    unit?: string;
    fontFamily: string;
}): string {
    const {
        x,
        y,
        width,
        height,
        label,
        value,
        unit,
        fontFamily
    } = params;

    const output: string[] = [];

    output.push(
        svgRect(
            x,
            y,
            width,
            height,
            {
                fill: THEME.card,
                stroke: THEME.border,
                strokeWidth: 1
            }
        )
    );

    output.push(
        svgRect(
            x,
            y,
            5,
            height,
            {
                fill: THEME.primary
            }
        )
    );

    output.push(
        svgTopText(
            label,
            x + 20,
            y + 16,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 500,
                fill: THEME.muted
            }
        )
    );

    const unitFontSize = 12;

    const unitWidth = unit
        ? estimateTextWidth(
            unit,
            unitFontSize,
            400
        )
        : 0;

    const valueMaximumWidth = unit
        ? width - 52 - unitWidth
        : width - 40;

    let valueFontSize = 20;

    while (
        valueFontSize > 14 &&
        estimateTextWidth(
            value,
            valueFontSize,
            700
        ) > valueMaximumWidth
        ) {
        valueFontSize--;
    }

    const safeValue = ellipsisText(
        value,
        valueMaximumWidth,
        valueFontSize,
        700
    );

    output.push(
        svgTopText(
            safeValue,
            x + 20,
            y + 45,
            {
                fontFamily,
                fontSize: valueFontSize,
                fontWeight: 700,
                fill: THEME.primaryDark
            }
        )
    );

    if (unit) {
        output.push(
            svgTopText(
                unit,
                x + width - 16,
                y + 50,
                {
                    fontFamily,
                    fontSize: unitFontSize,
                    fontWeight: 400,
                    fill: THEME.muted,
                    anchor: 'end'
                }
            )
        );
    }

    return output.join('');
}

/* =========================================================
 * SVG 渲染
 * ======================================================= */

export function renderServerMoneyRankingSvg(
    totalAmount: number | string,
    players: ServerMoneyRankPlayer[],
    options: RenderRankingOptions = {}
): string {
    if (!Array.isArray(players)) {
        throw new TypeError(
            'players 必须是数组'
        );
    }

    const width = clamp(
        Math.floor(
            toFiniteNumber(
                options.width,
                920
            )
        ),
        720,
        2400
    );

    const rowHeight = clamp(
        Math.floor(
            toFiniteNumber(
                options.rowHeight,
                64
            )
        ),
        54,
        120
    );

    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) ||
        'Noto Sans CJK SC';

    const title = String(
        options.title ??
        '服务器金币排行榜'
    );

    const subtitle = String(
        options.subtitle ??
        'SERVER ECONOMY ANALYTICS'
    );

    const currencyName = String(
        options.currencyName ??
        '金币'
    );

    const fixedDecimals =
        options.fixedDecimals !== false;

    const sortByRank =
        options.sortByRank !== false;

    const normalizedPlayers = players
        .map((player) => ({
            rank: Number(player.rank),
            name: String(
                player.name ?? ''
            ).trim() || '未知玩家',
            amount: Math.max(
                0,
                parseMoney(player.amount)
            )
        }))
        .filter(
            (player) =>
                Number.isInteger(player.rank) &&
                player.rank > 0
        );

    if (sortByRank) {
        normalizedPlayers.sort(
            (a, b) => a.rank - b.rank
        );
    }

    const total = Math.max(
        0,
        parseMoney(totalAmount)
    );

    const listedTotal =
        normalizedPlayers.reduce(
            (sum, player) =>
                sum + player.amount,
            0
        );

    const listedShare =
        total > 0
            ? (listedTotal / total) * 100
            : 0;

    const maximumAmount =
        normalizedPlayers.reduce(
            (maximum, player) =>
                Math.max(
                    maximum,
                    player.amount
                ),
            0
        );

    const range =
        getRankingRange(
            normalizedPlayers
        );

    const padding = 30;
    const contentWidth =
        width - padding * 2;

    const headerY = 30;
    const headerHeight = 82;

    const summaryY =
        headerY + headerHeight + 16;

    const summaryHeight = 92;
    const summaryGap = 12;

    const summaryWidth =
        (contentWidth - summaryGap * 2) / 3;

    const rankingHeaderY =
        summaryY + summaryHeight + 20;

    const rankingHeaderHeight = 52;

    const rowsY =
        rankingHeaderY +
        rankingHeaderHeight +
        8;

    const emptyHeight = 110;

    const rowsHeight =
        normalizedPlayers.length > 0
            ? normalizedPlayers.length *
            rowHeight
            : emptyHeight;

    const footerY =
        rowsY + rowsHeight + 18;

    const footerHeight = 42;

    const height =
        footerY + footerHeight + 18;

    const rankWidth = 68;
    const amountWidth = 220;

    const playerX =
        padding + rankWidth + 18;

    const amountX =
        width - padding - 16;

    const barX = playerX;

    const barMaximumWidth = Math.max(
        100,
        contentWidth -
        rankWidth -
        amountWidth -
        42
    );

    const svg: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` width="${width}"`,
        ` height="${height}"`,
        ` viewBox="0 0 ${width} ${height}">`
    ];
    /* 页面背景 */
    svg.push(
        svgRect(
            0,
            0,
            width,
            height,
            {
                fill: THEME.background
            }
        )
    );
    /* 顶部标题区域 */
    svg.push(
        svgRect(
            padding,
            headerY,
            contentWidth,
            headerHeight,
            {
                fill: THEME.primary
            }
        ),
        svgRect(
            padding,
            headerY,
            7,
            headerHeight,
            {
                fill: THEME.secondary
            }
        )
    );
    svg.push(
        svgTopText(
            ellipsisText(
                title,
                contentWidth - 190,
                25,
                700
            ),
            padding + 24,
            headerY + 14,
            {
                fontFamily,
                fontSize: 25,
                fontWeight: 700,
                fill: '#FFFFFF'
            }
        ),
        svgTopText(
            ellipsisText(
                subtitle,
                contentWidth - 190,
                11,
                600
            ),
            padding + 25,
            headerY + 49,
            {
                fontFamily,
                fontSize: 11,
                fontWeight: 600,
                fill: '#D4F0F5',
                letterSpacing: 2
            }
        )
    );
    svg.push(
        svgRect(
            width - padding - 92,
            headerY + 35,
            7,
            7,
            {
                fill: THEME.status
            }
        ),
        svgTopText(
            '数据已同步',
            width - padding - 76,
            headerY + 31,
            {
                fontFamily,
                fontSize: 11,
                fontWeight: 600,
                fill: '#D9F5F7'
            }
        )
    );
    /* 汇总卡片 */
    svg.push(
        drawSummaryCard({
            x: padding,
            y: summaryY,
            width: summaryWidth,
            height: summaryHeight,
            label: '全服金币总量',
            value: formatMoney(
                total,
                fixedDecimals
            ),
            unit: currencyName,
            fontFamily
        }),
        drawSummaryCard({
            x:
                padding +
                summaryWidth +
                summaryGap,
            y: summaryY,
            width: summaryWidth,
            height: summaryHeight,
            label:
                `${range.metricLabel}资产总量`,
            value: formatMoney(
                listedTotal,
                fixedDecimals
            ),
            unit: currencyName,
            fontFamily
        }),
        drawSummaryCard({
            x:
                padding +
                (
                    summaryWidth +
                    summaryGap
                ) *
                2,
            y: summaryY,
            width: summaryWidth,
            height: summaryHeight,
            label:
                `${range.metricLabel}全服占比`,
            value:
                `${listedShare.toFixed(2)}%`,
            fontFamily
        })
    );
    /* 排行标题 */
    svg.push(
        svgRect(
            padding,
            rankingHeaderY,
            contentWidth,
            rankingHeaderHeight,
            {
                fill: THEME.card,
                stroke: THEME.border,
                strokeWidth: 1
            }
        ),
        svgTopText(
            ellipsisText(
                range.title,
                contentWidth - amountWidth - 30,
                17,
                700
            ),
            padding + 16,
            rankingHeaderY + 8,
            {
                fontFamily,
                fontSize: 17,
                fontWeight: 700,
                fill: THEME.text
            }
        ),
        svgTopText(
            `共 ${normalizedPlayers.length} 条玩家数据`,
            padding + 16,
            rankingHeaderY + 32,
            {
                fontFamily,
                fontSize: 11,
                fontWeight: 400,
                fill: THEME.muted
            }
        ),
        svgMiddleText(
            `资产金额 / ${currencyName}`,
            amountX,
            rankingHeaderY +
            rankingHeaderHeight / 2,
            {
                fontFamily,
                fontSize: 11,
                fontWeight: 600,
                fill: THEME.muted,
                anchor: 'end'
            }
        )
    );
    /* 排行内容 */
    if (normalizedPlayers.length === 0) {
        svg.push(
            svgRect(
                padding,
                rowsY,
                contentWidth,
                emptyHeight,
                {
                    fill: THEME.card,
                    stroke: THEME.border,
                    strokeWidth: 1
                }
            ),
            svgTopText(
                '暂无排行数据',
                width / 2,
                rowsY + 30,
                {
                    fontFamily,
                    fontSize: 17,
                    fontWeight: 600,
                    fill: THEME.text,
                    anchor: 'middle'
                }
            ),
            svgTopText(
                'NO RANKING DATA',
                width / 2,
                rowsY + 62,
                {
                    fontFamily,
                    fontSize: 11,
                    fontWeight: 400,
                    fill: THEME.muted,
                    anchor: 'middle',
                    letterSpacing: 1.5
                }
            )
        );
    } else {
        normalizedPlayers.forEach(
            (player, index) => {
                const y =
                    rowsY +
                    index * rowHeight;
                const innerY = y + 3;
                const innerHeight =
                    rowHeight - 6;
                const isFirst =
                    player.rank === 1;
                const rankColor =
                    getRankColor(
                        player.rank
                    );
                const background = isFirst
                    ? THEME.firstBackground
                    : index % 2 === 0
                        ? THEME.card
                        : THEME.cardAlternate;
                const borderColor = isFirst
                    ? THEME.firstBorder
                    : THEME.border;
                const ratio =
                    maximumAmount > 0
                        ? player.amount /
                        maximumAmount
                        : 0;
                const barWidth =
                    ratio > 0
                        ? Math.max(
                            3,
                            ratio *
                            barMaximumWidth
                        )
                        : 0;
                const nameMaximumWidth =
                    Math.max(
                        80,
                        barMaximumWidth -
                        20
                    );
                const safePlayerName =
                    ellipsisText(
                        player.name,
                        nameMaximumWidth,
                        15,
                        600
                    );
                const amountText =
                    formatMoney(
                        player.amount,
                        fixedDecimals
                    );
                svg.push(
                    svgRect(
                        padding,
                        innerY,
                        contentWidth,
                        innerHeight,
                        {
                            fill: background,
                            stroke: borderColor,
                            strokeWidth: 1
                        }
                    ),
                    svgRect(
                        padding,
                        innerY,
                        5,
                        innerHeight,
                        {
                            fill: rankColor
                        }
                    ),
                    svgRect(
                        padding + 16,
                        innerY +
                        (
                            innerHeight -
                            32
                        ) /
                        2,
                        40,
                        32,
                        {
                            fill: rankColor
                        }
                    ),
                    svgMiddleText(
                        String(player.rank),
                        padding + 36,
                        innerY +
                        innerHeight / 2,
                        {
                            fontFamily,
                            fontSize: 14,
                            fontWeight: 700,
                            fill: '#FFFFFF',
                            anchor: 'middle'
                        }
                    ),
                    svgTopText(
                        safePlayerName,
                        playerX,
                        innerY + 10,
                        {
                            fontFamily,
                            fontSize: 15,
                            fontWeight: 600,
                            fill: THEME.text
                        }
                    ),
                    svgRect(
                        barX,
                        innerY +
                        innerHeight -
                        12,
                        barMaximumWidth,
                        5,
                        {
                            fill: THEME.barTrack
                        }
                    )
                );
                if (barWidth > 0) {
                    svg.push(
                        svgRect(
                            barX,
                            innerY +
                            innerHeight -
                            12,
                            barWidth,
                            5,
                            {
                                fill: THEME.bar
                            }
                        )
                    );
                }
                svg.push(
                    svgMiddleText(
                        amountText,
                        amountX,
                        innerY +
                        innerHeight / 2,
                        {
                            fontFamily,
                            fontSize: 16,
                            fontWeight: 700,
                            fill: isFirst
                                ? '#B57C0D'
                                : THEME.primaryDark,
                            anchor: 'end'
                        }
                    )
                );
            }
        );
    }
    /* 页脚 */
    svg.push(
        svgLine(
            padding,
            footerY,
            width - padding,
            footerY,
            {
                stroke: THEME.border,
                strokeWidth: 1
            }
        ),
        svgRect(
            padding,
            footerY + 16,
            26,
            4,
            {
                fill: THEME.primary
            }
        ),
        svgTopText(
            'SERVER ECONOMY · GLACIER CYAN',
            padding + 38,
            footerY + 10,
            {
                fontFamily,
                fontSize: 11,
                fontWeight: 400,
                fill: THEME.muted
            }
        ),
        svgTopText(
            '资产条以当前列表最高金额为基准',
            width - padding,
            footerY + 10,
            {
                fontFamily,
                fontSize: 11,
                fontWeight: 400,
                fill: THEME.muted,
                anchor: 'end'
            }
        ),
        '</svg>'
    );

    return svg.join('');
}

/* =========================================================
 * PNG 渲染
 * ======================================================= */

export function renderServerMoneyRanking(
    totalAmount: number | string,
    players: ServerMoneyRankPlayer[],
    options: RenderRankingOptions = {}
): Buffer {
    const svg =
        renderServerMoneyRankingSvg(
            totalAmount,
            players,
            options
        );

    const scale = clamp(
        toFiniteNumber(
            options.scale,
            1
        ),
        0.5,
        4
    );

    const fontFiles: string[] = [];

    /*
     * 行为与用户提供的可用实现保持一致。
     *
     * 注意：
     * 相对路径按照 process.cwd() 解析。
     */
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

    const renderer = new Resvg(svg, {
        fitTo: {
            mode: 'zoom',
            value: scale
        },
        font: {
            fontFiles,

            /*
             * 没有可用自定义字体时扫描系统字体。
             */
            loadSystemFonts:
                fontFiles.length === 0,

            defaultFontFamily:
            fontFamily
        }
    });

    const png =
        renderer.render().asPng();

    /*
     * 明确指定 byteOffset 和 byteLength，
     * 避免底层 ArrayBuffer 范围不一致。
     */
    return Buffer.from(
        png.buffer,
        png.byteOffset,
        png.byteLength
    );
}