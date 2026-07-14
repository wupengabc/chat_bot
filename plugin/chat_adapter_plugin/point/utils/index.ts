import {Resvg} from "@resvg/resvg-js"

export interface PointLogItem {
    id: number
    action: "add" | "remove"
    num: number
    reason: string
    ext: string | null
    create_at: string
}

function escapeXml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

function truncate(value: string, length: number): string {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function formatPoint(num: number): string {
    return (num / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")
}

function formatTime(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(value)).replace(/\//g, "-")
}

export function renderPointLogs(gameId: string, logs: PointLogItem[]): Buffer {
    const width = 920
    const headerHeight = 150
    const rowHeight = 76
    const emptyHeight = 130
    const height = headerHeight + (logs.length > 0 ? logs.length * rowHeight : emptyHeight) + 44
    const rows = logs.map((log, index) => {
        const y = headerHeight + index * rowHeight
        const added = log.action === "add"
        const sign = added ? "+" : "−"
        const color = added ? "#16865C" : "#C5483B"
        const background = index % 2 === 0 ? "#FFFFFF" : "#F7F4EC"
        return `<rect x="30" y="${y}" width="860" height="${rowHeight}" fill="${background}"/>
<rect x="47" y="${y + 19}" width="38" height="38" fill="${color}" opacity="0.12"/>
<text x="66" y="${y + 44}" text-anchor="middle" font-size="24" font-weight="700" fill="${color}">${sign}</text>
<text x="104" y="${y + 31}" font-size="17" font-weight="650" fill="#262821">${escapeXml(truncate(log.reason, 30))}</text>
<text x="104" y="${y + 55}" font-size="13" fill="#858277">${escapeXml(formatTime(log.create_at))} · 流水号 ${log.id}</text>
<text x="858" y="${y + 44}" text-anchor="end" font-size="23" font-weight="750" fill="${color}">${sign}${formatPoint(log.num)} 积分</text>`
    }).join("")
    const empty = logs.length === 0
        ? `<text x="460" y="215" text-anchor="middle" font-size="20" fill="#858277">暂无积分记录</text>`
        : ""
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#EEE9DD"/>
<rect x="30" y="26" width="860" height="${height - 52}" fill="#FFFFFF" stroke="#D9D2C3"/>
<rect x="30" y="26" width="12" height="100" fill="#D99025"/>
<text x="66" y="72" font-size="30" font-weight="800" fill="#24251F">积分流水</text>
<text x="66" y="105" font-size="16" fill="#777469">玩家 ${escapeXml(gameId)} · 最新 ${logs.length} 条记录</text>
<line x1="66" y1="130" x2="854" y2="130" stroke="#DED8CB"/>
${rows}${empty}
<text x="854" y="${height - 38}" text-anchor="end" font-size="12" fill="#999588">ChatBot Point Log</text>
</svg>`
    const png = new Resvg(svg, {
        font: {loadSystemFonts: true, defaultFontFamily: "Microsoft YaHei"}
    }).render().asPng()
    return Buffer.from(png.buffer, png.byteOffset, png.byteLength)
}
