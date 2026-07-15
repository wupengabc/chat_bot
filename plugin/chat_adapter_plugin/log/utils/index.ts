import {Resvg} from "@resvg/resvg-js"
import type {LogEntry, LogFilter} from "../../../../utils/log_utils.js"

const WIDTH = 1120
const OUTER_X = 30
const CONTENT_X = 66
const CONTENT_WIDTH = 988
const HEADER_HEIGHT = 210
const ROW_BASE_HEIGHT = 88
const LOG_LINE_HEIGHT = 24
const FOOTER_HEIGHT = 88
const MAX_MESSAGE_LINES = 3
const COLORS = {
    canvas: "#EEE9DD",
    panel: "#FFFFFF",
    border: "#D9D2C3",
    text: "#24251F",
    muted: "#858277",
    info: "#16865C",
    warn: "#D99025",
    error: "#C5483B",
    accent: "#277B78",
}

const MESSAGE_X = 574
const MESSAGE_WIDTH = CONTENT_X + CONTENT_WIDTH - MESSAGE_X - 20

export interface RenderLogReportOptions {
    page: number
    totalPages: number
    totalCount: number
    filter: Readonly<LogFilter>
}

function escapeXml(value: unknown): string {
    const validXml = Array.from(String(value ?? ""), character => {
        const codePoint = character.codePointAt(0)!
        const valid = codePoint === 0x09
            || codePoint === 0x0a
            || codePoint === 0x0d
            || (codePoint >= 0x20 && codePoint <= 0xd7ff)
            || (codePoint >= 0xe000 && codePoint <= 0xfffd)
            || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
        return valid ? character : "�"
    }).join("")

    return validXml
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

function isWideCodePoint(codePoint: number): boolean {
    return codePoint >= 0x1100 && (
        codePoint <= 0x115f
        || codePoint === 0x2329
        || codePoint === 0x232a
        || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
        || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
        || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
        || (codePoint >= 0xff00 && codePoint <= 0xff60)
        || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
        || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
        || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
}

function measureText(value: string, fontSize = 14): number {
    let width = 0
    for (const character of Array.from(value)) {
        const codePoint = character.codePointAt(0)!
        if (character === "\t") width += fontSize * 2
        else if (/\s/u.test(character)) width += fontSize * 0.35
        else if (isWideCodePoint(codePoint)) width += fontSize
        else if (/[MW]/u.test(character)) width += fontSize
        else width += fontSize * 0.72
    }
    return width
}

function wrapText(value: string, maxWidth: number, maxLines: number): {lines: string[]; clamped: boolean} {
    const lines: string[] = []
    let currentLine = ""

    for (const character of Array.from(value.replace(/\r\n?/g, "\n"))) {
        if (character === "\n") {
            lines.push(currentLine)
            currentLine = ""
            continue
        }

        if (currentLine && measureText(currentLine + character) > maxWidth) {
            lines.push(currentLine)
            currentLine = character
        } else {
            currentLine += character
        }
    }
    lines.push(currentLine)

    if (lines.length <= maxLines) return {lines, clamped: false}

    const clamped = lines.slice(0, maxLines)
    const lastCharacters = Array.from(clamped[maxLines - 1].trimEnd())
    while (lastCharacters.length > 0 && measureText(lastCharacters.join("") + "…") > maxWidth) {
        lastCharacters.pop()
    }
    clamped[maxLines - 1] = `${lastCharacters.join("")}…`
    return {lines: clamped, clamped: true}
}

function severityStyle(type: unknown): {color: string; background: string} {
    switch (String(type).toLowerCase()) {
        case "info": return {color: COLORS.info, background: "#EAF5EF"}
        case "warn": return {color: COLORS.warn, background: "#FFF3D9"}
        case "error": return {color: COLORS.error, background: "#FCEAE7"}
        default: return {color: COLORS.accent, background: "#E8F2F1"}
    }
}

function renderFilterTags(filter: Readonly<LogFilter>): string {
    const tags = [
        {key: "TYPE", value: filter.type, width: 142},
        {key: "PLATFORM", value: filter.platform, width: 180},
        {key: "PLUGIN", value: filter.plugin, width: 180},
    ]
    let x = 145

    return tags.map((tag, index) => {
        const active = tag.value !== undefined && tag.value !== ""
        const typeStyle = tag.key === "TYPE" && active ? severityStyle(tag.value) : undefined
        const background = typeStyle?.background ?? "#F7F4EC"
        const border = typeStyle ? `${typeStyle.color}55` : "#DED8CB"
        const color = typeStyle?.color ?? "#55574F"
        const label = `${tag.key} · ${String(active ? tag.value : "ALL").toUpperCase()}`
        const tagX = x
        x += tag.width + 12
        return `<clipPath id="filter-clip-${index}"><rect x="${tagX + 8}" y="151" width="${tag.width - 16}" height="34"/></clipPath>
<rect x="${tagX}" y="151" width="${tag.width}" height="34" rx="3" fill="${background}" stroke="${border}"/>
<text x="${tagX + tag.width / 2}" y="173" text-anchor="middle" clip-path="url(#filter-clip-${index})" font-size="12" font-weight="700" fill="${color}">${escapeXml(label)}</text>`
    }).join("\n")
}

export function renderLogReportSvg(
    entries: readonly LogEntry[],
    options: RenderLogReportOptions,
): string {
    const rows = entries.map((entry, index) => {
        const wrappedMessage = wrapText(String(entry.msg), MESSAGE_WIDTH, MAX_MESSAGE_LINES)
        return {
            entry,
            index,
            messageLines: wrappedMessage.lines,
            messageClamped: wrappedMessage.clamped,
            height: ROW_BASE_HEIGHT + (wrappedMessage.lines.length - 1) * LOG_LINE_HEIGHT,
        }
    })
    const rowsHeight = rows.reduce((total, row) => total + row.height, 0)
    const height = HEADER_HEIGHT + rowsHeight + FOOTER_HEIGHT
    const bodyEnd = HEADER_HEIGHT + rowsHeight
    const hasFilter = Boolean(options.filter.type || options.filter.platform || options.filter.plugin)
    const headerColor = options.filter.type ? severityStyle(options.filter.type).color : COLORS.accent

    let rowY = HEADER_HEIGHT
    const rowMarkup = rows.map(row => {
        const {entry, index, messageLines, messageClamped} = row
        const y = rowY
        rowY += row.height
        const severity = severityStyle(entry.type)
        const background = index % 2 === 0 ? COLORS.panel : "#F8F6F0"
        const source = `${String(entry.platform)} / ${String(entry.plugin)}`
        const message = messageLines.map((line, lineIndex) =>
            `<tspan data-log-entry-id="${escapeXml(entry.id)}" data-log-line="true" data-log-line-index="${lineIndex + 1}" data-log-clamped="${messageClamped && lineIndex === messageLines.length - 1}" x="${MESSAGE_X}" y="${y + 36 + lineIndex * LOG_LINE_HEIGHT}">${escapeXml(line)}</tspan>`
        ).join("")
        const recordY = y + 61 + (messageLines.length - 1) * LOG_LINE_HEIGHT

        return `<clipPath id="time-clip-${index}"><rect x="86" y="${y + 12}" width="132" height="42"/></clipPath>
<clipPath id="source-clip-${index}"><rect x="349" y="${y + 12}" width="205" height="42"/></clipPath>
<clipPath id="message-clip-${index}"><rect x="${MESSAGE_X}" y="${y}" width="${MESSAGE_WIDTH}" height="${row.height}"/></clipPath>
<rect x="${CONTENT_X}" y="${y}" width="${CONTENT_WIDTH}" height="${row.height}" fill="${background}"/>
<rect x="${CONTENT_X}" y="${y}" width="5" height="${row.height}" fill="${severity.color}"/>
<text x="86" y="${y + 34}" clip-path="url(#time-clip-${index})" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#363832">${escapeXml(entry.time)}</text>
<rect x="237" y="${y + 19}" width="78" height="30" rx="3" fill="${severity.background}"/>
<text x="276" y="${y + 39}" text-anchor="middle" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="${severity.color}">${escapeXml(String(entry.type).toUpperCase())}</text>
<text x="349" y="${y + 35}" clip-path="url(#source-clip-${index})" font-family="Consolas, Microsoft YaHei, monospace" font-size="13" font-weight="700" fill="#363832">${escapeXml(source)}</text>
<text x="${MESSAGE_X}" y="${y + 36}" clip-path="url(#message-clip-${index})" font-size="14" fill="#363832">${message}</text>
<text x="${MESSAGE_X}" y="${recordY}" font-size="12" fill="${COLORS.muted}">记录 #${escapeXml(entry.id)}</text>
<line x1="${CONTENT_X}" y1="${y + row.height}" x2="${CONTENT_X + CONTENT_WIDTH}" y2="${y + row.height}" stroke="#E6E1D7"/>`
    }).join("\n")

    const emptyMarkup = entries.length === 0
        ? `<text x="${WIDTH / 2}" y="${HEADER_HEIGHT + 4}" text-anchor="middle" font-size="14" fill="${COLORS.muted}">没有匹配的日志</text>`
        : ""

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="Microsoft YaHei, sans-serif">
<rect width="${WIDTH}" height="${height}" fill="${COLORS.canvas}"/>
<rect x="${OUTER_X}" y="26" width="${WIDTH - OUTER_X * 2}" height="${height - 52}" fill="${COLORS.panel}" stroke="${COLORS.border}"/>
<rect x="${OUTER_X}" y="26" width="12" height="112" fill="${headerColor}"/>
<text x="${CONTENT_X}" y="70" font-size="31" font-weight="800" fill="${COLORS.text}">系统日志</text>
<text x="${CONTENT_X}" y="104" font-size="15" fill="#777469">${hasFilter ? "精确筛选结果 · 长正文最多展示 3 行" : "按时间倒序 · 每页固定 10 条"}</text>
<text x="${CONTENT_X + CONTENT_WIDTH}" y="69" text-anchor="end" font-size="12" font-weight="700" fill="${headerColor}">${hasFilter ? "FILTERED VIEW" : "OPERATIONS LOG"}</text>
<text x="${CONTENT_X + CONTENT_WIDTH}" y="96" text-anchor="end" font-size="13" fill="${COLORS.muted}">共 ${escapeXml(options.totalCount)} 条</text>
<line x1="${CONTENT_X}" y1="138" x2="${CONTENT_X + CONTENT_WIDTH}" y2="138" stroke="#DED8CB"/>
<text x="${CONTENT_X}" y="174" font-size="12" font-weight="700" fill="${COLORS.muted}">当前筛选</text>
${renderFilterTags(options.filter)}
${rowMarkup}${emptyMarkup}
<line x1="${CONTENT_X}" y1="${bodyEnd + 16}" x2="${CONTENT_X + CONTENT_WIDTH}" y2="${bodyEnd + 16}" stroke="#DED8CB"/>
<text x="${CONTENT_X}" y="${bodyEnd + 49}" font-size="12" fill="#999588">ChatBot Operations Log</text>
<text x="${CONTENT_X + CONTENT_WIDTH}" y="${bodyEnd + 49}" text-anchor="end" font-size="13" font-weight="650" fill="#55574F">第 ${escapeXml(options.page)} / ${escapeXml(options.totalPages)} 页 · 当前 ${escapeXml(entries.length)} 条</text>
</svg>`
}

export function renderLogReport(
    entries: readonly LogEntry[],
    options: RenderLogReportOptions,
): Buffer {
    const svg = renderLogReportSvg(entries, options)
    const image = new Resvg(svg, {
        font: {loadSystemFonts: true, defaultFontFamily: "Microsoft YaHei"}
    }).render().asPng()
    return Buffer.from(image.buffer, image.byteOffset, image.byteLength)
}
