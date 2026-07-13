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
    avatarMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';

    username: string | number;
    money: number | string;

    /**
     * 接口原始积分。
     * 渲染时自动除以 100。
     */
    point?: number | string | null;

    message_count?: number | string | null;

    /**
     * 接口原始在线时间，单位为秒。
     * 渲染时自动转换为分钟。
     */
    online_time?: number | string | null;

    role?: string | null;

    /**
     * true：在线
     * false：离线
     * null/undefined：状态未知
     */
    is_online?: boolean | null;

    first_record_time?: PlayerTimestamp;
    last_join_time?: PlayerTimestamp;
    last_leave_time?: PlayerTimestamp;

    address_list?: Array<string | null | undefined> | null;
    recent_messages?: PlayerRecentMessage[] | null;
    money_history?: PlayerMoneyHistoryItem[] | null;

    money_source?: 'realtime' | 'history' | string | null;
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
     * 不携带时区信息的时间字符串如何解释。
     *
     * utc：
     * 按 UTC 解析，再转换为中国时区。
     *
     * china：
     * 直接按中国时区解析。
     */
    naiveTimestampTimeZone?: 'utc' | 'china';

    /**
     * 在线分钟数最多显示几位小数。
     * 默认为 2。
     */
    onlineMinutesFractionDigits?: number;
}

interface OnlineStatusTheme {
    label: string;
    rawValue: string;
    background: string;
    foreground: string;
    indicator: string;
    symbol: string;
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

interface NormalizedMoneyHistoryItem {
    money: number;
    timestamp: PlayerTimestamp;
}

interface CardLayout {
    width: number;
    height: number;

    pageMargin: number;
    cardX: number;
    cardY: number;
    cardWidth: number;
    cardHeight: number;

    contentX: number;
    contentWidth: number;
    contentRight: number;

    headerY: number;
    identityTitleY: number;
    identityCardY: number;

    addressTitleY: number;
    addressCardY: number;
    addressCardHeight: number;

    statisticsTitleY: number;
    moneyCardY: number;
    statisticsCardsY: number;

    timeTitleY: number;
    timeCardY: number;

    historyTitleY: number;
    historyCardY: number;

    messagesTitleY: number;
    messagesCardY: number;
    messagesCardHeight: number;

    footerY: number;
}

const SVG_WIDTH = 900;
const PAGE_MARGIN = 24;
const CONTENT_INSET = 28;
const CONTENT_X = PAGE_MARGIN + CONTENT_INSET;
const CONTENT_WIDTH =
    SVG_WIDTH - PAGE_MARGIN * 2 - CONTENT_INSET * 2;
const CONTENT_RIGHT = CONTENT_X + CONTENT_WIDTH;

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
    maximumLength: number
): string {
    const text = String(value ?? '').trim();

    if (!text) {
        return '暂无';
    }

    const characters = Array.from(text);

    if (characters.length <= maximumLength) {
        return text;
    }

    return `${characters
        .slice(0, maximumLength)
        .join('')}…`;
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

    const numericValue = Number(normalized);

    return Number.isFinite(numericValue)
        ? numericValue
        : null;
}

function formatNumericValue(
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
    maximumFractionDigits = 2,
    minimumFractionDigits = 0
): string {
    const numericValue = toFiniteNumber(value);

    if (numericValue === null) {
        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {
            return '暂无';
        }

        return truncateText(value, 30);
    }

    return formatNumericValue(
        numericValue,
        maximumFractionDigits,
        minimumFractionDigits
    );
}

/**
 * 真实积分 = 接口原始积分 / 100。
 */
function formatRealPoint(
    rawPoint: number | string | null | undefined
): string {
    const numericPoint = toFiniteNumber(rawPoint);

    if (numericPoint === null) {
        return '暂无';
    }

    const actualPoint = numericPoint / 100;

    return formatNumericValue(
        actualPoint,
        2,
        Number.isInteger(actualPoint) ? 0 : 2
    );
}

/**
 * 在线时间的接口单位为秒。
 * 展示单位统一转换为分钟。
 */
function formatOnlineMinutes(
    rawSeconds: number | string | null | undefined,
    maximumFractionDigits: number
): string {
    const numericSeconds = toFiniteNumber(rawSeconds);

    if (numericSeconds === null) {
        return '暂无';
    }

    const minutes = numericSeconds / 60;
    const fractionDigits = clampInteger(
        maximumFractionDigits,
        0,
        6
    );

    return (
        formatNumericValue(
            minutes,
            fractionDigits,
            0
        ) + ' 分钟'
    );
}

