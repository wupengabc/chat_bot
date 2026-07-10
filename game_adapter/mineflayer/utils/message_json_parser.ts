/**
 * Minecraft JSON 文本组件接口
 * 新版 prismarine-chat 返回的 ChatMessage 对象结构：
 * - json: 原始协议 JSON 数据
 * - text: 解析后的文本
 * - extra: 子组件数组（每个也是 ChatMessage）
 * - color: 颜色字符串
 * - bold/italic/underlined/strikethrough/obfuscated: number (0/1) 或 undefined
 * - warn: function（内部方法，忽略）
 * - hoverEvent/clickEvent: 事件对象（在 json 子对象中）
 */
interface MinecraftTextComponent {
    text?: string;
    translate?: string;
    with?: MinecraftTextComponent[];
    color?: string;
    bold?: boolean | number;
    italic?: boolean | number;
    underlined?: boolean | number;
    strikethrough?: boolean | number;
    obfuscated?: boolean | number;
    extra?: MinecraftTextComponent[];
    hoverEvent?: HoverEvent;
    hover_event?: HoverEvent;
    clickEvent?: ClickEvent;
    click_event?: ClickEvent;
    insertion?: string;
    json?: MinecraftTextComponent;
    warn?: Function;
}

/**
 * 悬停事件接口
 */
interface HoverEvent {
    action: 'show_text' | 'show_item' | 'show_entity';
    contents?: MinecraftTextComponent | string;
    value?: MinecraftTextComponent | string;
}

/**
 * 点击事件接口
 */
interface ClickEvent {
    action: 'open_url' | 'run_command' | 'suggest_command' | 'change_page' | 'copy_to_clipboard';
    value: string;
}

/**
 * 解析结果接口
 */
interface ParsedMessage {
    username: string;
    message: string;
    html: string;
    normalized: MinecraftTextComponent | null | undefined;
    plainText: string;
}

/**
 * Minecraft 颜色映射类型
 */
type MinecraftColor =
    | 'black' | 'dark_blue' | 'dark_green' | 'dark_aqua'
    | 'dark_red' | 'dark_purple' | 'gold' | 'gray'
    | 'dark_gray' | 'blue' | 'green' | 'aqua'
    | 'red' | 'light_purple' | 'yellow' | 'white';

// @ts-ignore
import zhCn from '../data/language/zh_cn/zh_cn.json';

/**
 * 判断格式属性是否为"启用"状态
 * 新版用 number (1=true, 0=false)，旧版用 boolean
 */
function isTruthy(val: boolean | number | undefined): boolean {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    return false;
}

/**
 * Minecraft JSON 文本格式解析器（TypeScript 版）
 * 兼容新版 prismarine-chat（格式属性为 number 0/1）和旧版（boolean）
 */
export class MinecraftJsonParser {
    /**
     * 解析 Minecraft JSON 消息
     */
    static parse(jsonData: MinecraftTextComponent): ParsedMessage {
        const normalized = this.normalizeJson(jsonData);
        const plainText = this.extractPlainText(normalized);
        const parsed = this.parseUsernameAndMessage(plainText);
        const html = this.toHTML(normalized);

        return {
            username: parsed.username,
            message: parsed.message,
            plainText,
            html: html,
            normalized
        };
    }

