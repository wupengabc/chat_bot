import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';

/* =========================================================
 * 对外类型
 * ======================================================= */

export interface PlayerMoneyData {
    /**
     * 玩家头像原始图片数据。
     *
     * 支持：
     * - PNG
     * - JPEG
     * - WebP
     * - GIF
     * - BMP
     * - SVG
     */
    avatar?: Buffer | Uint8Array | null;

    /**
     * 玩家名称或玩家 ID。
     */
    username: string | number;

    /**
     * 金币数量。
     */
    amount?: number | string;

    /**
     * 兼容旧字段拼写。
     *
     * @deprecated 请使用 amount
     */
    amout?: number | string;
}

export interface RenderPlayerMoneyOptions {
    /**
     * 图片宽度。
     *
     * 最小值：520
     * 最大值：2400
     * 默认值：760
     */
    width?: number;

    /**
     * 图片高度。
     *
     * 最小值：300
     * 最大值：1600
     * 默认值：350
     */
    height?: number;

    /**
     * 主标题。
     *
     * 默认值：PLAYER WALLET
     */
    title?: string;

    /**
     * 副标题。
     *
     * 默认值：玩家金币账户
     */
    subtitle?: string;

    /**
     * 金币单位。
     *
     * 默认值：金币
     */
    currencyName?: string;

    /**
     * 是否固定显示两位小数。
     *
     * 默认值：true
     */
    fixedDecimals?: boolean;

    /**
     * 自定义字体文件路径。
     */
    fontPath?: string;

    /**
     * 字体文件内部声明的 family name。
     *
     * 默认值：Noto Sans CJK SC
     */
    fontFamily?: string;

    /**
     * PNG 输出缩放倍率。
     *
     * 最小值：0.5
     * 最大值：4
     * 默认值：1
     */
    scale?: number;
}

/* =========================================================
 * 方案 4：珊瑚橙红主题
 * ======================================================= */

const THEME = {
    /**
     * 页面背景。
     */
    pageBackground: '#fff8f5',
    pageBackgroundSecondary: '#fbeee9',

    /**
     * 顶部强调色。
     */
    topBar: '#c75b4b',
    topBarLight: '#e69a8d',

    /**
     * 主卡片。
     */
    cardBackground: '#ffffff',
    cardBorder: '#e5c8c0',
    cardTopLine: '#d66c5c',

    /**
     * 标题。
     */
    title: '#5c302b',
    subtitle: '#987a73',

    /**
     * 玩家名称。
     */
    usernameLabel: '#9a7d76',
    usernameValue: '#694039',

    /**
     * 金额。
     */
    moneyLabel: '#956621',
    moneyValue: '#ca7c12',
    moneyValueLight: '#eba940',
    moneyUnit: '#9d702a',

    /**
     * 头像。
     */
    avatarBackground: '#faece8',
    avatarBorder: '#d8aaa0',
    avatarInnerBorder: '#ffffff',
    avatarFallback: '#c26051',

    /**
     * 分隔线。
     */
    separator: '#eeddd8',

    /**
     * 页脚与装饰。
     */
    footer: '#947d77',
    decorationCoral: '#dc8c7d',
    decorationGold: '#dda23a',

    /**
     * 状态。
     */
    online: '#46a16d',
    onlineBackground: '#edf8f1',
    onlineBorder: '#9ecdb0',
    onlineText: '#46815d'
} as const;

/* =========================================================
 * XML 工具
 * ======================================================= */

/**
 * 转义 XML 特殊字符。
 */
function escapeXml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * 清理字体名称，避免字体名称破坏 SVG。
 */