function normalizeTimestampString(
    value: string,
    naiveTimestampTimeZone: 'utc' | 'china'
): string {
    const trimmed = value.trim();

    if (!trimmed) {
        return '';
    }

    if (/^\d{10}$/.test(trimmed)) {
        return String(Number(trimmed) * 1000);
    }

    if (/^\d{13}$/.test(trimmed)) {
        return trimmed;
    }

    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
        return trimmed.replace(' ', 'T');
    }

    const matched = trimmed.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
    );

    if (!matched) {
        return trimmed;
    }

    const [
        ,
        year,
        month,
        day,
        hour,
        minute,
        second = '00',
        milliseconds = '000'
    ] = matched;

    const normalizedMilliseconds =
        milliseconds.padEnd(3, '0').slice(0, 3);

    const suffix =
        naiveTimestampTimeZone === 'china'
            ? '+08:00'
            : 'Z';

    return (
        `${year}-${month}-${day}` +
        `T${hour}:${minute}:${second}.` +
        `${normalizedMilliseconds}${suffix}`
    );
}

function parseTimestamp(
    value: PlayerTimestamp,
    naiveTimestampTimeZone: 'utc' | 'china'
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
        naiveTimestampTimeZone
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
    naiveTimestampTimeZone: 'utc' | 'china'
): Map<string, string> | null {
    const date = parseTimestamp(
        value,
        naiveTimestampTimeZone
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
            .map((part) => [part.type, part.value])
    );
}

