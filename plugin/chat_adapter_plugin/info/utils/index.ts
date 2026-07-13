import { Resvg } from '@resvg/resvg-js';
import { Buffer } from 'node:buffer';

export type PlayerTimestamp =
    | string
    | number
    | Date
    | null
    | undefined;

export interface PlayerRecentMessage {
    content: string;
    area?: string | null;
    create_time?: PlayerTimestamp;
}

export interface PlayerMoneyHistoryItem {
    money: number | string;
    timestamp: PlayerTimestamp;
}

export interface PlayerInfoData {
    avatar?: Buffer | Uint8Array | null;

    avatarMimeType?:
        | 'image/png'
        | 'image/jpeg'
        | 'image/webp';

    username: string | number;
    role?: string | null;
    is_online?: boolean | null;

    money: number | string;

    /**
     * 接口原始积分。
     * 渲染时自动除以 100。
     */
    point?: number | string | null;

    message_count?: number | string | null;

    /**
     * 接口原始在线时间，单位为秒。
     * 渲染时自动转换成分钟。
     */
    online_time?: number | string | null;

    first_record_time?: PlayerTimestamp;
    last_join_time?: PlayerTimestamp;
    last_leave_time?: PlayerTimestamp;

    address_list?:
        | Array<string | null | undefined>
        | null;

    recent_messages?:
        | PlayerRecentMessage[]
        | null;

    money_history?:
        | PlayerMoneyHistoryItem[]
        | null;

    money_source?:
        | 'realtime'
        | 'history'
        | string
        | null;

    money_time?: PlayerTimestamp;
}

export interface RenderPlayerCardOptions {
    outputWidth?: number;

    fontFiles?: string[];
    defaultFontFamily?: string;

    maxAddressItems?: number;
    maxAddressRows?: number;
    maxMoneyHistoryPoints?: number;
    maxRecentMessages?: number;

    /**
     * 没有明确时区的字符串如何解释。
     *
     * utc:
     * "2026-01-01 08:00:00" 被当作 UTC，
     * 最终显示中国时间 16:00:00。
     *
     * china:
     * "2026-01-01 08:00:00" 被当作中国时间，
     * 最终仍显示 08:00:00。
     */
    naiveTimestampTimeZone?: 'utc' | 'china';

    /**
     * 在线分钟数最多保留几位小数。
     */
    onlineMinutesFractionDigits?: number;
}

interface OnlineTheme {
    label: string;
    rawValue: string;
    background: string;
    foreground: string;
    indicator: string;
    symbol: string;
    explanation: string;
}

interface AddressTag {
    text: string;
    x: number;
    y: number;
    width: number;
}

interface AddressLayout {
    total: number;
    displayed: number;
    omitted: number;
    tags: AddressTag[];
}

interface MoneyHistoryPoint {
    money: number;
    timestamp: PlayerTimestamp;
}

interface Layout {
    svgWidth: number;
    svgHeight: number;

    outerMargin: number;

    cardX: number;
    cardY: number;
    cardWidth: number;
    cardHeight: number;

    contentX: number;
    contentRight: number;
    contentWidth: number;
    contentCenterX: number;

    headerDividerY: number;

    identityTitleY: number;
    identityCardY: number;
    identityCardHeight: number;

    addressTitleY: number;
    addressCardY: number;
    addressCardHeight: number;

    assetsTitleY: number;
    moneyCardY: number;
    moneyCardHeight: number;
    statisticCardsY: number;
    statisticCardHeight: number;

    timeTitleY: number;
    timeCardY: number;
    timeCardHeight: number;

    historyTitleY: number;
    historyCardY: number;
    historyCardHeight: number;

    messagesTitleY: number;
    messagesCardY: number;
    messagesCardHeight: number;

    footerY: number;
}

const SVG_WIDTH = 900;
const OUTER_MARGIN = 24;
const CONTENT_INSET = 28;

const CONTENT_X = OUTER_MARGIN + CONTENT_INSET;
const CONTENT_RIGHT =
    SVG_WIDTH - OUTER_MARGIN - CONTENT_INSET;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_X;

const SECTION_GAP = 28;
const TITLE_TO_CARD_GAP = 30;

function escapeXml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function clampInteger(
    value: number,
    minimum: number,
    maximum: number
): number {
    if (!Number.isFinite(value)) {
        return minimum;
    }

    return Math.min(
        maximum,
        Math.max(minimum, Math.floor(value))
    );
}

function truncateText(
    value: unknown,
    maximumLength: number,
    fallback = '暂无'
): string {
    const text = String(value ?? '').trim();

    if (!text) {
        return fallback;
    }

    const characters = Array.from(text);

    if (characters.length <= maximumLength) {
        return text;
    }

    return (
        characters
            .slice(0, maximumLength)
            .join('') + '…'
    );
}

function toFiniteNumber(
    value: number | string | null | undefined
): number | null {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? value
            : null;
    }

    const normalized = String(value)
        .trim()
        .replace(/,/g, '');

    if (!normalized) {
        return null;
    }

    const result = Number(normalized);

    return Number.isFinite(result)
        ? result
        : null;
}

function formatNumeric(
    value: number,
    maximumFractionDigits = 2,
    minimumFractionDigits = 0
): string {
    return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits,
        maximumFractionDigits
    }).format(value);
}

function formatNumber(
    value: number | string | null | undefined,
    maximumFractionDigits = 2
): string {
    const numericValue = toFiniteNumber(value);

    if (numericValue === null) {
        return '暂无';
    }

    return formatNumeric(
        numericValue,
        maximumFractionDigits
    );
}

/**
 * 接口积分需要除以 100。
 */