    /**
     * 规范化 JSON，去除异常的嵌套结构
     * 处理新版 prismarine-chat 的 ChatMessage 对象（含 json/warn 等额外属性）
     */
    static normalizeJson(node: MinecraftTextComponent | null | undefined): MinecraftTextComponent | null {
        if (!node) return null;

        // 如果只有一个 json 属性（加上 warn 等非数据属性），直接展开
        if (node.json && !node.text && !node.extra && !node.translate && !node.color
            && !isTruthy(node.bold) && !isTruthy(node.italic) && !isTruthy(node.underlined)
            && !isTruthy(node.strikethrough) && !isTruthy(node.obfuscated)) {
            return this.normalizeJson(node.json);
        }

        // 如果有 translate 属性
        if (node.translate) {
            const result: MinecraftTextComponent = { translate: node.translate };
            if (node.with) result.with = node.with;
            if (node.color) result.color = node.color;
            if (isTruthy(node.bold)) result.bold = true;
            if (isTruthy(node.italic)) result.italic = true;
            if (isTruthy(node.underlined)) result.underlined = true;
            if (isTruthy(node.strikethrough)) result.strikethrough = true;
            if (isTruthy(node.obfuscated)) result.obfuscated = true;

            const hoverEvent = this.extractHoverEvent(node);
            if (hoverEvent) result.hoverEvent = hoverEvent;

            const clickEvent = this.extractClickEvent(node);
            if (clickEvent) result.clickEvent = clickEvent;

            if (node.insertion) result.insertion = node.insertion;
            if (node.extra) result.extra = node.extra;

            return result;
        }

        // 如果有 extra 但没有 text，并且 extra 只有一个元素，且没有其他样式属性
        if (!node.text && !node.translate && node.extra && node.extra.length === 1
            && !node.color && !isTruthy(node.bold) && !isTruthy(node.italic)
            && !isTruthy(node.underlined) && !isTruthy(node.strikethrough)
            && !isTruthy(node.obfuscated)
            && !this.extractHoverEvent(node) && !this.extractClickEvent(node)) {
            return this.normalizeJson(node.extra[0]);
        }

        const result: MinecraftTextComponent = {};

        // 保留 text
        if (node.text !== undefined) {
            result.text = typeof node.text === 'string' ? node.text : String(node.text ?? '');
        }

        // 保留颜色和格式（统一转为 boolean）
        if (node.color) result.color = node.color;
        if (isTruthy(node.bold)) result.bold = true;
        if (isTruthy(node.italic)) result.italic = true;
        if (isTruthy(node.underlined)) result.underlined = true;
        if (isTruthy(node.strikethrough)) result.strikethrough = true;
        if (isTruthy(node.obfuscated)) result.obfuscated = true;

        // 保留 hoverEvent（从 node 本身或 node.json 中提取）
        const hoverEvent = this.extractHoverEvent(node);
        if (hoverEvent) result.hoverEvent = hoverEvent;

        // 保留 clickEvent
        const clickEvent = this.extractClickEvent(node);
        if (clickEvent) result.clickEvent = clickEvent;

        // 保留 insertion
        const insertion = node.insertion || (node.json as any)?.insertion;
        if (insertion) result.insertion = insertion;

        // 处理 extra 数组
        if (node.extra && Array.isArray(node.extra)) {
            const normalizedExtra: MinecraftTextComponent[] = [];

            for (const child of node.extra) {
                if (!child) continue;
                const normalized = this.normalizeJson(child);
                if (normalized && (normalized.text !== undefined || normalized.translate || normalized.extra)) {
                    normalizedExtra.push(normalized);
                }
            }

            if (normalizedExtra.length > 0) {
                result.extra = normalizedExtra;
            }
        }

        return Object.keys(result).length > 0 ? result : null;
    }

    /**
     * 从节点中提取 hoverEvent（兼容多种位置）
     */
    static extractHoverEvent(node: MinecraftTextComponent): HoverEvent | undefined {
        return node.hoverEvent || node.hover_event
            || (node.json as any)?.hoverEvent || (node.json as any)?.hover_event
            || undefined;
    }

    /**
     * 从节点中提取 clickEvent（兼容多种位置）
     */
    static extractClickEvent(node: MinecraftTextComponent): ClickEvent | undefined {
        return node.clickEvent || node.click_event
            || (node.json as any)?.clickEvent || (node.json as any)?.click_event
            || undefined;
    }