function sanitizeFontFamily(value: unknown): string {
    return String(value ?? '')
        .replace(/[\\'"`;{}<>]/g, '')
        .trim();
}

/* =========================================================
 * 通用数值工具
 * ======================================================= */

/**
 * 将数值限制在指定范围内。
 */
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

/**
 * 将任意值转换为有限数字。
 */
function toFiniteNumber(
    value: unknown,
    fallback: number
): number {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/* =========================================================
 * 金额处理
 * ======================================================= */

/**
 * 从玩家数据中获取金额。
 *
 * 同时兼容：
 * - amount
 * - amout
 */
function getMoneyAmount(
    player: PlayerMoneyData
): number {
    const rawValue =
        player.amount ??
        player.amout ??
        0;

    if (typeof rawValue === 'number') {
        return Number.isFinite(rawValue)
            ? rawValue
            : 0;
    }

    const normalized = String(rawValue)
        .replace(/,/g, '')
        .trim();

    const amount = Number(normalized);

    return Number.isFinite(amount)
        ? amount
        : 0;
}

/**
 * 格式化金额。
 */
function formatMoney(
    amount: number,
    fixedDecimals: boolean
): string {
    return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits:
            fixedDecimals ? 2 : 0,
        maximumFractionDigits: 2
    }).format(amount);
}

/* =========================================================
 * 头像处理
 * ======================================================= */

/**
 * 根据图片文件头识别 MIME 类型。
 */
function detectImageMimeType(
    data: Uint8Array
): string | null {
    /*
     * PNG：
     * 89 50 4E 47 0D 0A 1A 0A
     */
    if (
        data.length >= 8 &&
        data[0] === 0x89 &&
        data[1] === 0x50 &&
        data[2] === 0x4e &&
        data[3] === 0x47 &&
        data[4] === 0x0d &&
        data[5] === 0x0a &&
        data[6] === 0x1a &&
        data[7] === 0x0a
    ) {
        return 'image/png';
    }

    /*
     * JPEG：
     * FF D8 FF
     */
    if (
        data.length >= 3 &&
        data[0] === 0xff &&
        data[1] === 0xd8 &&
        data[2] === 0xff
    ) {
        return 'image/jpeg';
    }

    /*
     * GIF：
     * GIF87a / GIF89a
     */
    if (
        data.length >= 6 &&
        data[0] === 0x47 &&
        data[1] === 0x49 &&
        data[2] === 0x46 &&
        data[3] === 0x38 &&
        (
            data[4] === 0x37 ||
            data[4] === 0x39
        ) &&
        data[5] === 0x61
    ) {
        return 'image/gif';
    }

    /*
     * WebP：
     * RIFF....WEBP
     */
    if (
        data.length >= 12 &&
        data[0] === 0x52 &&
        data[1] === 0x49 &&
        data[2] === 0x46 &&
        data[3] === 0x46 &&
        data[8] === 0x57 &&
        data[9] === 0x45 &&
        data[10] === 0x42 &&
        data[11] === 0x50
    ) {
        return 'image/webp';
    }

    /*
     * BMP：
     * BM
     */
    if (
        data.length >= 2 &&
        data[0] === 0x42 &&
        data[1] === 0x4d
    ) {
        return 'image/bmp';
    }

    /*
     * SVG。
     *
     * SVG 可能以：
     * - <svg
     * - <?xml
     * - BOM
     * - 空白字符
     *
     * 开头。
     */
    if (data.length > 0) {
        const previewLength = Math.min(
            data.length,
            2048
        );
        const preview = Buffer.from(
            data.buffer,
            data.byteOffset,
            previewLength
        )
            .toString('utf8')
            .replace(/^\uFEFF/, '')
            .trimStart();
        if (
            preview.startsWith('<svg') ||
            (
                preview.startsWith('<?xml') &&
                preview.includes('<svg')
            )
        ) {
            return 'image/svg+xml';
        }
    }
    return null;
}
/**
 * 将头像数据转换成 SVG 可使用的 Data URL。
 */
function avatarToDataUrl(
    avatar: Buffer | Uint8Array | null | undefined
): string | null {
    if (
        !avatar ||
        avatar.byteLength === 0
    ) {
        return null;
    }
    const bytes = new Uint8Array(
        avatar.buffer,
        avatar.byteOffset,
        avatar.byteLength
    );
    const mimeType =
        detectImageMimeType(bytes);
    if (!mimeType) {
        return null;
    }
    const base64 = Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
    ).toString('base64');
    return `data:${mimeType};base64,${base64}`;
}
/**
 * 获取头像占位字符。
 */