function formatRealPoint(
    rawPoint: number | string | null | undefined
): string {
    const numericPoint = toFiniteNumber(rawPoint);

    if (numericPoint === null) {
        return '暂无';
    }

    const realPoint = numericPoint / 100;

    return formatNumeric(
        realPoint,
        2,
        Number.isInteger(realPoint) ? 0 : 2
    );
}

/**
 * 接口在线时间单位为秒，渲染时转换成分钟。
 */
function formatOnlineMinutes(
    rawSeconds: number | string | null | undefined,
    fractionDigits: number
): string {
    const seconds = toFiniteNumber(rawSeconds);

    if (seconds === null) {
        return '暂无';
    }

    const minutes = seconds / 60;

    return (
        formatNumeric(
            minutes,
            fractionDigits
        ) + ' 分钟'
    );
}

function normalizeTimestampString(
    value: string,
    naiveTimeZone: 'utc' | 'china'
): string {
    const text = value.trim();

    if (!text) {
        return '';
    }

    if (/^\d{10}$/.test(text)) {
        return String(Number(text) * 1000);
    }

    if (/^\d{13}$/.test(text)) {
        return text;
    }

    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
        return text.replace(' ', 'T');
    }

    const matched = text.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
    );

    if (!matched) {
        return text;
    }

    const [
        ,
        year,
        month,
        day,
        hour,
        minute,
        second = '00',
        millisecond = '000'
    ] = matched;

    const normalizedMillisecond =
        millisecond.padEnd(3, '0').slice(0, 3);

    const suffix =
        naiveTimeZone === 'china'
            ? '+08:00'
            : 'Z';

    return (
        `${year}-${month}-${day}` +
        `T${hour}:${minute}:${second}.` +
        `${normalizedMillisecond}${suffix}`
    );
}