    /**
     * 展开翻译键为实际文本结构
     */
    static expandTranslate(node: MinecraftTextComponent): MinecraftTextComponent | null {
        if (!node.translate) return null;

        const template = (zhCn as Record<string, string>)[node.translate] || node.translate;
        const withParams = node.with || [];

        const extra: MinecraftTextComponent[] = [];
        const inheritStyle: any = {};
        if (node.color) inheritStyle.color = node.color;
        if (isTruthy(node.bold)) inheritStyle.bold = true;
        if (isTruthy(node.italic)) inheritStyle.italic = true;
        if (isTruthy(node.underlined)) inheritStyle.underlined = true;
        if (isTruthy(node.strikethrough)) inheritStyle.strikethrough = true;
        if (isTruthy(node.obfuscated)) inheritStyle.obfuscated = true;

        const placeholderRegex = /%(\d+\$)?s/g;
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        let seqIndex = 0;

        while ((match = placeholderRegex.exec(template)) !== null) {
            if (match.index > lastIndex) {
                extra.push({ text: template.substring(lastIndex, match.index), ...inheritStyle });
            }

            let paramIndex: number;
            if (match[1]) {
                paramIndex = parseInt(match[1]) - 1;
            } else {
                paramIndex = seqIndex++;
            }

            if (paramIndex < withParams.length) {
                const param = withParams[paramIndex];
                if (param && typeof param === 'object') {
                    const normalized = this.normalizeJson(param);
                    if (normalized) {
                        if (!normalized.color && inheritStyle.color) normalized.color = inheritStyle.color;
                        extra.push(normalized);
                    }
                } else if (typeof param === 'string') {
                    extra.push({ text: param, ...inheritStyle });
                }
            }

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < template.length) {
            extra.push({ text: template.substring(lastIndex), ...inheritStyle });
        }

        if (extra.length === 0) {
            return { text: template, ...inheritStyle };
        }

        return { text: '', extra: extra, ...inheritStyle };
    }

    /**
     * 递归提取所有纯文本内容
     */
    static extractPlainText(node: MinecraftTextComponent | null | undefined, includeHover: boolean = false): string {
        if (!node) return '';

        let result = '';

        if (node.translate) {
            const expanded = this.expandTranslate(node);
            if (expanded) {
                return this.extractPlainText(expanded, includeHover);
            }
        }

        if (node.text !== undefined) {
            if (typeof node.text === 'string') {
                result += node.text;
            } else {
                result += String(node.text);
            }
        }

        if (node.extra && Array.isArray(node.extra)) {
            for (const child of node.extra) {
                result += this.extractPlainText(child, includeHover);
            }
        }

        return result;
    }

    /**
     * 从纯文本中解析用户名和消息
     */
    static parseUsernameAndMessage(plainText: string): { username: string; message: string } {
        const text = plainText.trim();

        const lastArrowIndex = text.lastIndexOf('»');

        if (lastArrowIndex === -1) {
            return { username: '', message: text };
        }

        const message = text.substring(lastArrowIndex + 1).trim();
        const beforeArrow = text.substring(0, lastArrowIndex).trim();

        const usernameMatch = beforeArrow.match(/\[.*?\]\s*(\S+)\s*$/);
        if (usernameMatch) {
            return { username: usernameMatch[1], message };
        }

        const parts = beforeArrow.split(/\s+/);
        const username = parts[parts.length - 1] || '';

        return { username, message };
    }

