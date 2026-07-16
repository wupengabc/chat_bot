import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';
import { permission_map } from '../../../index.js';
import type { help_arg } from '../../../type.js';

export interface CommandHelpItem {
    name?: string;
    keyword?: string;
    description?: string;
    args?: help_arg[];
    platform?: string;
    permission?: string | number;
}

export interface RenderCommandHelpOptions {
    /**
     * 图片宽度，最小 640。
     *
     * 默认值：820
     */
    width?: number;

    /**
     * 主标题。
     *
     * 默认值：COMMAND BOOK
     */
    title?: string;

    /**
     * 副标题。
     *
     * 默认值：ChatBot 命令使用指南
     */
    subtitle?: string;

    /**
     * 命令前缀。
     *
     * 默认值：/
     */
    commandPrefix?: string;

    /**
     * 自定义字体文件路径。
     */
    fontPath?: string;

    /**
     * 字体名称。
     *
     * 注意：Resvg 不支持给字体文件动态设置别名，
     * 这里需要填写字体文件内部实际声明的 family name。
     *
     * 默认值：Noto Sans CJK SC
     */
    fontFamily?: string;

    /**
     * PNG 输出缩放倍率。
     *
     * 默认值：1
     */
    scale?: number;
}

interface PreparedCommand {
    commandLines: string[];
    descriptionLines: string[];
    argsLines: string[];
    platformText: string;
    permissionText: string;
    height: number;
}

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
        rx?: number;
    } = {}
): string {
    const attributes = [
        `<rect x="${x}"`,
        ` y="${y}"`,
        ` width="${width}"`,
        ` height="${height}"`
    ];

    if (options.rx !== undefined) {
        attributes.push(` rx="${options.rx}"`);
    }

    attributes.push(` fill="${options.fill ?? 'none'}"`);

    if (options.stroke) {
        attributes.push(` stroke="${options.stroke}"`);
        attributes.push(
            ` stroke-width="${options.strokeWidth ?? 1}"`
        );
    }

    attributes.push('/>');

    return attributes.join('');
}

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
    }
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
    }
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