function parseTimestamp(
    value: PlayerTimestamp,
    naiveTimeZone: 'utc' | 'china'
): Date | null {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    if (value instanceof Date) {
        const copiedDate = new Date(value.getTime());

        return Number.isNaN(copiedDate.getTime())
            ? null
            : copiedDate;
    }

    if (typeof value === 'number') {
        const milliseconds =
            Math.abs(value) < 1_000_000_000_000
                ? value * 1000
                : value;

        const date = new Date(milliseconds);

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    const normalized = normalizeTimestampString(
        String(value),
        naiveTimeZone
    );

    if (/^\d+$/.test(normalized)) {
        const date = new Date(Number(normalized));

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    const date = new Date(normalized);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}

function getChinaTimeParts(
    value: PlayerTimestamp,
    naiveTimeZone: 'utc' | 'china'
): Map<string, string> | null {
    const date = parseTimestamp(
        value,
        naiveTimeZone
    );

    if (!date) {
        return null;
    }

    const formatter = new Intl.DateTimeFormat(
        'zh-CN',
        {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }
    );

    return new Map(
        formatter
            .formatToParts(date)
            .map((part) => [
                part.type,
                part.value
            ])
    );
}

function formatChinaTime(
    value: PlayerTimestamp,
    naiveTimeZone: 'utc' | 'china',
    fallback = '暂无'
): string {
    const parts = getChinaTimeParts(
        value,
        naiveTimeZone
    );

    if (!parts) {
        return fallback;
    }

    return (
        `${parts.get('year')}-` +
        `${parts.get('month')}-` +
        `${parts.get('day')} ` +
        `${parts.get('hour')}:` +
        `${parts.get('minute')}:` +
        `${parts.get('second')}`
    );
}

function formatChinaShortTime(
    value: PlayerTimestamp,
    naiveTimeZone: 'utc' | 'china'
): string {
    const parts = getChinaTimeParts(
        value,
        naiveTimeZone
    );

    if (!parts) {
        return '--';
    }

    return (
        `${parts.get('month')}-` +
        `${parts.get('day')} ` +
        `${parts.get('hour')}:` +
        `${parts.get('minute')}`
    );
}

function getOnlineTheme(
    isOnline: boolean | null | undefined
): OnlineTheme {
    if (isOnline === true) {
        return {
            label: '当前在线',
            rawValue: 'TRUE',
            background: '#E8F5E9',
            foreground: '#2E7D32',
            indicator: '#4CAF50',
            symbol: '●',
            explanation: '玩家当前已连接服务器'
        };
    }

    if (isOnline === false) {
        return {
            label: '当前离线',
            rawValue: 'FALSE',
            background: '#FFEBEE',
            foreground: '#C62828',
            indicator: '#EF5350',
            symbol: '●',
            explanation: '玩家当前未连接服务器'
        };
    }

    return {
        label: '状态未知',
        rawValue: 'NULL',
        background: '#ECEFF1',
        foreground: '#546E7A',
        indicator: '#90A4AE',
        symbol: '?',
        explanation: '服务器未返回在线状态'
    };
}

function estimateTextWidth(
    text: string,
    fontSize: number
): number {
    let width = 0;

    for (const character of Array.from(text)) {
        const isAscii =
            /^[\u0000-\u00ff]$/.test(character);

        width += isAscii
            ? fontSize * 0.6
            : fontSize;
    }

    return width;
}

function normalizeAddresses(
    values:
        | Array<string | null | undefined>
        | null
        | undefined
): string[] {
    return Array.from(
        new Set(
            (values ?? [])
                .map((value) =>
                    String(value ?? '').trim()
                )
                .filter(Boolean)
        )
    );
}

function layoutAddressTags(
    addresses: string[],
    options: {
        x: number;
        y: number;
        width: number;
        maxItems: number;
        maxRows: number;
    }
): AddressLayout {
    const tags: AddressTag[] = [];

    const tagHeight = 28;
    const horizontalGap = 8;
    const verticalGap = 10;
    const fontSize = 12;
    const horizontalPadding = 14;

    let x = options.x;
    let y = options.y;
    let row = 1;

    for (const rawAddress of addresses) {
        if (tags.length >= options.maxItems) {
            break;
        }

        const text = truncateText(
            rawAddress,
            16
        );

        const tagWidth = Math.min(
            options.width,
            Math.max(
                54,
                estimateTextWidth(text, fontSize) +
                horizontalPadding * 2
            )
        );

        if (
            x + tagWidth >
            options.x + options.width &&
            x > options.x
        ) {
            row += 1;

            if (row > options.maxRows) {
                break;
            }

            x = options.x;
            y += tagHeight + verticalGap;
        }

        tags.push({
            text,
            x,
            y,
            width: tagWidth
        });

        x += tagWidth + horizontalGap;
    }

    return {
        total: addresses.length,
        displayed: tags.length,
        omitted: Math.max(
            0,
            addresses.length - tags.length
        ),
        tags
    };
}

function normalizeMoneyHistory(
    history:
        | PlayerMoneyHistoryItem[]
        | null
        | undefined
): MoneyHistoryPoint[] {
    return (history ?? [])
        .map((item) => ({
            money:
                toFiniteNumber(item.money) ??
                Number.NaN,
            timestamp: item.timestamp
        }))
        .filter((item) =>
            Number.isFinite(item.money)
        );
}

function sampleItems<T>(
    items: T[],
    maximumItems: number
): T[] {
    if (items.length <= maximumItems) {
        return [...items];
    }

    if (maximumItems <= 1) {
        return [items[items.length - 1]];
    }

    const result: T[] = [];

    for (
        let index = 0;
        index < maximumItems;
        index++
    ) {
        const sourceIndex = Math.round(
            index *
            (items.length - 1) /
            (maximumItems - 1)
        );

        result.push(items[sourceIndex]);
    }

    return result;
}

function createAvatarDataUrl(
    avatar:
        | Buffer
        | Uint8Array
        | null
        | undefined,
    mimeType: string
): string | null {
    if (!avatar || avatar.byteLength === 0) {
        return null;
    }

    return (
        `data:${mimeType};base64,` +
        Buffer.from(avatar).toString('base64')
    );
}

function createLayout(
    messageCount: number
): Layout {
    const identityTitleY = 194;
    const identityCardY =
        identityTitleY + TITLE_TO_CARD_GAP;
    const identityCardHeight = 168;

    const addressTitleY =
        identityCardY +
        identityCardHeight +
        SECTION_GAP;

    const addressCardY =
        addressTitleY + TITLE_TO_CARD_GAP;

    const addressCardHeight = 140;

    const assetsTitleY =
        addressCardY +
        addressCardHeight +
        SECTION_GAP;

    const moneyCardY =
        assetsTitleY + TITLE_TO_CARD_GAP;

    const moneyCardHeight = 110;

    const statisticCardsY =
        moneyCardY +
        moneyCardHeight +
        16;

    const statisticCardHeight = 92;

    const timeTitleY =
        statisticCardsY +
        statisticCardHeight +
        SECTION_GAP;

    const timeCardY =
        timeTitleY + TITLE_TO_CARD_GAP;

    const timeCardHeight = 144;

    const historyTitleY =
        timeCardY +
        timeCardHeight +
        SECTION_GAP;

    const historyCardY =
        historyTitleY + TITLE_TO_CARD_GAP;

    const historyCardHeight = 176;

    const messagesTitleY =
        historyCardY +
        historyCardHeight +
        SECTION_GAP;

    const messagesCardY =
        messagesTitleY + TITLE_TO_CARD_GAP;

    const effectiveMessageCount =
        Math.max(1, messageCount);

    const messagesCardHeight =
        20 + effectiveMessageCount * 46 + 20;

    const footerY =
        messagesCardY +
        messagesCardHeight +
        22;

    const svgHeight = footerY + 42;

    return {
        svgWidth: SVG_WIDTH,
        svgHeight,

        outerMargin: OUTER_MARGIN,

        cardX: OUTER_MARGIN,
        cardY: OUTER_MARGIN,
        cardWidth: SVG_WIDTH - OUTER_MARGIN * 2,
        cardHeight: svgHeight - OUTER_MARGIN * 2,

        contentX: CONTENT_X,
        contentRight: CONTENT_RIGHT,
        contentWidth: CONTENT_WIDTH,
        contentCenterX:
            CONTENT_X + CONTENT_WIDTH / 2,

        headerDividerY: 170,

        identityTitleY,
        identityCardY,
        identityCardHeight,

        addressTitleY,
        addressCardY,
        addressCardHeight,

        assetsTitleY,
        moneyCardY,
        moneyCardHeight,
        statisticCardsY,
        statisticCardHeight,

        timeTitleY,
        timeCardY,
        timeCardHeight,

        historyTitleY,
        historyCardY,
        historyCardHeight,

        messagesTitleY,
        messagesCardY,
        messagesCardHeight,

        footerY
    };
}

function renderSectionTitle(
    number: string,
    title: string,
    y: number,
    summary?: string
): string {
    return `
        <text
            x="${CONTENT_X}"
            y="${y}"
            class="section-title"
        >${escapeXml(number)}　${escapeXml(title)}</text>

        ${
        summary
            ? `
                    <text
                        x="${CONTENT_RIGHT}"
                        y="${y}"
                        class="section-summary"
                    >${escapeXml(summary)}</text>
                `
            : ''
    }
    `;
}

function renderAddressTags(
    layout: AddressLayout
): string {
    return layout.tags
        .map((tag) => `
            <rect
                x="${tag.x}"
                y="${tag.y}"
                width="${tag.width}"
                height="28"
                rx="4"
                fill="#E1F5FE"
            />

            <text
                x="${tag.x + tag.width / 2}"
                y="${tag.y + 14}"
                class="address-tag"
            >${escapeXml(tag.text)}</text>
        `)
        .join('');
}

function renderMoneyChart(
    history: MoneyHistoryPoint[],
    layout: Layout,
    naiveTimeZone: 'utc' | 'china'
): string {
    if (history.length === 0) {
        return `
            <text
                x="${layout.contentCenterX}"
                y="${
            layout.historyCardY +
            layout.historyCardHeight / 2
        }"
                class="empty-text"
            >暂无金币历史数据</text>
        `;
    }

    const left = layout.contentX + 36;
    const right = layout.contentRight - 36;
    const top = layout.historyCardY + 26;
    const bottom = layout.historyCardY + 118;
    const timeY = layout.historyCardY + 151;

    const values = history.map(
        (item) => item.money
    );

    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = maximum - minimum || 1;

    const points = history.map(
        (item, index) => {
            const x =
                history.length === 1
                    ? (left + right) / 2
                    : left +
                    index *
                    (right - left) /
                    (history.length - 1);

            const y =
                bottom -
                ((item.money - minimum) / range) *
                (bottom - top);

            return {
                ...item,
                x,
                y
            };
        }
    );

    const polyline = points
        .map((point) =>
            `${point.x},${point.y}`
        )
        .join(' ');

    const pointElements = points
        .map((point, index) => {
            const isLast =
                index === points.length - 1;

            const valueY =
                point.y < top + 20
                    ? point.y + 18
                    : point.y - 13;

            return `
                <circle
                    cx="${point.x}"
                    cy="${point.y}"
                    r="${isLast ? 6 : 5}"
                    fill="${
                isLast
                    ? '#03A9F4'
                    : '#FFFFFF'
            }"
                    stroke="#0288D1"
                    stroke-width="2"
                />

                <text
                    x="${point.x}"
                    y="${valueY}"
                    font-size="9"
                    font-weight="${
                isLast ? 700 : 500
            }"
                    fill="${
                isLast
                    ? '#0277BD'
                    : '#607D8B'
            }"
                    text-anchor="middle"
                    dominant-baseline="middle"
                >${escapeXml(
                formatNumber(point.money, 2)
            )}</text>

                <text
                    x="${point.x}"
                    y="${timeY}"
                    font-size="9"
                    fill="#78909C"
                    text-anchor="middle"
                    dominant-baseline="middle"
                >${escapeXml(
                formatChinaShortTime(
                    point.timestamp,
                    naiveTimeZone
                )
            )}</text>
            `;
        })
        .join('');

    return `
        <line
            x1="${left}"
            y1="${top}"
            x2="${right}"
            y2="${top}"
            stroke="#E3EBEF"
        />

        <line
            x1="${left}"
            y1="${(top + bottom) / 2}"
            x2="${right}"
            y2="${(top + bottom) / 2}"
            stroke="#E3EBEF"
        />

        <line
            x1="${left}"
            y1="${bottom}"
            x2="${right}"
            y2="${bottom}"
            stroke="#E3EBEF"
        />

        ${
        points.length > 1
            ? `
                    <polyline
                        points="${polyline}"
                        fill="none"
                        stroke="#03A9F4"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                `
            : ''
    }

        ${pointElements}
    `;
}

function renderMessages(
    messages: PlayerRecentMessage[],
    layout: Layout,
    naiveTimeZone: 'utc' | 'china'
): string {
    if (messages.length === 0) {
        return `
            <text
                x="${layout.contentCenterX}"
                y="${
            layout.messagesCardY +
            layout.messagesCardHeight / 2
        }"
                class="empty-text"
            >暂无最近消息</text>
        `;
    }

    const innerX = layout.contentX + 20;
    const innerRight = layout.contentRight - 20;

    return messages
        .map((message, index) => {
            const rowTop =
                layout.messagesCardY +
                20 +
                index * 46;

            const rowCenter = rowTop + 15;

            return `
                ${
                index > 0
                    ? `
                            <line
                                x1="${innerX}"
                                y1="${rowTop - 8}"
                                x2="${innerRight}"
                                y2="${rowTop - 8}"
                                stroke="#E3EBEF"
                            />
                        `
                    : ''
            }

                <rect
                    x="${innerX}"
                    y="${rowTop}"
                    width="100"
                    height="30"
                    rx="4"
                    fill="#E1F5FE"
                />

                <text
                    x="${innerX + 50}"
                    y="${rowCenter}"
                    font-size="10"
                    font-weight="600"
                    fill="#0277BD"
                    text-anchor="middle"
                    dominant-baseline="middle"
                >${escapeXml(
                truncateText(
                    message.area,
                    9,
                    '未知区域'
                )
            )}</text>

                <text
                    x="${innerX + 116}"
                    y="${rowCenter}"
                    font-size="12"
                    font-weight="500"
                    fill="#37474F"
                    dominant-baseline="middle"
                >${escapeXml(
                truncateText(
                    message.content,
                    34
                )
            )}</text>

                <text
                    x="${innerRight}"
                    y="${rowCenter}"
                    font-size="10"
                    fill="#78909C"
                    text-anchor="end"
                    dominant-baseline="middle"
                >${escapeXml(
                formatChinaTime(
                    message.create_time,
                    naiveTimeZone,
                    '时间未知'
                )
            )}</text>
            `;
        })
        .join('');
}

export function createPlayerCardSvg(
    data: PlayerInfoData,
    options: RenderPlayerCardOptions = {}
): string {
    const maxAddressItems = clampInteger(
        options.maxAddressItems ?? 20,
        1,
        500
    );

    const maxAddressRows = clampInteger(
        options.maxAddressRows ?? 3,
        1,
        10
    );

    const maxMoneyHistoryPoints =
        clampInteger(
            options.maxMoneyHistoryPoints ?? 8,
            1,
            30
        );

    const maxRecentMessages = clampInteger(
        options.maxRecentMessages ?? 3,
        1,
        10
    );

    const onlineMinutesFractionDigits =
        clampInteger(
            options.onlineMinutesFractionDigits ?? 2,
            0,
            6
        );

    const naiveTimeZone =
        options.naiveTimestampTimeZone ?? 'utc';

    const allMessages =
        data.recent_messages ?? [];

    const displayedMessages =
        allMessages.slice(
            0,
            maxRecentMessages
        );

    const layout = createLayout(
        displayedMessages.length
    );

    const onlineTheme = getOnlineTheme(
        data.is_online
    );

    const addresses = normalizeAddresses(
        data.address_list
    );

    const addressLayout = layoutAddressTags(
        addresses,
        {
            x: layout.contentX + 22,
            y: layout.addressCardY + 18,
            width: layout.contentWidth - 44,
            maxItems: maxAddressItems,
            maxRows: maxAddressRows
        }
    );

    const completeHistory =
        normalizeMoneyHistory(
            data.money_history
        );

    const displayedHistory = sampleItems(
        completeHistory,
        maxMoneyHistoryPoints
    );

    const historyOmitted =
        completeHistory.length -
        displayedHistory.length;

    const messageOmitted =
        allMessages.length -
        displayedMessages.length;

    const username = truncateText(
        data.username,
        24
    );

    const role = truncateText(
        data.role,
        18,
        '普通玩家'
    );

    const avatarDataUrl =
        createAvatarDataUrl(
            data.avatar,
            data.avatarMimeType ?? 'image/png'
        );

    const moneySource =
        data.money_source === 'realtime'
            ? '实时查询'
            : data.money_source === 'history'
                ? '历史快照'
                : truncateText(
                    data.money_source,
                    16,
                    '未知来源'
                );

    const moneyTime =
        data.money_source === 'realtime' &&
        !data.money_time
            ? '实时数据，无快照时间'
            : formatChinaTime(
                data.money_time,
                naiveTimeZone
            );

    const addressSummary =
        addresses.length === 0
            ? '暂无地区记录'
            : addressLayout.omitted > 0
                ? (
                    `共 ${addresses.length} 个 · ` +
                    `展示 ${addressLayout.displayed} 个 · ` +
                    `省略 ${addressLayout.omitted} 个`
                )
                : `共 ${addresses.length} 个 · 全部展示`;

    const historySummary =
        completeHistory.length === 0
            ? '暂无记录'
            : historyOmitted > 0
                ? (
                    `共 ${completeHistory.length} 条 · ` +
                    `展示 ${displayedHistory.length} 条 · ` +
                    `省略 ${historyOmitted} 条`
                )
                : (
                    `共 ${completeHistory.length} 条 · ` +
                    '全部展示'
                );

    const messageSummary =
        allMessages.length === 0
            ? '暂无消息'
            : messageOmitted > 0
                ? (
                    `共 ${allMessages.length} 条 · ` +
                    `展示 ${displayedMessages.length} 条 · ` +
                    `省略 ${messageOmitted} 条`
                )
                : `最近 ${displayedMessages.length} 条`;

    /*
     * 玩家身份卡布局
     *
     * 卡片高度：168
     * 内边距：24
     * 可用高度：120
     * 两个信息行中心：第 1 行 52，第 2 行 116
     *
     * 每行：
     * 标签中心在行中心 - 14
     * 内容中心在行中心 + 14
     */
    const identityInnerPadding = 24;

    const avatarSize = 120;
    const avatarX =
        layout.contentX + identityInnerPadding;

    const avatarY =
        layout.identityCardY +
        (layout.identityCardHeight - avatarSize) / 2;

    const leftColumnX =
        avatarX + avatarSize + 28;

    const rightColumnX =
        layout.contentX +
        layout.contentWidth / 2 +
        54;

    const identityRow1Center =
        layout.identityCardY + 52;

    const identityRow2Center =
        layout.identityCardY + 116;

    const labelOffset = -15;
    const valueOffset = 15;

    const statusWidth = 150;
    const statusHeight = 34;

    const statusX = rightColumnX;
    const statusY =
        identityRow1Center +
        valueOffset -
        statusHeight / 2;

    const avatarSvg = avatarDataUrl
        ? `
            <defs>
                <clipPath id="avatarClip">
                    <rect
                        x="${avatarX}"
                        y="${avatarY}"
                        width="${avatarSize}"
                        height="${avatarSize}"
                        rx="10"
                    />
                </clipPath>
            </defs>

            <image
                x="${avatarX}"
                y="${avatarY}"
                width="${avatarSize}"
                height="${avatarSize}"
                href="${avatarDataUrl}"
                preserveAspectRatio="xMidYMid slice"
                clip-path="url(#avatarClip)"
            />

            <rect
                x="${avatarX}"
                y="${avatarY}"
                width="${avatarSize}"
                height="${avatarSize}"
                rx="10"
                fill="none"
                stroke="#D8E4E9"
            />
        `
        : `
            <rect
                x="${avatarX}"
                y="${avatarY}"
                width="${avatarSize}"
                height="${avatarSize}"
                rx="10"
                fill="#E1F5FE"
                stroke="#D8E4E9"
            />

            <text
                x="${avatarX + avatarSize / 2}"
                y="${avatarY + avatarSize / 2}"
                font-size="44"
                font-weight="700"
                fill="#039BE5"
                text-anchor="middle"
                dominant-baseline="middle"
            >${escapeXml(
            Array.from(username)[0]
                ?.toUpperCase() ?? '?'
        )}</text>
        `;

    const addressContent =
        addresses.length === 0
            ? `
                <text
                    x="${layout.contentCenterX}"
                    y="${
                layout.addressCardY +
                layout.addressCardHeight / 2
            }"
                    class="empty-text"
                >暂无地区记录</text>
            `
            : renderAddressTags(addressLayout);

    const statisticGap = 18;

    const statisticWidth =
        (
            layout.contentWidth -
            statisticGap * 2
        ) / 3;

    const statisticX1 = layout.contentX;

    const statisticX2 =
        statisticX1 +
        statisticWidth +
        statisticGap;

    const statisticX3 =
        statisticX2 +
        statisticWidth +
        statisticGap;

    const statisticCenter1 =
        statisticX1 + statisticWidth / 2;

    const statisticCenter2 =
        statisticX2 + statisticWidth / 2;

    const statisticCenter3 =
        statisticX3 + statisticWidth / 2;

    const statisticLabelY =
        layout.statisticCardsY + 29;

    const statisticValueY =
        layout.statisticCardsY + 64;

    const timeInnerX = layout.contentX + 24;
    const timeInnerRight =
        layout.contentRight - 24;

    const timeColumnGap = 40;

    const timeColumnWidth =
        (
            timeInnerRight -
            timeInnerX -
            timeColumnGap
        ) / 2;

    const timeColumn1X = timeInnerX;

    const timeColumn2X =
        timeInnerX +
        timeColumnWidth +
        timeColumnGap;

    const timeRow1Center =
        layout.timeCardY + 39;

    const timeRow2Center =
        layout.timeCardY + 105;

    const timeLabelOffset = -12;
    const timeValueOffset = 13;

    return `
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${layout.svgWidth}"
    height="${layout.svgHeight}"
    viewBox="0 0 ${layout.svgWidth} ${layout.svgHeight}"
>
    <style>
        text {
            font-family:
                "Noto Sans CJK SC",
                "Source Han Sans SC",
                "Microsoft YaHei",
                sans-serif;
        }
        .section-title {
            font-size: 14px;
            font-weight: 700;
            fill: #0288D1;
            dominant-baseline: middle;
        }
        .section-summary {
            font-size: 11px;
            fill: #78909C;
            text-anchor: end;
            dominant-baseline: middle;
        }
        .field-label {
            font-size: 11px;
            font-weight: 400;
            fill: #78909C;
            dominant-baseline: middle;
        }
        .field-value {
            font-size: 14px;
            font-weight: 700;
            fill: #37474F;
            dominant-baseline: middle;
        }
        .address-tag {
            font-size: 12px;
            font-weight: 600;
            fill: #0277BD;
            text-anchor: middle;
            dominant-baseline: middle;
        }
        .empty-text {
            font-size: 14px;
            font-weight: 500;
            fill: #90A4AE;
            text-anchor: middle;
            dominant-baseline: middle;
        }
    </style>
    <!-- 背景 -->
    <rect
        width="${layout.svgWidth}"
        height="${layout.svgHeight}"
        fill="#F3F7F9"
    />
    <!-- 主容器 -->
    <rect
        x="${layout.cardX}"
        y="${layout.cardY}"
        width="${layout.cardWidth}"
        height="${layout.cardHeight}"
        rx="10"
        fill="#FFFFFF"
        stroke="#D8E4E9"
    />
    <!-- 顶部蓝色装饰线 -->
    <rect
        x="${layout.cardX}"
        y="${layout.cardY}"
        width="${layout.cardWidth}"
        height="7"
        rx="3.5"
        fill="#03A9F4"
    />
    <!-- 页头 -->
    <text
        x="${layout.contentX}"
        y="68"
        font-size="12"
        font-weight="700"
        letter-spacing="1.5"
        fill="#0288D1"
        dominant-baseline="middle"
    >PLAYER INFORMATION</text>
    <text
        x="${layout.contentX}"
        y="105"
        font-size="28"
        font-weight="700"
        fill="#263238"
        dominant-baseline="middle"
    >玩家数据档案</text>
    <text
        x="${layout.contentX}"
        y="139"
        font-size="12"
        fill="#78909C"
        dominant-baseline="middle"
    >所有时间均按中国标准时间显示 · Asia/Shanghai · UTC+8</text>
    <!-- 数据来源 -->
    <rect
        x="${layout.contentRight - 162}"
        y="58"
        width="162"
        height="34"
        rx="5"
        fill="#E1F5FE"
    />
    <text
        x="${layout.contentRight - 81}"
        y="75"
        font-size="12"
        font-weight="700"
        fill="#0277BD"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(moneySource)}</text>
    <!-- 顶部在线状态 -->
    <rect
        x="${layout.contentRight - 162}"
        y="104"
        width="162"
        height="36"
        rx="5"
        fill="${onlineTheme.background}"
    />
    <circle
        cx="${layout.contentRight - 141}"
        cy="122"
        r="8"
        fill="${onlineTheme.indicator}"
    />
    <text
        x="${layout.contentRight - 141}"
        y="122"
        font-size="10"
        font-weight="700"
        fill="#FFFFFF"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(onlineTheme.symbol)}</text>
    <text
        x="${layout.contentRight - 91}"
        y="122"
        font-size="12"
        font-weight="700"
        fill="${onlineTheme.foreground}"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(onlineTheme.label)}</text>
    <text
        x="${layout.contentRight - 14}"
        y="122"
        font-size="9"
        font-weight="600"
        fill="${onlineTheme.foreground}"
        text-anchor="end"
        dominant-baseline="middle"
    >${onlineTheme.rawValue}</text>
    <line
        x1="${layout.contentX}"
        y1="${layout.headerDividerY}"
        x2="${layout.contentRight}"
        y2="${layout.headerDividerY}"
        stroke="#E3EBEF"
    />
    <!-- 01 玩家身份 -->
    ${renderSectionTitle(
        '01',
        '玩家身份',
        layout.identityTitleY
    )}
    <rect
        x="${layout.contentX}"
        y="${layout.identityCardY}"
        width="${layout.contentWidth}"
        height="${layout.identityCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${avatarSvg}
    <!-- 第一行左侧：用户名 -->
    <text
        x="${leftColumnX}"
        y="${
        identityRow1Center +
        labelOffset
    }"
        class="field-label"
    >玩家名称 · USERNAME</text>
    <text
        x="${leftColumnX}"
        y="${
        identityRow1Center +
        valueOffset
    }"
        font-size="24"
        font-weight="700"
        fill="#263238"
        dominant-baseline="middle"
    >${escapeXml(username)}</text>
    <!-- 第一行右侧：在线状态 -->
    <text
        x="${rightColumnX}"
        y="${
        identityRow1Center +
        labelOffset
    }"
        class="field-label"
    >在线字段 · IS_ONLINE</text>
    <rect
        x="${statusX}"
        y="${statusY}"
        width="${statusWidth}"
        height="${statusHeight}"
        rx="5"
        fill="${onlineTheme.background}"
    />
    <text
        x="${statusX + 56}"
        y="${statusY + statusHeight / 2}"
        font-size="12"
        font-weight="700"
        fill="${onlineTheme.foreground}"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(onlineTheme.label)}</text>
    <text
        x="${statusX + statusWidth - 14}"
        y="${statusY + statusHeight / 2}"
        font-size="10"
        font-weight="700"
        fill="${onlineTheme.foreground}"
        text-anchor="end"
        dominant-baseline="middle"
    >${onlineTheme.rawValue}</text>
    <!-- 第二行左侧：角色 -->
    <text
        x="${leftColumnX}"
        y="${
        identityRow2Center +
        labelOffset
    }"
        class="field-label"
    >玩家角色 · ROLE</text>
    <text
        x="${leftColumnX}"
        y="${
        identityRow2Center +
        valueOffset
    }"
        class="field-value"
    >${escapeXml(role)}</text>
    <!-- 第二行右侧：状态解释 -->
    <text
        x="${rightColumnX}"
        y="${
        identityRow2Center +
        labelOffset
    }"
        class="field-label"
    >状态解释</text>
    <text
        x="${rightColumnX}"
        y="${
        identityRow2Center +
        valueOffset
    }"
        class="field-value"
    >${escapeXml(
        onlineTheme.explanation
    )}</text>
    <!-- 02 活跃地区 -->
    ${renderSectionTitle(
        '02',
        '活跃地区',
        layout.addressTitleY,
        addressSummary
    )}
    <rect
        x="${layout.contentX}"
        y="${layout.addressCardY}"
        width="${layout.contentWidth}"
        height="${layout.addressCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${addressContent}
    ${
        addressLayout.omitted > 0
            ? `
                <text
                    x="${layout.contentRight - 22}"
                    y="${
                layout.addressCardY +
                layout.addressCardHeight -
                18
            }"
                    font-size="11"
                    font-weight="600"
                    fill="#78909C"
                    text-anchor="end"
                    dominant-baseline="middle"
                >+${addressLayout.omitted} 个地区未展示</text>
            `
            : ''
    }
    <!-- 03 资产与统计 -->
    ${renderSectionTitle(
        '03',
        '资产与统计',
        layout.assetsTitleY
    )}
    <rect
        x="${layout.contentX}"
        y="${layout.moneyCardY}"
        width="${layout.contentWidth}"
        height="${layout.moneyCardHeight}"
        rx="7"
        fill="#E1F5FE"
    />
    <text
        x="${layout.contentX + 24}"
        y="${layout.moneyCardY + 30}"
        font-size="11"
        font-weight="600"
        fill="#0277BD"
        dominant-baseline="middle"
    >当前金币 · CURRENT BALANCE</text>
    <text
        x="${layout.contentX + 24}"
        y="${layout.moneyCardY + 73}"
        font-size="35"
        font-weight="700"
        fill="#01579B"
        dominant-baseline="middle"
    >${escapeXml(
        formatNumber(data.money, 2)
    )}</text>
    <text
        x="${layout.contentRight - 24}"
        y="${layout.moneyCardY + 27}"
        font-size="11"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="middle"
    >金币来源</text>
    <text
        x="${layout.contentRight - 24}"
        y="${layout.moneyCardY + 57}"
        font-size="16"
        font-weight="700"
        fill="#0277BD"
        text-anchor="end"
        dominant-baseline="middle"
    >${escapeXml(moneySource)}</text>
    <text
        x="${layout.contentRight - 24}"
        y="${layout.moneyCardY + 86}"
        font-size="10"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="middle"
    >${escapeXml(moneyTime)}</text>
    <!-- 积分 -->
    <rect
        x="${statisticX1}"
        y="${layout.statisticCardsY}"
        width="${statisticWidth}"
        height="${layout.statisticCardHeight}"
        rx="7"
        fill="#FFFFFF"
        stroke="#DCE8ED"
    />
    <text
        x="${statisticCenter1}"
        y="${statisticLabelY}"
        font-size="11"
        fill="#78909C"
        text-anchor="middle"
        dominant-baseline="middle"
    >玩家积分 · POINT</text>
    <text
        x="${statisticCenter1}"
        y="${statisticValueY}"
        font-size="24"
        font-weight="700"
        fill="#263238"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(
        formatRealPoint(data.point)
    )}</text>
    <!-- 消息数量 -->
    <rect
        x="${statisticX2}"
        y="${layout.statisticCardsY}"
        width="${statisticWidth}"
        height="${layout.statisticCardHeight}"
        rx="7"
        fill="#FFFFFF"
        stroke="#DCE8ED"
    />
    <text
        x="${statisticCenter2}"
        y="${statisticLabelY}"
        font-size="11"
        fill="#78909C"
        text-anchor="middle"
        dominant-baseline="middle"
    >累计消息 · MESSAGE COUNT</text>
    <text
        x="${statisticCenter2}"
        y="${statisticValueY}"
        font-size="24"
        font-weight="700"
        fill="#263238"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(
        formatNumber(
            data.message_count,
            0
        )
    )}</text>
    <!-- 在线时间 -->
    <rect
        x="${statisticX3}"
        y="${layout.statisticCardsY}"
        width="${statisticWidth}"
        height="${layout.statisticCardHeight}"
        rx="7"
        fill="#FFFFFF"
        stroke="#DCE8ED"
    />
    <text
        x="${statisticCenter3}"
        y="${statisticLabelY}"
        font-size="11"
        fill="#78909C"
        text-anchor="middle"
        dominant-baseline="middle"
    >累计在线 · ONLINE TIME</text>
    <text
        x="${statisticCenter3}"
        y="${statisticValueY}"
        font-size="21"
        font-weight="700"
        fill="#263238"
        text-anchor="middle"
        dominant-baseline="middle"
    >${escapeXml(
        formatOnlineMinutes(
            data.online_time,
            onlineMinutesFractionDigits
        )
    )}</text>
    <!-- 04 账户与活动时间 -->
    ${renderSectionTitle(
        '04',
        '账户与活动时间',
        layout.timeTitleY,
        '中国标准时间 · UTC+8'
    )}
    <rect
        x="${layout.contentX}"
        y="${layout.timeCardY}"
        width="${layout.contentWidth}"
        height="${layout.timeCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    <line
        x1="${timeInnerX}"
        y1="${layout.timeCardY + 72}"
        x2="${timeInnerRight}"
        y2="${layout.timeCardY + 72}"
        stroke="#E3EBEF"
    />
    <!-- 时间第一行 -->
    <text
        x="${timeColumn1X}"
        y="${
        timeRow1Center +
        timeLabelOffset
    }"
        class="field-label"
    >首次记录时间</text>
    <text
        x="${timeColumn1X}"
        y="${
        timeRow1Center +
        timeValueOffset
    }"
        class="field-value"
    >${escapeXml(
        formatChinaTime(
            data.first_record_time,
            naiveTimeZone
        )
    )}</text>
    <text
        x="${timeColumn2X}"
        y="${
        timeRow1Center +
        timeLabelOffset
    }"
        class="field-label"
    >最近进入服务器</text>
    <text
        x="${timeColumn2X}"
        y="${
        timeRow1Center +
        timeValueOffset
    }"
        class="field-value"
    >${escapeXml(
        formatChinaTime(
            data.last_join_time,
            naiveTimeZone
        )
    )}</text>
    <!-- 时间第二行 -->
    <text
        x="${timeColumn1X}"
        y="${
        timeRow2Center +
        timeLabelOffset
    }"
        class="field-label"
    >最近离开服务器</text>
    <text
        x="${timeColumn1X}"
        y="${
        timeRow2Center +
        timeValueOffset
    }"
        class="field-value"
    >${escapeXml(
        formatChinaTime(
            data.last_leave_time,
            naiveTimeZone
        )
    )}</text>
    <text
        x="${timeColumn2X}"
        y="${
        timeRow2Center +
        timeLabelOffset
    }"
        class="field-label"
    >金币快照时间</text>
    <text
        x="${timeColumn2X}"
        y="${
        timeRow2Center +
        timeValueOffset
    }"
        class="field-value"
    >${escapeXml(moneyTime)}</text>
    <!-- 05 金币历史 -->
    ${renderSectionTitle(
        '05',
        '金币历史',
        layout.historyTitleY,
        historySummary
    )}
    <rect
        x="${layout.contentX}"
        y="${layout.historyCardY}"
        width="${layout.contentWidth}"
        height="${layout.historyCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${renderMoneyChart(
        displayedHistory,
        layout,
        naiveTimeZone
    )}
    <!-- 06 最近消息 -->
    ${renderSectionTitle(
        '06',
        '最近消息',
        layout.messagesTitleY,
        messageSummary
    )}
    <rect
        x="${layout.contentX}"
        y="${layout.messagesCardY}"
        width="${layout.contentWidth}"
        height="${layout.messagesCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${renderMessages(
        displayedMessages,
        layout,
        naiveTimeZone
    )}
    <!-- 页脚 -->
    <text
        x="${layout.contentX}"
        y="${layout.footerY}"
        font-size="10"
        fill="#90A4AE"
        dominant-baseline="middle"
    >PLAYER DATA · MATERIAL LIGHT BLUE</text>
    <text
        x="${layout.contentRight}"
        y="${layout.footerY}"
        font-size="10"
        fill="#90A4AE"
        text-anchor="end"
        dominant-baseline="middle"
    >TIME ZONE · ASIA/SHANGHAI</text>
</svg>
    `.trim();
}

export function renderPlayerCardPng(
    data: PlayerInfoData,
    options: RenderPlayerCardOptions = {}
): Buffer {
    const svg = createPlayerCardSvg(
        data,
        options
    );

    const outputWidth = Math.max(
        300,
        Math.round(
            options.outputWidth ?? 900
        )
    );

    const resvg = new Resvg(svg, {
        fitTo: {
            mode: 'width',
            value: outputWidth
        },
        font: {
            fontFiles:
                options.fontFiles ?? [],
            loadSystemFonts: true,
            defaultFontFamily:
                options.defaultFontFamily ??
                'Noto Sans CJK SC'
        }
    });

    return Buffer.from(
        resvg.render().asPng()
    );
}