    /**
     * 将 Minecraft JSON 转换为带颜色的 HTML
     */
    static toHTML(
        node: MinecraftTextComponent | null | undefined,
        depth: number = 0,
        inheritedEvents?: { hoverEvent?: HoverEvent, clickEvent?: ClickEvent, insertion?: string }
    ): string {
        if (!node) return '';
        if (depth > 20) return '';

        let html = '';

        if (node.translate) {
            const expanded = this.expandTranslate(node);
            if (expanded) {
                return this.toHTML(expanded, depth, inheritedEvents);
            }
        }

        const hoverEvent = node.hoverEvent || inheritedEvents?.hoverEvent;
        const clickEvent = node.clickEvent || inheritedEvents?.clickEvent;
        const insertion = node.insertion || inheritedEvents?.insertion;

        const eventsToPass: { hoverEvent?: HoverEvent, clickEvent?: ClickEvent, insertion?: string } = {};
        if (hoverEvent) eventsToPass.hoverEvent = hoverEvent;
        if (clickEvent) eventsToPass.clickEvent = clickEvent;
        if (insertion) eventsToPass.insertion = insertion;

        if (node.text !== undefined) {
            // 空 text + 有事件 + 有 extra → 事件传递给子节点
            if (node.text === '' && (hoverEvent || clickEvent) && node.extra && node.extra.length > 0) {
                for (const child of node.extra) {
                    html += this.toHTML(child, depth + 1, eventsToPass);
                }
                return html;
            }

            // 空 text 且无 extra → 跳过
            if (node.text === '' && (!node.extra || node.extra.length === 0)) {
                return '';
            }

            const color = this.normalizeColor(node.color || 'white');
            const text = this.escapeHtml(node.text);

            let style = `color: ${color};`;
            if (isTruthy(node.bold)) style += ' font-weight: bold;';
            if (isTruthy(node.italic)) style += ' font-style: italic;';
            if (isTruthy(node.underlined)) style += ' text-decoration: underline;';
            if (isTruthy(node.strikethrough)) style += ' text-decoration: line-through;';

            let attributes = '';

            if (hoverEvent) {
                const hoverContent = hoverEvent.contents || hoverEvent.value;
                if (hoverContent) {
                    let hoverHtml = '';
                    if (typeof hoverContent === 'string') {
                        hoverHtml = `<span style="color: #FFFFFF;">${this.escapeHtml(hoverContent)}</span>`;
                    } else {
                        hoverHtml = this.toHTML(this.normalizeJson(hoverContent), depth + 1);
                    }
                    if (hoverHtml) {
                        attributes += ` hover-data="${this.escapeAttr(hoverHtml)}"`;
                    }
                }
            }

            if (clickEvent) {
                attributes += ` click-action="${clickEvent.action}" click-value="${this.escapeAttr(clickEvent.value)}"`;
            }

            if (insertion) {
                attributes += ` insertion-data="${this.escapeAttr(insertion)}"`;
            }

            html += `<span style="${style}"${attributes}>${text}</span>`;
        } else if (!node.extra) {
            return '';
        }

        if (node.extra && Array.isArray(node.extra)) {
            for (const child of node.extra) {
                html += this.toHTML(child, depth + 1, eventsToPass);
            }
        }

        return html;
    }

    /**
     * 规范化颜色值
     */
    static normalizeColor(color: string | undefined): string {
        const colorMap: Record<MinecraftColor, string> = {
            'black': '#000000',
            'dark_blue': '#0000AA',
            'dark_green': '#00AA00',
            'dark_aqua': '#00AAAA',
            'dark_red': '#AA0000',
            'dark_purple': '#AA00AA',
            'gold': '#FFAA00',
            'gray': '#AAAAAA',
            'dark_gray': '#555555',
            'blue': '#5555FF',
            'green': '#55FF55',
            'aqua': '#55FFFF',
            'red': '#FF5555',
            'light_purple': '#FF55FF',
            'yellow': '#FFFF55',
            'white': '#FFFFFF'
        };

        if (color && color.startsWith('#')) {
            return color;
        }

        return colorMap[color as MinecraftColor] || color || '#FFFFFF';
    }

    /**
     * HTML 转义
     */
    static escapeHtml(text: string | undefined): string {
        if (typeof text !== 'string') return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * HTML 属性值转义
     */
    static escapeAttr(text: string | undefined): string {
        if (typeof text !== 'string') return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * 调试方法
     */
    static debug(jsonData: MinecraftTextComponent): MinecraftTextComponent | null {
        const normalized = this.normalizeJson(jsonData);
        console.log('原始数据:', jsonData);
        console.log('规范化后:', JSON.stringify(normalized, null, 2));
        return normalized;
    }
}