function svgTextLines(
    lines: string[],
    x: number,
    y: number,
    lineHeight: number,
    options: {
        fontFamily: string;
        fontSize: number;
        fontWeight?: number;
        fill: string;
    }
): string {
    const output: string[] = [];

    for (let index = 0; index < lines.length; index++) {
        output.push(
            svgTopText(
                lines[index],
                x,
                y + index * lineHeight,
                options
            )
        );
    }

    return output.join('');
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
    const ellipsisWidth = estimateTextWidth(
        ellipsis,
        fontSize,
        fontWeight
    );

    let currentWidth = 0;
    let result = '';

    for (const character of Array.from(text)) {
        const characterWidth = estimateCharacterWidth(
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
    fontWeight = 400
): string[] {
    const text = String(value ?? '').trim();

    if (!text) {
        return [];
    }

    const lines: string[] = [];

    for (const paragraph of text.split(/\r?\n/)) {
        if (!paragraph) {
            lines.push('');
            continue;
        }

        let line = '';
        let lineWidth = 0;

        for (const character of Array.from(paragraph)) {
            const characterWidth =
                estimateCharacterWidth(
                    character,
                    fontSize
                ) *
                (fontWeight >= 700 ? 1.04 : 1);

            if (
                line &&
                lineWidth + characterWidth > maxWidth
            ) {
                lines.push(line);
                line = character;
                lineWidth = characterWidth;
            } else {
                line += character;
                lineWidth += characterWidth;
            }
        }

        if (line) {
            lines.push(line);
        }
    }

    return lines;
}

/* =========================================================
 * 数据处理
 * ======================================================= */

function getPermission(
    permission: CommandHelpItem['permission']
): string {
    if (
        permission === undefined ||
        permission === null ||
        permission === ''
    ) {
        return '未设置';
    }

    const key = String(permission);
    const permissionMap =
        permission_map as Record<string, string>;

    return permissionMap[key] ?? key;
}

function getArgs(
    args: CommandHelpItem['args']
): string {
    if (!Array.isArray(args) || args.length === 0) {
        return '无';
    }

    const list = args
        .filter((arg) => arg?.key?.trim())
        .map((arg) => formatHelpArg(arg));

    return list.length > 0 ? list.join('、') : '无';
}

function formatHelpArg(arg: help_arg): string {
    const nestedArgs = arg.args.length > 0
        ? ` ${arg.args.map((child) => formatHelpArg(child)).join(' ')}`
        : '';
    const description = arg.description.trim()
        ? `（${arg.description.trim()}）`
        : '';
    const permission = arg.permission > 0
        ? `（权限等级 ${arg.permission}）`
        : '';

    return `${arg.key.trim()}${description}${permission}${nestedArgs}`;
}

/* =========================================================
 * 装饰图形
 * ======================================================= */

function drawGrass(
    x: number,
    y: number,
    size: number
): string {
    const pixel = Math.max(
        2,
        Math.floor(size / 8)
    );

    return [
        svgRect(x, y, size, size, {
            fill: '#8d5a3b'
        }),

        svgRect(
            x,
            y,
            size,
            Math.floor(size * 0.34),
            {
                fill: '#4f9a3d'
            }
        ),

        svgRect(x, y, size, pixel, {
            fill: '#79c35a'
        }),

        svgRect(
            x + pixel,
            y + pixel,
            pixel * 2,
            pixel,
            {
                fill: '#79c35a'
            }
        ),

        svgRect(
            x + pixel * 5,
            y + pixel,
            pixel * 2,
            pixel,
            {
                fill: '#79c35a'
            }
        ),

        svgRect(
            x + pixel,
            y + pixel * 4,
            pixel * 2,
            pixel,
            {
                fill: '#a56d46'
            }
        ),

        svgRect(
            x + pixel * 5,
            y + pixel * 5,
            pixel * 2,
            pixel,
            {
                fill: '#a56d46'
            }
        ),

        svgRect(
            x + pixel * 3,
            y + pixel * 6,
            pixel * 2,
            pixel,
            {
                fill: '#6f452f'
            }
        )
    ].join('');
}

function drawEmerald(
    x: number,
    y: number,
    size: number
): string {
    const half = size / 2;

    return [
        `<path d="M ${x + half} ${y}`,
        ` L ${x + size} ${y + half}`,
        ` L ${x + half} ${y + size}`,
        ` L ${x} ${y + half} Z"`,
        ' fill="#1fad66"/>',

        `<path d="M ${x + half} ${y}`,
        ` L ${x + half} ${y + half}`,
        ` L ${x + size * 0.28} ${y + half} Z"`,
        ' fill="#78e3a8"/>',

        `<path d="M ${x + half} ${y + half}`,
        ` L ${x + size} ${y + half}`,
        ` L ${x + half} ${y + size} Z"`,
        ' fill="#0d7d4b"/>'
    ].join('');
}

function drawTag(
    text: string,
    x: number,
    y: number,
    options: {
        maxWidth: number;
        background: string;
        foreground: string;
        border: string;
        fontFamily: string;
        fontSize: number;
        height: number;
    }
): {
    svg: string;
    width: number;
} {
    const horizontalPadding = 10;

    const safeText = ellipsisText(
        text,
        Math.max(
            1,
            options.maxWidth - horizontalPadding * 2
        ),
        options.fontSize,
        600
    );

    const width = Math.min(
        options.maxWidth,
        Math.ceil(
            estimateTextWidth(
                safeText,
                options.fontSize,
                600
            ) +
            horizontalPadding * 2
        )
    );

    return {
        width,
        svg: [
            svgRect(
                x,
                y,
                width,
                options.height,
                {
                    fill: options.background,
                    stroke: options.border
                }
            ),

            svgMiddleText(
                safeText,
                x + horizontalPadding,
                y + options.height / 2,
                {
                    fontFamily: options.fontFamily,
                    fontSize: options.fontSize,
                    fontWeight: 600,
                    fill: options.foreground
                }
            )
        ].join('')
    };
}

/* =========================================================
 * SVG 渲染
 * ======================================================= */

/**
 * 生成 ChatBot 命令帮助 SVG。
 */
export function renderCommandHelpSvg(
    commands: CommandHelpItem[],
    page: number,
    totalPage: number,
    options: RenderCommandHelpOptions = {}
): string {
    if (!Array.isArray(commands)) {
        throw new TypeError('commands 必须是数组');
    }

    const canvasWidth = Math.max(
        640,
        Math.min(
            2400,
            Math.floor(Number(options.width) || 820)
        )
    );

    const total = Math.max(
        1,
        Number.isFinite(Number(totalPage))
            ? Math.floor(Number(totalPage))
            : 1
    );

    const current = Math.min(
        total,
        Math.max(
            1,
            Number.isFinite(Number(page))
                ? Math.floor(Number(page))
                : 1
        )
    );

    const title =
        String(options.title ?? 'COMMAND BOOK');

    const subtitle =
        String(
            options.subtitle ??
            'ChatBot 命令使用指南'
        );

    const commandPrefix =
        String(options.commandPrefix ?? '/');

    const fontFamily =
        sanitizeFontFamily(options.fontFamily) ||
        'Noto Sans CJK SC';

    /*
     * 布局。
     */
    const pad = 28;
    const headerHeight = 104;
    const footerHeight = 48;
    const cardGap = 10;

    const cardPaddingX = 18;
    const cardPaddingY = 14;
    const cardWidth = canvasWidth - pad * 2;
    const contentWidth =
        cardWidth - cardPaddingX * 2;

    /*
     * 字体和行高。
     */
    const commandSize = 24;
    const commandLineHeight = 30;

    const descriptionSize = 17;
    const descriptionLineHeight = 24;

    const infoSize = 15;
    const infoLineHeight = 21;

    const titleSize = 34;
    const subtitleSize = 15;
    const footerSize = 14;

    const tagHeight = 26;

    /*
     * 为右上角序号保留空间。
     */
    const commandMaxWidth = contentWidth - 52;

    const prepared: PreparedCommand[] =
        commands.map((item, index) => {
            const rawCommand = String(
                item.keyword ??
                item.name ??
                `command_${index + 1}`
            ).trim();

            const command =
                rawCommand.startsWith(commandPrefix)
                    ? rawCommand
                    : `${commandPrefix}${rawCommand}`;

            const commandLines = wrapText(
                command,
                commandMaxWidth,
                commandSize,
                700
            );

            const descriptionLines = wrapText(
                item.description || '暂无命令描述',
                contentWidth,
                descriptionSize,
                400
            );

            const argsLines = wrapText(
                `参数：${getArgs(item.args)}`,
                contentWidth - 18,
                infoSize,
                400
            );

            const safeCommandLines =
                commandLines.length > 0
                    ? commandLines
                    : [commandPrefix];

            const safeDescriptionLines =
                descriptionLines.length > 0
                    ? descriptionLines
                    : ['暂无命令描述'];

            const safeArgsLines =
                argsLines.length > 0
                    ? argsLines
                    : ['参数：无'];

            const platformText =
                `平台 ${item.platform || '通用'}`;

            const permissionText =
                `权限 ${getPermission(item.permission)}`;

            const argsHeight = Math.max(
                30,
                safeArgsLines.length *
                infoLineHeight +
                12
            );

            const height =
                cardPaddingY * 2 +
                safeCommandLines.length *
                commandLineHeight +
                4 +
                safeDescriptionLines.length *
                descriptionLineHeight +
                8 +
                argsHeight +
                8 +
                tagHeight;

            return {
                commandLines: safeCommandLines,
                descriptionLines: safeDescriptionLines,
                argsLines: safeArgsLines,
                platformText,
                permissionText,
                height
            };
        });

    const cardsHeight = prepared.reduce(
        (totalHeight, item) =>
            totalHeight + item.height,
        0
    );

    const gapsHeight =
        Math.max(0, prepared.length - 1) *
        cardGap;

    const emptyHeight =
        prepared.length === 0 ? 90 : 0;

    const canvasHeight =
        pad +
        headerHeight +
        cardsHeight +
        gapsHeight +
        emptyHeight +
        footerHeight +
        pad;

    const svg: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` width="${canvasWidth}"`,
        ` height="${canvasHeight}"`,
        ` viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
        svgRect(
            0,
            0,
            canvasWidth,
            canvasHeight,
            {
                fill: '#eef4ea'
            }
        ),
        svgRect(
            pad / 2 + 0.5,
            pad / 2 + 0.5,
            canvasWidth - pad + 1,
            canvasHeight - pad + 1,
            {
                fill: 'none',
                stroke: '#b7c9b0',
                strokeWidth: 2
            }
        ),
        svgRect(
            pad / 2,
            pad / 2,
            canvasWidth - pad,
            8,
            {
                fill: '#4f8d45'
            }
        ),
        svgRect(
            pad / 2,
            pad / 2,
            canvasWidth - pad,
            3,
            {
                fill: '#86c36f'
            }
        ),
        drawGrass(
            pad + 4,
            pad + 18,
            30
        ),
        drawEmerald(
            canvasWidth - pad - 34,
            pad + 20,
            26
        ),
        svgTopText(
            title,
            canvasWidth / 2,
            pad + 14,
            {
                fontFamily,
                fontSize: titleSize,
                fontWeight: 700,
                fill: '#2a3d2d',
                anchor: 'middle'
            }
        )
    ];
    const titleWidth = Math.min(
        300,
        Math.ceil(
            estimateTextWidth(
                title,
                titleSize,
                700
            )
        )
    );
    svg.push(
        svgRect(
            canvasWidth / 2 - titleWidth / 2,
            pad + 54,
            titleWidth,
            3,
            {
                fill: '#4f8d45'
            }
        ),
        svgRect(
            canvasWidth / 2 - 22,
            pad + 52,
            44,
            7,
            {
                fill: '#7fba6d'
            }
        ),
        svgTopText(
            subtitle,
            canvasWidth / 2,
            pad + 68,
            {
                fontFamily,
                fontSize: subtitleSize,
                fontWeight: 400,
                fill: '#667266',
                anchor: 'middle'
            }
        )
    );
    let currentY = pad + headerHeight;
    /*
     * 空页面。
     */
    if (prepared.length === 0) {
        svg.push(
            svgRect(
                pad,
                currentY,
                cardWidth,
                74,
                {
                    fill: '#ffffff',
                    stroke: '#c5d3bf'
                }
            ),
            svgTopText(
                '本页暂无可用命令',
                pad + 16,
                currentY + 16,
                {
                    fontFamily,
                    fontSize: 18,
                    fontWeight: 600,
                    fill: '#3d4b3f'
                }
            ),
            svgTopText(
                '请切换到其他页面查看',
                pad + 16,
                currentY + 44,
                {
                    fontFamily,
                    fontSize: 15,
                    fontWeight: 400,
                    fill: '#758075'
                }
            )
        );
        currentY += emptyHeight;
    }
    /*
     * 命令卡片。
     */
    for (
        let index = 0;
        index < prepared.length;
        index++
    ) {
        const item = prepared[index];
        const cardX = pad;
        const cardY = currentY;
        const textX = cardX + cardPaddingX;
        svg.push(
            svgRect(
                cardX,
                cardY,
                cardWidth,
                item.height,
                {
                    fill: '#ffffff',
                    stroke: '#c7d4c1'
                }
            ),
            svgRect(
                cardX,
                cardY,
                cardWidth,
                3,
                {
                    fill:
                        index % 2 === 0
                            ? '#5a9b4f'
                            : '#6aa8c8'
                }
            )
        );
        /*
         * 右上角序号。
         */
        const sequence = String(index + 1).padStart(
            2,
            '0'
        );
        const sequenceWidth =
            Math.ceil(
                estimateTextWidth(
                    sequence,
                    13,
                    700
                )
            ) + 14;
        const sequenceX =
            cardX +
            cardWidth -
            cardPaddingX -
            sequenceWidth;
        svg.push(
            svgRect(
                sequenceX,
                cardY + 10,
                sequenceWidth,
                22,
                {
                    fill: '#edf5ea',
                    stroke: '#9db994'
                }
            ),
            svgMiddleText(
                sequence,
                sequenceX + sequenceWidth / 2,
                cardY + 21,
                {
                    fontFamily,
                    fontSize: 13,
                    fontWeight: 700,
                    fill: '#4d7146',
                    anchor: 'middle'
                }
            )
        );
        let textY = cardY + cardPaddingY;
        /*
         * 命令名。
         */
        svg.push(
            svgTextLines(
                item.commandLines,
                textX,
                textY,
                commandLineHeight,
                {
                    fontFamily,
                    fontSize: commandSize,
                    fontWeight: 700,
                    fill: '#1f6f95'
                }
            )
        );
        textY +=
            item.commandLines.length *
            commandLineHeight;
        textY += 4;
        /*
         * 命令描述。
         */
        svg.push(
            svgTextLines(
                item.descriptionLines,
                textX,
                textY,
                descriptionLineHeight,
                {
                    fontFamily,
                    fontSize: descriptionSize,
                    fontWeight: 400,
                    fill: '#414a42'
                }
            )
        );
        textY +=
            item.descriptionLines.length *
            descriptionLineHeight;
        textY += 8;
        /*
         * 参数区域。
         */
        const argsHeight = Math.max(
            30,
            item.argsLines.length *
            infoLineHeight +
            12
        );
        svg.push(
            svgRect(
                textX,
                textY,
                contentWidth,
                argsHeight,
                {
                    fill: '#f3eff7'
                }
            ),
            svgTextLines(
                item.argsLines,
                textX + 10,
                textY + 6,
                infoLineHeight,
                {
                    fontFamily,
                    fontSize: infoSize,
                    fontWeight: 400,
                    fill: '#65506f'
                }
            )
        );
        textY += argsHeight + 8;
        /*
         * 平台与权限标签。
         */
        const tagGap = 8;
        const availableTagWidth =
            contentWidth - tagGap;
        const platformNaturalWidth = Math.ceil(
            estimateTextWidth(
                item.platformText,
                infoSize,
                600
            ) + 20
        );
        const permissionNaturalWidth = Math.ceil(
            estimateTextWidth(
                item.permissionText,
                infoSize,
                600
            ) + 20
        );
        const naturalTotal =
            platformNaturalWidth +
            permissionNaturalWidth;
        let platformMaxWidth: number;
        let permissionMaxWidth: number;
        if (naturalTotal <= availableTagWidth) {
            platformMaxWidth =
                platformNaturalWidth;
            permissionMaxWidth =
                permissionNaturalWidth;
        } else {
            const platformRatio =
                platformNaturalWidth /
                naturalTotal;
            platformMaxWidth = Math.max(
                80,
                Math.floor(
                    availableTagWidth *
                    platformRatio
                )
            );
            permissionMaxWidth = Math.max(
                80,
                availableTagWidth -
                platformMaxWidth
            );
        }
        const platformTag = drawTag(
            item.platformText,
            textX,
            textY,
            {
                maxWidth: platformMaxWidth,
                background: '#eef6ec',
                foreground: '#3f6d39',
                border: '#b5ceb0',
                fontFamily,
                fontSize: infoSize,
                height: tagHeight
            }
        );
        const permissionTag = drawTag(
            item.permissionText,
            textX +
            platformTag.width +
            tagGap,
            textY,
            {
                maxWidth: permissionMaxWidth,
                background: '#eef4f8',
                foreground: '#3d6280',
                border: '#b4c7d4',
                fontFamily,
                fontSize: infoSize,
                height: tagHeight
            }
        );
        svg.push(
            platformTag.svg,
            permissionTag.svg
        );
        currentY += item.height;
        if (index < prepared.length - 1) {
            currentY += cardGap;
        }
    }
    /*
     * 页脚。
     */
    const footerLineY =
        canvasHeight - pad - 28;
    const footerY =
        footerLineY + 10;
    svg.push(
        svgRect(
            pad,
            footerLineY,
            cardWidth,
            2,
            {
                fill: '#4f8d45'
            }
        ),
        svgRect(
            canvasWidth / 2 - 4,
            footerLineY - 3,
            8,
            8,
            {
                fill: '#4f8d45'
            }
        ),
        svgRect(
            canvasWidth / 2 - 2,
            footerLineY,
            4,
            2,
            {
                fill: '#eef4ea'
            }
        ),
        svgTopText(
            'ChatBot Command Book',
            pad,
            footerY,
            {
                fontFamily,
                fontSize: footerSize,
                fontWeight: 600,
                fill: '#4a574d'
            }
        ),
        svgTopText(
            `${current} / ${total}`,
            canvasWidth - pad,
            footerY,
            {
                fontFamily,
                fontSize: footerSize,
                fontWeight: 600,
                fill: '#4a574d',
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

/**
 * 使用 Resvg 生成 ChatBot 命令帮助 PNG。
 */
export function renderCommandHelp(
    commands: CommandHelpItem[],
    page: number,
    totalPage: number,
    options: RenderCommandHelpOptions = {}
): Buffer {
    const svg = renderCommandHelpSvg(
        commands,
        page,
        totalPage,
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

    const fontFamily =
        sanitizeFontFamily(options.fontFamily) ||
        'Noto Sans CJK SC';

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