function formatChinaTime(
    value: PlayerTimestamp,
    naiveTimestampTimeZone: 'utc' | 'china',
    fallback = '暂无'
): string {
    const parts = getChinaTimeParts(
        value,
        naiveTimestampTimeZone
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
    naiveTimestampTimeZone: 'utc' | 'china'
): string {
    const parts = getChinaTimeParts(
        value,
        naiveTimestampTimeZone
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

function getOnlineStatus(
    isOnline: boolean | null | undefined
): OnlineStatusTheme {
    if (isOnline === true) {
        return {
            label: '当前在线',
            rawValue: 'TRUE',
            background: '#E8F5E9',
            foreground: '#2E7D32',
            indicator: '#4CAF50',
            symbol: '●'
        };
    }

    if (isOnline === false) {
        return {
            label: '当前离线',
            rawValue: 'FALSE',
            background: '#FFEBEE',
            foreground: '#C62828',
            indicator: '#EF5350',
            symbol: '●'
        };
    }

    return {
        label: '状态未知',
        rawValue: 'NULL',
        background: '#ECEFF1',
        foreground: '#546E7A',
        indicator: '#90A4AE',
        symbol: '?'
    };
}

function estimateTextWidth(
    text: string,
    fontSize: number
): number {
    let width = 0;

    for (const character of Array.from(text)) {
        width += /^[\u0000-\u00ff]$/.test(character)
            ? fontSize * 0.58
            : fontSize;
    }

    return width;
}

function normalizeAddressList(
    addressList:
        | Array<string | null | undefined>
        | null
        | undefined
): string[] {
    return Array.from(
        new Set(
            (addressList ?? [])
                .map((item) =>
                    String(item ?? '').trim()
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
    const horizontalPadding = 14;
    const fontSize = 12;

    let currentX = options.x;
    let currentY = options.y;
    let currentRow = 1;

    for (const originalAddress of addresses) {
        if (tags.length >= options.maxItems) {
            break;
        }

        const address = truncateText(
            originalAddress,
            16
        );

        const tagWidth = Math.min(
            options.width,
            Math.max(
                54,
                estimateTextWidth(address, fontSize) +
                horizontalPadding * 2
            )
        );

        const rightBoundary =
            options.x + options.width;

        if (
            currentX + tagWidth > rightBoundary &&
            currentX > options.x
        ) {
            currentRow += 1;

            if (currentRow > options.maxRows) {
                break;
            }

            currentX = options.x;
            currentY += tagHeight + verticalGap;
        }

        tags.push({
            text: address,
            x: currentX,
            y: currentY,
            width: tagWidth
        });

        currentX += tagWidth + horizontalGap;
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

function sampleHistory<T>(
    values: T[],
    maximumPoints: number
): T[] {
    if (
        maximumPoints <= 0 ||
        values.length === 0
    ) {
        return [];
    }

    if (values.length <= maximumPoints) {
        return [...values];
    }

    if (maximumPoints === 1) {
        return [values[values.length - 1]];
    }

    const result: T[] = [];

    for (
        let index = 0;
        index < maximumPoints;
        index++
    ) {
        const sourceIndex = Math.round(
            index *
            (values.length - 1) /
            (maximumPoints - 1)
        );

        result.push(values[sourceIndex]);
    }

    return result;
}

function normalizeMoneyHistory(
    history:
        | PlayerMoneyHistoryItem[]
        | null
        | undefined
): NormalizedMoneyHistoryItem[] {
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

function buildCardLayout(
    displayedMessageCount: number
): CardLayout {
    const identityTitleY = 184;
    const identityCardY = 216;
    const identityCardHeight = 150;

    const addressTitleY =
        identityCardY + identityCardHeight + 28;
    const addressCardY = addressTitleY + 30;
    const addressCardHeight = 140;

    const statisticsTitleY =
        addressCardY + addressCardHeight + 28;
    const moneyCardY = statisticsTitleY + 30;
    const moneyCardHeight = 110;

    const statisticsCardsY =
        moneyCardY + moneyCardHeight + 16;
    const statisticsCardsHeight = 90;

    const timeTitleY =
        statisticsCardsY +
        statisticsCardsHeight +
        28;
    const timeCardY = timeTitleY + 30;
    const timeCardHeight = 134;

    const historyTitleY =
        timeCardY + timeCardHeight + 28;
    const historyCardY = historyTitleY + 30;
    const historyCardHeight = 170;

    const messagesTitleY =
        historyCardY + historyCardHeight + 28;
    const messagesCardY = messagesTitleY + 30;

    const messageRows = Math.max(
        1,
        displayedMessageCount
    );

    const messagesCardHeight =
        24 + messageRows * 46 + 16;

    const footerY =
        messagesCardY +
        messagesCardHeight +
        18;

    const height = footerY + 40;
    const cardHeight = height - PAGE_MARGIN * 2;

    return {
        width: SVG_WIDTH,
        height,

        pageMargin: PAGE_MARGIN,
        cardX: PAGE_MARGIN,
        cardY: PAGE_MARGIN,
        cardWidth: SVG_WIDTH - PAGE_MARGIN * 2,
        cardHeight,

        contentX: CONTENT_X,
        contentWidth: CONTENT_WIDTH,
        contentRight: CONTENT_RIGHT,

        headerY: 58,
        identityTitleY,
        identityCardY,

        addressTitleY,
        addressCardY,
        addressCardHeight,

        statisticsTitleY,
        moneyCardY,
        statisticsCardsY,

        timeTitleY,
        timeCardY,

        historyTitleY,
        historyCardY,

        messagesTitleY,
        messagesCardY,
        messagesCardHeight,

        footerY
    };
}

function renderAddressTagsSvg(
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
                font-size="12"
                font-weight="600"
                fill="#0277BD"
                text-anchor="middle"
                dominant-baseline="central"
            >${escapeXml(tag.text)}</text>
        `)
        .join('');
}

function renderMoneyChartSvg(
    history: NormalizedMoneyHistoryItem[],
    cardY: number,
    naiveTimestampTimeZone: 'utc' | 'china'
): string {
    const centerX =
        CONTENT_X + CONTENT_WIDTH / 2;

    if (history.length === 0) {
        return `
            <text
                x="${centerX}"
                y="${cardY + 85}"
                font-size="14"
                font-weight="500"
                fill="#90A4AE"
                text-anchor="middle"
                dominant-baseline="central"
            >暂无金币历史数据</text>
        `;
    }

    const chartLeft = CONTENT_X + 36;
    const chartRight = CONTENT_RIGHT - 36;
    const chartTop = cardY + 24;
    const chartBottom = cardY + 112;
    const timeLabelY = cardY + 145;

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
                    ? (chartLeft + chartRight) / 2
                    : chartLeft +
                    index *
                    (chartRight - chartLeft) /
                    (history.length - 1);

            const y =
                chartBottom -
                ((item.money - minimum) / range) *
                (chartBottom - chartTop);

            return {
                ...item,
                x,
                y
            };
        }
    );

    const polylinePoints = points
        .map((point) =>
            `${point.x},${point.y}`
        )
        .join(' ');

    const pointSvg = points
        .map((point, index) => {
            const isLast =
                index === points.length - 1;

            const amountY =
                point.y <= chartTop + 16
                    ? point.y + 17
                    : point.y - 11;

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
                    y="${amountY}"
                    font-size="9"
                    font-weight="${
                isLast ? 700 : 500
            }"
                    fill="${
                isLast
                    ? '#0277BD'
                    : '#546E7A'
            }"
                    text-anchor="middle"
                    dominant-baseline="central"
                >${escapeXml(
                formatNumber(
                    point.money,
                    2
                )
            )}</text>

                <text
                    x="${point.x}"
                    y="${timeLabelY}"
                    font-size="9"
                    fill="#78909C"
                    text-anchor="middle"
                    dominant-baseline="central"
                >${escapeXml(
                formatChinaShortTime(
                    point.timestamp,
                    naiveTimestampTimeZone
                )
            )}</text>
            `;
        })
        .join('');

    return `
        <line
            x1="${chartLeft}"
            y1="${chartTop}"
            x2="${chartRight}"
            y2="${chartTop}"
            stroke="#E3EBEF"
        />

        <line
            x1="${chartLeft}"
            y1="${
        (chartTop + chartBottom) / 2
    }"
            x2="${chartRight}"
            y2="${
        (chartTop + chartBottom) / 2
    }"
            stroke="#E3EBEF"
        />

        <line
            x1="${chartLeft}"
            y1="${chartBottom}"
            x2="${chartRight}"
            y2="${chartBottom}"
            stroke="#E3EBEF"
        />

        ${
        points.length > 1
            ? `
                    <polyline
                        points="${polylinePoints}"
                        fill="none"
                        stroke="#03A9F4"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                `
            : ''
    }

        ${pointSvg}
    `;
}

function renderRecentMessagesSvg(
    messages: PlayerRecentMessage[],
    cardY: number,
    contentCenterX: number,
    naiveTimestampTimeZone: 'utc' | 'china'
): string {
    if (messages.length === 0) {
        return `
            <text
                x="${contentCenterX}"
                y="${cardY + 43}"
                font-size="14"
                fill="#90A4AE"
                text-anchor="middle"
                dominant-baseline="central"
            >暂无最近消息</text>
        `;
    }

    const innerX = CONTENT_X + 20;
    const innerRight = CONTENT_RIGHT - 20;
    const areaWidth = 100;
    const rowHeight = 46;

    return messages
        .map((message, index) => {
            const rowTop =
                cardY + 16 + index * rowHeight;
            const rowCenter = rowTop + 15;

            const area = truncateText(
                message.area || '未知区域',
                9
            );

            const content = truncateText(
                message.content,
                32
            );

            return `
                ${
                index > 0
                    ? `
                            <line
                                x1="${innerX}"
                                y1="${rowTop - 7}"
                                x2="${innerRight}"
                                y2="${rowTop - 7}"
                                stroke="#E3EBEF"
                            />
                        `
                    : ''
            }

                <rect
                    x="${innerX}"
                    y="${rowTop}"
                    width="${areaWidth}"
                    height="30"
                    rx="4"
                    fill="#E1F5FE"
                />

                <text
                    x="${innerX + areaWidth / 2}"
                    y="${rowCenter}"
                    font-size="10"
                    font-weight="600"
                    fill="#0277BD"
                    text-anchor="middle"
                    dominant-baseline="central"
                >${escapeXml(area)}</text>

                <text
                    x="${innerX + areaWidth + 16}"
                    y="${rowCenter}"
                    font-size="12"
                    font-weight="500"
                    fill="#37474F"
                    dominant-baseline="central"
                >${escapeXml(content)}</text>

                <text
                    x="${innerRight}"
                    y="${rowCenter}"
                    font-size="10"
                    fill="#78909C"
                    text-anchor="end"
                    dominant-baseline="central"
                >${escapeXml(
                formatChinaTime(
                    message.create_time,
                    naiveTimestampTimeZone,
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

    const naiveTimestampTimeZone =
        options.naiveTimestampTimeZone ?? 'utc';

    const completeMessages =
        data.recent_messages ?? [];

    const displayedMessages =
        completeMessages.slice(
            0,
            maxRecentMessages
        );

    const layout = buildCardLayout(
        displayedMessages.length
    );

    const onlineStatus = getOnlineStatus(
        data.is_online
    );

    const addresses = normalizeAddressList(
        data.address_list
    );

    const addressLayout = layoutAddressTags(
        addresses,
        {
            x: layout.contentX + 22,
            y: layout.addressCardY + 16,
            width: layout.contentWidth - 44,
            maxItems: maxAddressItems,
            maxRows: maxAddressRows
        }
    );

    const completeMoneyHistory =
        normalizeMoneyHistory(
            data.money_history
        );

    const sampledMoneyHistory =
        sampleHistory(
            completeMoneyHistory,
            maxMoneyHistoryPoints
        );

    const omittedHistoryCount = Math.max(
        0,
        completeMoneyHistory.length -
        sampledMoneyHistory.length
    );

    const omittedMessageCount = Math.max(
        0,
        completeMessages.length -
        displayedMessages.length
    );

    const avatarDataUrl =
        createAvatarDataUrl(
            data.avatar,
            data.avatarMimeType ??
            'image/png'
        );

    const username = truncateText(
        data.username,
        26
    );

    const role = truncateText(
        data.role || '普通玩家',
        18
    );

    const moneySource =
        data.money_source === 'history'
            ? '历史快照'
            : data.money_source === 'realtime'
                ? '实时查询'
                : truncateText(
                    data.money_source ||
                    '未知来源',
                    20
                );

    const moneyTime =
        data.money_source === 'realtime' &&
        !data.money_time
            ? '实时数据，无快照时间'
            : formatChinaTime(
                data.money_time,
                naiveTimestampTimeZone
            );

    const realPoint = formatRealPoint(
        data.point
    );

    const onlineMinutes =
        formatOnlineMinutes(
            data.online_time,
            onlineMinutesFractionDigits
        );

    const addressSummary =
        addressLayout.total === 0
            ? '暂无地区记录'
            : addressLayout.omitted > 0
                ? (
                    `共 ${addressLayout.total} 个 · ` +
                    `展示 ${addressLayout.displayed} 个 · ` +
                    `省略 ${addressLayout.omitted} 个`
                )
                : (
                    `共 ${addressLayout.total} 个 · ` +
                    '全部展示'
                );

    const historySummary =
        completeMoneyHistory.length === 0
            ? '暂无记录'
            : omittedHistoryCount > 0
                ? (
                    `共 ${completeMoneyHistory.length} 条 · ` +
                    `展示 ${sampledMoneyHistory.length} 条 · ` +
                    `省略 ${omittedHistoryCount} 条`
                )
                : (
                    `共 ${completeMoneyHistory.length} 条 · ` +
                    '全部展示'
                );

    const messageSummary =
        completeMessages.length === 0
            ? '暂无消息'
            : omittedMessageCount > 0
                ? (
                    `共 ${completeMessages.length} 条 · ` +
                    `展示 ${displayedMessages.length} 条 · ` +
                    `省略 ${omittedMessageCount} 条`
                )
                : `最近 ${displayedMessages.length} 条`;

    const avatarX = layout.contentX + 24;
    const avatarY = layout.identityCardY + 16;
    const avatarSize = 118;

    const leftInfoX = avatarX + avatarSize + 26;
    const rightInfoX =
        layout.contentX +
        layout.contentWidth / 2 +
        54;

    const statisticGap = 18;
    const statisticWidth =
        (layout.contentWidth -
            statisticGap * 2) /
        3;

    const statisticCenters = [
        layout.contentX +
        statisticWidth / 2,
        layout.contentX +
        statisticWidth +
        statisticGap +
        statisticWidth / 2,
        layout.contentX +
        (statisticWidth + statisticGap) *
        2 +
        statisticWidth / 2
    ];

    const timeColumnGap = 36;
    const timeColumnWidth =
        (layout.contentWidth -
            48 -
            timeColumnGap) /
        2;

    const timeLeftX =
        layout.contentX + 24;

    const timeRightX =
        timeLeftX +
        timeColumnWidth +
        timeColumnGap;

    const avatarSvg = avatarDataUrl
        ? `
            <defs>
                <clipPath id="avatarClip">
                    <rect
                        x="${avatarX}"
                        y="${avatarY}"
                        width="${avatarSize}"
                        height="${avatarSize}"
                        rx="8"
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
        `
        : `
            <rect
                x="${avatarX}"
                y="${avatarY}"
                width="${avatarSize}"
                height="${avatarSize}"
                rx="8"
                fill="#E1F5FE"
            />

            <text
                x="${avatarX + avatarSize / 2}"
                y="${avatarY + avatarSize / 2}"
                font-size="45"
                font-weight="700"
                fill="#039BE5"
                text-anchor="middle"
                dominant-baseline="central"
            >${escapeXml(
            Array.from(username)[0]
                ?.toUpperCase() || '?'
        )}</text>
        `;

    const addressTagsSvg =
        addressLayout.total === 0
            ? `
                <text
                    x="${
                layout.contentX +
                layout.contentWidth / 2
            }"
                    y="${
                layout.addressCardY +
                layout.addressCardHeight / 2
            }"
                    font-size="13"
                    fill="#90A4AE"
                    text-anchor="middle"
                    dominant-baseline="central"
                >暂无地区记录</text>
            `
            : renderAddressTagsSvg(
                addressLayout
            );

    const statusExplanation =
        data.is_online === null ||
        data.is_online === undefined
            ? '服务器未返回在线状态'
            : data.is_online
                ? '玩家当前已连接服务器'
                : '玩家当前未连接服务器';

    return `
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${layout.width}"
    height="${layout.height}"
    viewBox="0 0 ${layout.width} ${layout.height}"
>
    <style>
        text {
            font-family:
                "Noto Sans CJK SC",
                "Source Han Sans SC",
                "Microsoft YaHei",
                sans-serif;
        }
    </style>
    <!-- 页面背景 -->
    <rect
        width="${layout.width}"
        height="${layout.height}"
        fill="#F3F7F9"
    />
    <!-- 主容器：上下左右均为 24px -->
    <rect
        x="${layout.cardX}"
        y="${layout.cardY}"
        width="${layout.cardWidth}"
        height="${layout.cardHeight}"
        rx="10"
        fill="#FFFFFF"
        stroke="#D8E4E9"
    />
    <rect
        x="${layout.cardX}"
        y="${layout.cardY}"
        width="${layout.cardWidth}"
        height="7"
        rx="3.5"
        fill="#03A9F4"
    />
    <!-- 顶部信息 -->
    <text
        x="${layout.contentX}"
        y="62"
        font-size="12"
        font-weight="700"
        letter-spacing="1.5"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >PLAYER INFORMATION</text>
    <text
        x="${layout.contentX}"
        y="91"
        font-size="28"
        font-weight="700"
        fill="#263238"
        dominant-baseline="text-before-edge"
    >玩家数据档案</text>
    <text
        x="${layout.contentX}"
        y="132"
        font-size="12"
        fill="#78909C"
        dominant-baseline="text-before-edge"
    >所有时间均按中国标准时间显示 · Asia/Shanghai · UTC+8</text>
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
        dominant-baseline="central"
    >${escapeXml(moneySource)}</text>
    <rect
        x="${layout.contentRight - 162}"
        y="104"
        width="162"
        height="36"
        rx="5"
        fill="${onlineStatus.background}"
    />
    <circle
        cx="${layout.contentRight - 141}"
        cy="122"
        r="8"
        fill="${onlineStatus.indicator}"
    />
    <text
        x="${layout.contentRight - 141}"
        y="122"
        font-size="10"
        font-weight="700"
        fill="#FFFFFF"
        text-anchor="middle"
        dominant-baseline="central"
    >${escapeXml(onlineStatus.symbol)}</text>
    <text
        x="${layout.contentRight - 91}"
        y="122"
        font-size="12"
        font-weight="700"
        fill="${onlineStatus.foreground}"
        text-anchor="middle"
        dominant-baseline="central"
    >${escapeXml(onlineStatus.label)}</text>
    <text
        x="${layout.contentRight - 14}"
        y="122"
        font-size="9"
        font-weight="600"
        fill="${onlineStatus.foreground}"
        text-anchor="end"
        dominant-baseline="central"
    >${onlineStatus.rawValue}</text>
    <line
        x1="${layout.contentX}"
        y1="166"
        x2="${layout.contentRight}"
        y2="166"
        stroke="#E3EBEF"
    />
    <!-- 01 玩家身份 -->
    <text
        x="${layout.contentX}"
        y="${layout.identityTitleY}"
        font-size="14"
        font-weight="700"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >01　玩家身份</text>
    <rect
        x="${layout.contentX}"
        y="${layout.identityCardY}"
        width="${layout.contentWidth}"
        height="150"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${avatarSvg}
    <text
        x="${leftInfoX}"
        y="${layout.identityCardY + 22}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="text-before-edge"
    >玩家名称 · USERNAME</text>
    <text
        x="${leftInfoX}"
        y="${layout.identityCardY + 50}"
        font-size="25"
        font-weight="700"
        fill="#263238"
        dominant-baseline="text-before-edge"
    >${escapeXml(username)}</text>
    <text
        x="${leftInfoX}"
        y="${layout.identityCardY + 100}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="text-before-edge"
    >玩家角色 · ROLE</text>
    <text
        x="${leftInfoX}"
        y="${layout.identityCardY + 124}"
        font-size="14"
        font-weight="700"
        fill="#37474F"
        dominant-baseline="text-before-edge"
    >${escapeXml(role)}</text>
    <text
        x="${rightInfoX}"
        y="${layout.identityCardY + 22}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="text-before-edge"
    >在线字段 · IS_ONLINE</text>
    <rect
        x="${rightInfoX}"
        y="${layout.identityCardY + 47}"
        width="150"
        height="34"
        rx="5"
        fill="${onlineStatus.background}"
    />
    <text
        x="${rightInfoX + 54}"
        y="${layout.identityCardY + 64}"
        font-size="12"
        font-weight="700"
        fill="${onlineStatus.foreground}"
        text-anchor="middle"
        dominant-baseline="central"
    >${escapeXml(onlineStatus.label)}</text>
    <text
        x="${rightInfoX + 136}"
        y="${layout.identityCardY + 64}"
        font-size="10"
        font-weight="600"
        fill="${onlineStatus.foreground}"
        text-anchor="end"
        dominant-baseline="central"
    >${onlineStatus.rawValue}</text>
    <text
        x="${rightInfoX}"
        y="${layout.identityCardY + 100}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="text-before-edge"
    >状态解释</text>
    <text
        x="${rightInfoX}"
        y="${layout.identityCardY + 124}"
        font-size="13"
        font-weight="600"
        fill="#455A64"
        dominant-baseline="text-before-edge"
    >${escapeXml(statusExplanation)}</text>
    <!-- 02 活跃地区 -->
    <text
        x="${layout.contentX}"
        y="${layout.addressTitleY}"
        font-size="14"
        font-weight="700"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >02　活跃地区</text>
    <text
        x="${layout.contentRight}"
        y="${layout.addressTitleY + 1}"
        font-size="11"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="text-before-edge"
    >${escapeXml(addressSummary)}</text>
    <rect
        x="${layout.contentX}"
        y="${layout.addressCardY}"
        width="${layout.contentWidth}"
        height="${layout.addressCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${addressTagsSvg}
    ${
        addressLayout.omitted > 0
            ? `
                <text
                    x="${layout.contentRight - 22}"
                    y="${
                layout.addressCardY +
                layout.addressCardHeight -
                17
            }"
                    font-size="11"
                    font-weight="600"
                    fill="#78909C"
                    text-anchor="end"
                    dominant-baseline="central"
                >+${addressLayout.omitted} 个地区未展示</text>
            `
            : ''
    }
    <!-- 03 资产与统计 -->
    <text
        x="${layout.contentX}"
        y="${layout.statisticsTitleY}"
        font-size="14"
        font-weight="700"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >03　资产与统计</text>
    <rect
        x="${layout.contentX}"
        y="${layout.moneyCardY}"
        width="${layout.contentWidth}"
        height="110"
        rx="7"
        fill="#E1F5FE"
    />
    <text
        x="${layout.contentX + 24}"
        y="${layout.moneyCardY + 29}"
        font-size="11"
        font-weight="600"
        fill="#0277BD"
        dominant-baseline="central"
    >当前金币 · CURRENT BALANCE</text>
    <text
        x="${layout.contentX + 24}"
        y="${layout.moneyCardY + 72}"
        font-size="35"
        font-weight="700"
        fill="#01579B"
        dominant-baseline="central"
    >${escapeXml(
        formatNumber(data.money, 2)
    )}</text>
    <text
        x="${layout.contentRight - 24}"
        y="${layout.moneyCardY + 27}"
        font-size="11"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="central"
    >金币来源</text>
    <text
        x="${layout.contentRight - 24}"
        y="${layout.moneyCardY + 57}"
        font-size="16"
        font-weight="700"
        fill="#0277BD"
        text-anchor="end"
        dominant-baseline="central"
    >${escapeXml(moneySource)}</text>
    <text
        x="${layout.contentRight - 24}"
        y="${layout.moneyCardY + 86}"
        font-size="10"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="central"
    >${escapeXml(moneyTime)}</text>
    <!-- 三个等宽、等边距统计卡片 -->
    <rect
        x="${layout.contentX}"
        y="${layout.statisticsCardsY}"
        width="${statisticWidth}"
        height="90"
        rx="7"
        fill="#FFFFFF"
        stroke="#DCE8ED"
    />
    <text
        x="${statisticCenters[0]}"
        y="${layout.statisticsCardsY + 28}"
        font-size="11"
        fill="#78909C"
        text-anchor="middle"
        dominant-baseline="central"
    >玩家积分 · POINT</text>
    <text
        x="${statisticCenters[0]}"
        y="${layout.statisticsCardsY + 61}"
        font-size="24"
        font-weight="700"
        fill="#263238"
        text-anchor="middle"
        dominant-baseline="central"
    >${escapeXml(realPoint)}</text>
    <rect
        x="${
        layout.contentX +
        statisticWidth +
        statisticGap
    }"
        y="${layout.statisticsCardsY}"
        width="${statisticWidth}"
        height="90"
        rx="7"
        fill="#FFFFFF"
        stroke="#DCE8ED"
    />
    <text
        x="${statisticCenters[1]}"
        y="${layout.statisticsCardsY + 28}"
        font-size="11"
        fill="#78909C"
        text-anchor="middle"
        dominant-baseline="central"
    >累计消息 · MESSAGE COUNT</text>
    <text
        x="${statisticCenters[1]}"
        y="${layout.statisticsCardsY + 61}"
        font-size="24"
        font-weight="700"
        fill="#263238"
        text-anchor="middle"
        dominant-baseline="central"
    >${escapeXml(
        formatNumber(
            data.message_count,
            0
        )
    )}</text>
    <rect
        x="${
        layout.contentX +
        (statisticWidth +
            statisticGap) *
        2
    }"
        y="${layout.statisticsCardsY}"
        width="${statisticWidth}"
        height="90"
        rx="7"
        fill="#FFFFFF"
        stroke="#DCE8ED"
    />
    <text
        x="${statisticCenters[2]}"
        y="${layout.statisticsCardsY + 28}"
        font-size="11"
        fill="#78909C"
        text-anchor="middle"
        dominant-baseline="central"
    >累计在线 · ONLINE TIME</text>
    <text
        x="${statisticCenters[2]}"
        y="${layout.statisticsCardsY + 61}"
        font-size="22"
        font-weight="700"
        fill="#263238"
        text-anchor="middle"
        dominant-baseline="central"
    >${escapeXml(onlineMinutes)}</text>
    <!-- 04 时间信息 -->
    <text
        x="${layout.contentX}"
        y="${layout.timeTitleY}"
        font-size="14"
        font-weight="700"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >04　账户与活动时间</text>
    <text
        x="${layout.contentRight}"
        y="${layout.timeTitleY + 1}"
        font-size="11"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="text-before-edge"
    >中国标准时间 · UTC+8</text>
    <rect
        x="${layout.contentX}"
        y="${layout.timeCardY}"
        width="${layout.contentWidth}"
        height="134"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    <line
        x1="${layout.contentX + 24}"
        y1="${layout.timeCardY + 67}"
        x2="${layout.contentRight - 24}"
        y2="${layout.timeCardY + 67}"
        stroke="#E3EBEF"
    />
    <text
        x="${timeLeftX}"
        y="${layout.timeCardY + 22}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="central"
    >首次记录时间</text>
    <text
        x="${timeLeftX}"
        y="${layout.timeCardY + 46}"
        font-size="14"
        font-weight="700"
        fill="#37474F"
        dominant-baseline="central"
    >${escapeXml(
        formatChinaTime(
            data.first_record_time,
            naiveTimestampTimeZone
        )
    )}</text>
    <text
        x="${timeRightX}"
        y="${layout.timeCardY + 22}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="central"
    >最近进入服务器</text>
    <text
        x="${timeRightX}"
        y="${layout.timeCardY + 46}"
        font-size="14"
        font-weight="700"
        fill="#37474F"
        dominant-baseline="central"
    >${escapeXml(
        formatChinaTime(
            data.last_join_time,
            naiveTimestampTimeZone
        )
    )}</text>
    <text
        x="${timeLeftX}"
        y="${layout.timeCardY + 89}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="central"
    >最近离开服务器</text>
    <text
        x="${timeLeftX}"
        y="${layout.timeCardY + 113}"
        font-size="14"
        font-weight="700"
        fill="#37474F"
        dominant-baseline="central"
    >${escapeXml(
        formatChinaTime(
            data.last_leave_time,
            naiveTimestampTimeZone
        )
    )}</text>
    <text
        x="${timeRightX}"
        y="${layout.timeCardY + 89}"
        font-size="11"
        fill="#78909C"
        dominant-baseline="central"
    >金币快照时间</text>
    <text
        x="${timeRightX}"
        y="${layout.timeCardY + 113}"
        font-size="14"
        font-weight="700"
        fill="#37474F"
        dominant-baseline="central"
    >${escapeXml(moneyTime)}</text>
    <!-- 05 金币历史 -->
    <text
        x="${layout.contentX}"
        y="${layout.historyTitleY}"
        font-size="14"
        font-weight="700"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >05　金币历史</text>
    <text
        x="${layout.contentRight}"
        y="${layout.historyTitleY + 1}"
        font-size="11"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="text-before-edge"
    >${escapeXml(historySummary)}</text>
    <rect
        x="${layout.contentX}"
        y="${layout.historyCardY}"
        width="${layout.contentWidth}"
        height="170"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${renderMoneyChartSvg(
        sampledMoneyHistory,
        layout.historyCardY,
        naiveTimestampTimeZone
    )}
    <!-- 06 最近消息 -->
    <text
        x="${layout.contentX}"
        y="${layout.messagesTitleY}"
        font-size="14"
        font-weight="700"
        fill="#0288D1"
        dominant-baseline="text-before-edge"
    >06　最近消息</text>
    <text
        x="${layout.contentRight}"
        y="${layout.messagesTitleY + 1}"
        font-size="11"
        fill="#78909C"
        text-anchor="end"
        dominant-baseline="text-before-edge"
    >${escapeXml(messageSummary)}</text>
    <rect
        x="${layout.contentX}"
        y="${layout.messagesCardY}"
        width="${layout.contentWidth}"
        height="${layout.messagesCardHeight}"
        rx="7"
        fill="#FAFCFD"
        stroke="#DCE8ED"
    />
    ${renderRecentMessagesSvg(
        displayedMessages,
        layout.messagesCardY,
        layout.contentX +
        layout.contentWidth / 2,
        naiveTimestampTimeZone
    )}
    <!-- 页脚 -->
    <text
        x="${layout.contentX}"
        y="${layout.footerY}"
        font-size="10"
        fill="#90A4AE"
        dominant-baseline="central"
    >PLAYER DATA · MATERIAL LIGHT BLUE</text>
    <text
        x="${layout.contentRight}"
        y="${layout.footerY}"
        font-size="10"
        fill="#90A4AE"
        text-anchor="end"
        dominant-baseline="central"
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