function getAvatarFallbackText(
    username: string
): string {
    const characters = Array.from(
        username.trim()
    );
    if (characters.length === 0) {
        return '?';
    }
    return characters[0].toUpperCase();
}
/* =========================================================
 * SVG 图形工具
 * ======================================================= */
/**
 * 绘制直角矩形。
 *
 * 不设置 rx 和 ry，因此不会产生圆角。
 */
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
            ` stroke="${options.stroke}"`
        );
        attributes.push(
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
 * 绘制以顶部坐标为基准的文本。
 */
function svgTopText(
    text: string,
    x: number,
    y: number,
    options: {
        fontFamily: string;
        fontSize: number;
        fontWeight?: number;
        fill: string;
        anchor?: 'start' | 'middle' | 'end';
        letterSpacing?: number;
    }
): string {
    const attributes = [
        `<text x="${x}" y="${y}"`,
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
 * 绘制垂直居中的文本。
 */
function svgMiddleText(
    text: string,
    x: number,
    y: number,
    options: {
        fontFamily: string;
        fontSize: number;
        fontWeight?: number;
        fill: string;
        anchor?: 'start' | 'middle' | 'end';
        letterSpacing?: number;
    }
): string {
    const attributes = [
        `<text x="${x}" y="${y}"`,
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
 * 无 Canvas 文本宽度估算
 * ======================================================= */
/**
 * 判断字符是否接近全角字符。
 */
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
/**
 * 估算单个字符的显示宽度。
 */
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
/**
 * 估算字符串宽度。
 */
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
/**
 * 超出指定宽度时添加省略号。
 */
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
    let currentWidth = 0;
    let result = '';
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
/* =========================================================
 * 头像绘制
 * ======================================================= */
/**
 * 绘制矩形头像。
 *
 * 特点：
 * - 不使用圆角
 * - 不使用阴影
 * - 不进行圆形裁剪
 * - 不裁切头像
 * - 保持头像原始比例
 * - 比例不一致时用背景补齐
 */
function drawAvatar(
    avatarDataUrl: string | null,
    username: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontFamily: string
): string {
    const output: string[] = [];
    /*
     * 头像区域背景和外边框。
     */
    output.push(
        svgRect(
            x,
            y,
            width,
            height,
            {
                fill: THEME.avatarBackground,
                stroke: THEME.avatarBorder,
                strokeWidth: 2
            }
        )
    );
    if (avatarDataUrl) {
        /*
         * 预留内边距，避免头像覆盖边框。
         */
        const imagePadding = 4;
        const imageX =
            x + imagePadding;
        const imageY =
            y + imagePadding;
        const imageWidth = Math.max(
            1,
            width - imagePadding * 2
        );
        const imageHeight = Math.max(
            1,
            height - imagePadding * 2
        );
        /*
         * preserveAspectRatio="xMidYMid meet"
         *
         * xMidYMid：
         * 图片在头像区域内水平、垂直居中。
         *
         * meet：
         * 图片保持原始比例并完整显示。
         * 不会裁切图片。
         */
        output.push(
            [
                `<image x="${imageX}"`,
                ` y="${imageY}"`,
                ` width="${imageWidth}"`,
                ` height="${imageHeight}"`,
                ` href="${escapeXml(avatarDataUrl)}"`,
                ' preserveAspectRatio="xMidYMid meet"/>'
            ].join('')
        );
    } else {
        /*
         * 头像不可用时显示玩家名称首字符。
         */
        output.push(
            svgMiddleText(
                getAvatarFallbackText(username),
                x + width / 2,
                y + height / 2,
                {
                    fontFamily,
                    fontSize: Math.floor(
                        Math.min(width, height) * 0.42
                    ),
                    fontWeight: 700,
                    fill: THEME.avatarFallback,
                    anchor: 'middle'
                }
            )
        );
    }
    /*
     * 头像内边框。
     */
    output.push(
        svgRect(
            x + 4,
            y + 4,
            Math.max(
                1,
                width - 8
            ),
            Math.max(
                1,
                height - 8
            ),
            {
                fill: 'none',
                stroke: THEME.avatarInnerBorder,
                strokeWidth: 1
            }
        )
    );
    return output.join('');
}
/* =========================================================
 * SVG 渲染
 * ======================================================= */
/**
 * 生成玩家金币信息 SVG。
 */
export function renderPlayerMoneySvg(
    player: PlayerMoneyData,
    options: RenderPlayerMoneyOptions = {}
): string {
    if (
        !player ||
        typeof player !== 'object'
    ) {
        throw new TypeError(
            'player 必须是有效对象'
        );
    }
    /*
     * 画布尺寸。
     */
    const canvasWidth = clamp(
        Math.floor(
            toFiniteNumber(
                options.width,
                760
            )
        ),
        520,
        2400
    );
    const canvasHeight = clamp(
        Math.floor(
            toFiniteNumber(
                options.height,
                350
            )
        ),
        300,
        1600
    );
    /*
     * 字体。
     */
    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) ||
        'Noto Sans CJK SC';
    /*
     * 文本内容。
     */
    const title = String(
        options.title ??
        'PLAYER WALLET'
    );
    const subtitle = String(
        options.subtitle ??
        '玩家金币账户'
    );
    const currencyName = String(
        options.currencyName ??
        '金币'
    );
    const fixedDecimals =
        options.fixedDecimals !== false;
    const username =
        String(
            player.username ?? ''
        ).trim() ||
        '未知玩家';
    /*
     * 金额。
     */
    const amount =
        getMoneyAmount(player);
    const moneyText =
        formatMoney(
            amount,
            fixedDecimals
        );
    /*
     * 头像。
     */
    const avatarDataUrl =
        avatarToDataUrl(
            player.avatar
        );
    /*
     * 页面布局。
     */
    const outerPadding = 24;
    const headerHeight = 92;
    const footerHeight = 48;
    const cardX = outerPadding;
    const cardY = headerHeight + 24;
    const cardWidth =
        canvasWidth -
        outerPadding * 2;
    const availableCardHeight =
        canvasHeight -
        cardY -
        footerHeight -
        outerPadding;
    const cardHeight = Math.max(
        160,
        availableCardHeight
    );
    /*
     * 矩形头像尺寸。
     */
    const avatarWidth = Math.min(
        116,
        Math.max(
            94,
            Math.floor(
                cardWidth * 0.17
            )
        )
    );
    const avatarHeight = Math.min(
        126,
        Math.max(
            102,
            cardHeight - 42
        )
    );
    const avatarX =
        cardX + 22;
    const avatarY =
        cardY +
        Math.floor(
            (
                cardHeight -
                avatarHeight
            ) / 2
        );
    /*
     * 内容区域。
     */
    const contentX =
        avatarX +
        avatarWidth +
        26;
    const contentRight =
        cardX +
        cardWidth -
        26;
    const contentWidth = Math.max(
        100,
        contentRight -
        contentX
    );
    /*
     * 字体尺寸。
     */
    const usernameLabelSize = 14;
    const usernameSize = 22;
    const moneyLabelSize = 14;
    const currencyFontSize = 18;
    /*
     * 计算金币单位宽度。
     */
    const currencyWidth =
        estimateTextWidth(
            currencyName,
            currencyFontSize,
            600
        );
    /*
     * 根据可用空间自动缩小金额字号。
     */
    let moneyFontSize = 43;
    while (
        moneyFontSize > 24 &&
        estimateTextWidth(
            moneyText,
            moneyFontSize,
            700
        ) >
        contentWidth -
        currencyWidth -
        14
        ) {
        moneyFontSize--;
    }
    const moneyMaxWidth = Math.max(
        50,
        contentWidth -
        currencyWidth -
        14
    );
    /*
     * 防止超长金额溢出。
     */
    const safeMoneyText =
        ellipsisText(
            moneyText,
            moneyMaxWidth,
            moneyFontSize,
            700
        );
    /*
     * 玩家标签宽度。
     */
    const usernameLabelWidth =
        estimateTextWidth(
            '玩家',
            usernameLabelSize,
            500
        );
    /*
     * 防止玩家名称溢出。
     */
    const safeUsername =
        ellipsisText(
            username,
            Math.max(
                40,
                contentWidth -
                usernameLabelWidth -
                24
            ),
            usernameSize,
            600
        );
    /*
     * SVG 内容。
     */
    const svg: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` width="${canvasWidth}"`,
        ` height="${canvasHeight}"`,
        ` viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
        '<defs>',
        /*
         * 页面浅色渐变。
         */
        '<linearGradient',
        ' id="pageBackgroundGradient"',
        ' x1="0" y1="0"',
        ' x2="1" y2="1">',
        `<stop offset="0%" stop-color="${THEME.pageBackground}"/>`,
        `<stop offset="100%" stop-color="${THEME.pageBackgroundSecondary}"/>`,
        '</linearGradient>',
        /*
         * 金额文字渐变。
         */
        '<linearGradient',
        ' id="moneyTextGradient"',
        ' x1="0" y1="0"',
        ' x2="1" y2="0">',
        `<stop offset="0%" stop-color="${THEME.moneyValue}"/>`,
        `<stop offset="100%" stop-color="${THEME.moneyValueLight}"/>`,
        '</linearGradient>',
        '</defs>',
        /*
         * 页面背景。
         */
        svgRect(
            0,
            0,
            canvasWidth,
            canvasHeight,
            {
                fill: 'url(#pageBackgroundGradient)'
            }
        ),
        /*
         * 顶部主色线。
         */
        svgRect(
            0,
            0,
            canvasWidth,
            5,
            {
                fill: THEME.topBar
            }
        ),
        /*
         * 顶部浅色强调线。
         */
        svgRect(
            0,
            5,
            canvasWidth * 0.58,
            3,
            {
                fill: THEME.topBarLight
            }
        ),
        /*
         * 右上背景装饰块。
         */
        svgRect(
            canvasWidth - 118,
            8,
            118,
            68,
            {
                fill: THEME.decorationCoral,
                opacity: 0.08
            }
        ),
        svgRect(
            canvasWidth - 72,
            8,
            72,
            40,
            {
                fill: THEME.topBarLight,
                opacity: 0.09
            }
        ),
        /*
         * 左下背景装饰块。
         */
        svgRect(
            0,
            canvasHeight - 48,
            86,
            48,
            {
                fill: THEME.decorationGold,
                opacity: 0.07
            }
        ),
        /*
         * 标题左侧直角标记。
         */
        svgRect(
            outerPadding,
            24,
            5,
            52,
            {
                fill: THEME.topBar
            }
        ),
        svgRect(
            outerPadding + 9,
            24,
            2,
            52,
            {
                fill: THEME.topBarLight
            }
        ),
        /*
         * 主标题。
         */
        svgTopText(
            ellipsisText(
                title,
                canvasWidth - 160,
                29,
                700
            ),
            outerPadding + 24,
            19,
            {
                fontFamily,
                fontSize: 29,
                fontWeight: 700,
                fill: THEME.title,
                letterSpacing: 1.5
            }
        ),
        /*
         * 副标题。
         */
        svgTopText(
            ellipsisText(
                subtitle,
                canvasWidth - 160,
                15,
                400
            ),
            outerPadding + 25,
            60,
            {
                fontFamily,
                fontSize: 15,
                fontWeight: 400,
                fill: THEME.subtitle,
                letterSpacing: 0.5
            }
        ),
        /*
         * 右上角金币图标背景。
         *
         * 使用直角矩形。
         */
        svgRect(
            canvasWidth - 78,
            25,
            42,
            38,
            {
                fill: '#fff7e4',
                stroke: '#dcb151',
                strokeWidth: 2
            }
        ),
        /*
         * 金币符号。
         */
        svgMiddleText(
            '¥',
            canvasWidth - 57,
            44,
            {
                fontFamily,
                fontSize: 21,
                fontWeight: 700,
                fill: THEME.moneyValue,
                anchor: 'middle'
            }
        ),
        /*
         * 主卡片。
         *
         * 不使用圆角。
         * 不使用阴影。
         */
        svgRect(
            cardX,
            cardY,
            cardWidth,
            cardHeight,
            {
                fill: THEME.cardBackground,
                stroke: THEME.cardBorder,
                strokeWidth: 2
            }
        ),
        /*
         * 主卡片顶部强调线。
         */
        svgRect(
            cardX,
            cardY,
            cardWidth,
            5,
            {
                fill: THEME.cardTopLine
            }
        ),
        /*
         * 头像左侧装饰线。
         */
        svgRect(
            cardX + 12,
            avatarY - 10,
            4,
            avatarHeight + 20,
            {
                fill: THEME.topBarLight,
                opacity: 0.55
            }
        ),
        /*
         * 完整矩形头像。
         */
        drawAvatar(
            avatarDataUrl,
            username,
            avatarX,
            avatarY,
            avatarWidth,
            avatarHeight,
            fontFamily
        ),
        /*
         * 玩家标签。
         */
        svgTopText(
            '玩家',
            contentX,
            cardY + 24,
            {
                fontFamily,
                fontSize: usernameLabelSize,
                fontWeight: 500,
                fill: THEME.usernameLabel,
                letterSpacing: 1
            }
        ),
        /*
         * 玩家名称。
         */
        svgTopText(
            safeUsername,
            contentX +
            usernameLabelWidth +
            16,
            cardY + 18,
            {
                fontFamily,
                fontSize: usernameSize,
                fontWeight: 600,
                fill: THEME.usernameValue
            }
        ),
        /*
         * 内容分隔线。
         */
        svgRect(
            contentX,
            cardY + 62,
            contentWidth,
            1,
            {
                fill: THEME.separator
            }
        ),
        /*
         * 余额标签。
         */
        svgTopText(
            '当前余额',
            contentX,
            cardY + 75,
            {
                fontFamily,
                fontSize: moneyLabelSize,
                fontWeight: 500,
                fill: THEME.moneyLabel,
                letterSpacing: 1
            }
        ),
        /*
         * 金额。
         */
        svgTopText(
            safeMoneyText,
            contentX,
            cardY + 99,
            {
                fontFamily,
                fontSize: moneyFontSize,
                fontWeight: 700,
                fill: 'url(#moneyTextGradient)'
            }
        )
    ];
    /*
     * 计算实际金额文字宽度。
     */
    const safeMoneyWidth =
        estimateTextWidth(
            safeMoneyText,
            moneyFontSize,
            700
        );
    /*
     * 金币单位位置。
     */
    const currencyX = Math.min(
        contentRight - currencyWidth,
        contentX +
        safeMoneyWidth +
        12
    );
    svg.push(
        svgTopText(
            currencyName,
            currencyX,
            cardY + 120,
            {
                fontFamily,
                fontSize: currencyFontSize,
                fontWeight: 600,
                fill: THEME.moneyUnit
            }
        )
    );
    /*
     * 账户状态区域。
     *
     * 使用直角矩形。
     */
    const statusWidth = 76;
    const statusHeight = 24;
    const statusX =
        cardX +
        cardWidth -
        statusWidth -
        14;
    const statusY =
        cardY +
        cardHeight -
        statusHeight -
        12;
    svg.push(
        /*
         * 状态背景。
         */
        svgRect(
            statusX,
            statusY,
            statusWidth,
            statusHeight,
            {
                fill: THEME.onlineBackground,
                stroke: THEME.onlineBorder,
                strokeWidth: 1
            }
        ),
        /*
         * 状态标记。
         */
        svgRect(
            statusX + 8,
            statusY + 8,
            8,
            8,
            {
                fill: THEME.online
            }
        ),
        /*
         * 状态文字。
         */
        svgMiddleText(
            '账户正常',
            statusX + 23,
            statusY + statusHeight / 2,
            {
                fontFamily,
                fontSize: 12,
                fontWeight: 500,
                fill: THEME.onlineText
            }
        )
    );
    /*
     * 页脚分隔线位置。
     */
    const footerLineY =
        canvasHeight - 36;
    svg.push(
        /*
         * 页脚分隔线。
         */
        svgRect(
            outerPadding,
            footerLineY,
            canvasWidth -
            outerPadding * 2,
            1,
            {
                fill: THEME.cardBorder
            }
        ),
        /*
         * 页脚强调线。
         */
        svgRect(
            outerPadding,
            footerLineY,
            72,
            2,
            {
                fill: THEME.topBar
            }
        ),
        /*
         * 左侧页脚文本。
         */
        svgTopText(
            'ChatBot Player Assets',
            outerPadding,
            footerLineY + 9,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 500,
                fill: THEME.footer,
                letterSpacing: 0.5
            }
        ),
        /*
         * 右侧页脚文本。
         */
        svgTopText(
            'WALLET',
            canvasWidth - outerPadding,
            footerLineY + 9,
            {
                fontFamily,
                fontSize: 13,
                fontWeight: 600,
                fill: THEME.footer,
                anchor: 'end',
                letterSpacing: 1.5
            }
        ),
        '</svg>'
    );

    return svg.join('');
}

/* =========================================================
 * PNG 渲染
 * ======================================================= */

/**
 * 使用 Resvg 生成玩家金币 PNG。
 */
export function renderPlayerMoney(
    player: PlayerMoneyData,
    options: RenderPlayerMoneyOptions = {}
): Buffer {
    /*
     * 先生成 SVG。
     */
    const svg = renderPlayerMoneySvg(
        player,
        options
    );

    /*
     * 输出缩放倍率。
     */
    const scale = clamp(
        toFiniteNumber(
            options.scale,
            1
        ),
        0.5,
        4
    );

    /*
     * 自定义字体文件列表。
     */
    const fontFiles: string[] = [];

    if (
        options.fontPath &&
        existsSync(options.fontPath)
    ) {
        fontFiles.push(
            options.fontPath
        );
    }

    /*
     * 默认字体名称。
     */
    const fontFamily =
        sanitizeFontFamily(
            options.fontFamily
        ) ||
        'Noto Sans CJK SC';

    /*
     * 创建 Resvg 渲染器。
     */
    const renderer = new Resvg(svg, {
        fitTo: {
            mode: 'zoom',
            value: scale
        },
        font: {
            fontFiles,

            /*
             * 提供自定义字体文件时，
             * 可以关闭系统字体扫描。
             */
            loadSystemFonts:
                fontFiles.length === 0,

            defaultFontFamily:
            fontFamily
        }
    });

    /*
     * 渲染 PNG。
     */
    const png =
        renderer.render().asPng();

    /*
     * 转换为 Node.js Buffer。
     */
    return Buffer.from(
        png.buffer,
        png.byteOffset,
        png.byteLength
    );
}