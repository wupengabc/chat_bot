import {Resvg} from "@resvg/resvg-js"

const WIDTH = 920
const OUTER_X = 30
const CONTENT_X = 66
const CONTENT_WIDTH = 788
const HEADER_ITEM_MAX_WIDTH = 300
const SOURCE_TAG_TOP = 382
const SOURCE_TAG_HEIGHT = 40
const SOURCE_TAG_GAP = 12
const SOURCE_ROW_GAP = 12
const SOURCE_TAG_MIN_WIDTH = 96
const SOURCE_TAG_MAX_WIDTH = 220
const AVERAGE_PRICE_MAX_WIDTH = 340
const OUTLIER_PRICE_MAX_WIDTH = 180
const OUTLIER_HEADER_HEIGHT = 85
const OUTLIER_ROW_HEIGHT = 47
const OUTLIER_BOTTOM_PADDING = 9

const COLORS = {
    canvas: "#EEE9DD",
    panel: "#FFFFFF",
    border: "#D9D2C3",
    text: "#24251F",
    muted: "#858277",
    accent: "#D99025",
    valid: "#16865C",
    outlier: "#C5483B",
}

export interface PriceAverageReport {
    itemName: string
    label: "出售" | "收购"
    average: number
    validShops: string[]
    outliers: Array<{shop: string; price: number}>
    generatedAt?: Date
}

function sanitizeXmlCharacters(value: unknown): string {
    return Array.from(String(value ?? ""), character => {
        const codePoint = character.codePointAt(0)!
        const valid = codePoint === 0x09
            || codePoint === 0x0a
            || codePoint === 0x0d
            || (codePoint >= 0x20 && codePoint <= 0xd7ff)
            || (codePoint >= 0xe000 && codePoint <= 0xfffd)
            || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
        return valid ? character : "�"
    }).join("")
}

function escapeXml(value: unknown): string {
    return sanitizeXmlCharacters(value)
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

function measureText(value: string, fontSize: number): number {
    let width = 0
    for (const character of Array.from(value)) {
        const codePoint = character.codePointAt(0)!
        if (character === "\t") width += fontSize * 2
        else if (/\s/u.test(character)) width += fontSize * 0.35
        else if (isWideCodePoint(codePoint) || /[MW]/u.test(character)) width += fontSize
        else width += fontSize * 0.72
    }
    return width
}

function truncateToWidth(value: unknown, maxWidth: number, fontSize: number): string {
    const text = sanitizeXmlCharacters(value)
    if (measureText(text, fontSize) <= maxWidth) return text

    const result: string[] = []
    for (const character of Array.from(text)) {
        if (measureText(`${result.join("")}${character}…`, fontSize) > maxWidth) break
        result.push(character)
    }
    return `${result.join("")}…`
}

function formatDate(value: Date): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(value)
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}`
}

function formatPrice(value: number): string {
    return Number(value).toFixed(2)
}

function fitPriceText(value: string, maxWidth: number, preferredSize: number, minimumSize: number): {fontSize: number; width: number} {
    const measure = (fontSize: number) => Array.from(value).reduce((width, character) => {
        if (/\d/u.test(character)) return width + fontSize * 0.615
        if (/[.,+\-]/u.test(character)) return width + fontSize * 0.36
        return width + fontSize * 0.62
    }, 0)
    const preferredWidth = measure(preferredSize)
    const fontSize = preferredWidth <= maxWidth
        ? preferredSize
        : Math.max(minimumSize, Math.floor(preferredSize * maxWidth / preferredWidth))
    return {fontSize, width: Math.min(maxWidth, measure(fontSize))}
}

interface SourceTag {
    x: number
    y: number
    width: number
    text: string
    index: number
}

function layoutSourceTags(shops: readonly string[]): {tags: SourceTag[]; rowCount: number} {
    const tags: SourceTag[] = []
    let x = CONTENT_X
    let row = 0

    shops.forEach((shop, index) => {
        const text = truncateToWidth(shop, SOURCE_TAG_MAX_WIDTH - 32, 14)
        const width = Math.max(
            SOURCE_TAG_MIN_WIDTH,
            Math.min(SOURCE_TAG_MAX_WIDTH, Math.ceil(measureText(text, 14) + 32)),
        )
        if (x !== CONTENT_X && x + width > CONTENT_X + CONTENT_WIDTH) {
            row++
            x = CONTENT_X
        }
        tags.push({x, y: SOURCE_TAG_TOP + row * (SOURCE_TAG_HEIGHT + SOURCE_ROW_GAP), width, text, index})
        x += width + SOURCE_TAG_GAP
    })

    return {tags, rowCount: tags.length === 0 ? 1 : row + 1}
}

export function renderPriceAverageSvg(report: PriceAverageReport): string {
    const sourceLayout = layoutSourceTags(report.validShops)
    const sourceBottom = SOURCE_TAG_TOP
        + sourceLayout.rowCount * SOURCE_TAG_HEIGHT
        + (sourceLayout.rowCount - 1) * SOURCE_ROW_GAP
    const hasOutliers = report.outliers.length > 0
    const outlierTop = sourceBottom + 41
    const outlierHeight = OUTLIER_HEADER_HEIGHT
        + report.outliers.length * OUTLIER_ROW_HEIGHT
        + OUTLIER_BOTTOM_PADDING
    const lastOutlierRowBottom = hasOutliers
        ? outlierTop + OUTLIER_HEADER_HEIGHT + report.outliers.length * OUTLIER_ROW_HEIGHT
        : sourceBottom
    const outlierBottom = hasOutliers ? outlierTop + outlierHeight : sourceBottom
    const footerLineY = outlierBottom + 16
    const footerTextY = outlierBottom + 44
    const footerBottom = outlierBottom + 48
    const panelBottom = outlierBottom + 63
    const height = panelBottom + 26
    const generatedAt = formatDate(report.generatedAt ?? new Date())
    const itemName = truncateToWidth(report.itemName, HEADER_ITEM_MAX_WIDTH, 15)
    const averageText = formatPrice(report.average)
    const averageLayout = fitPriceText(averageText, AVERAGE_PRICE_MAX_WIDTH, 57, 18)
    const averageUnitX = Math.max(305, Math.min(448, Math.ceil(96 + averageLayout.width + 12)))
    const marketLabel = report.label === "出售" ? "SELL MARKET" : "BUY MARKET"

    const sourceTags = sourceLayout.tags.map(tag =>
        `<clipPath id="source-tag-clip-${tag.index}"><rect x="${tag.x + 8}" y="${tag.y}" width="${tag.width - 16}" height="${SOURCE_TAG_HEIGHT}"/></clipPath>
<rect x="${tag.x}" y="${tag.y}" width="${tag.width}" height="${SOURCE_TAG_HEIGHT}" rx="3" fill="#F2F6EF" stroke="#CBD9C6"/>
<text x="${tag.x + tag.width / 2}" y="${tag.y + 26}" text-anchor="middle" clip-path="url(#source-tag-clip-${tag.index})" font-size="14" font-weight="650" fill="#315D43">${escapeXml(tag.text)}</text>`
    ).join("\n")

    const outlierRows = report.outliers.map((outlier, index) => {
        const rowTop = outlierTop + OUTLIER_HEADER_HEIGHT + index * OUTLIER_ROW_HEIGHT
        const textY = rowTop + 29
        const shop = truncateToWidth(outlier.shop, 288, 14)
        const price = formatPrice(outlier.price)
        const priceLayout = fitPriceText(price, OUTLIER_PRICE_MAX_WIDTH, 15, 10)
        return `<clipPath id="outlier-shop-clip-${index}"><rect x="96" y="${rowTop}" width="292" height="${OUTLIER_ROW_HEIGHT}"/></clipPath>
<text x="96" y="${textY}" clip-path="url(#outlier-shop-clip-${index})" font-size="14" font-weight="650" fill="#4A3733">${escapeXml(shop)}</text>
<text x="420" y="${textY}" font-size="13" fill="#91655E">偏离有效区间</text>
<clipPath id="outlier-price-clip-${index}"><rect x="636" y="${rowTop}" width="188" height="${OUTLIER_ROW_HEIGHT}"/></clipPath>
<text x="824" y="${textY}" text-anchor="end" clip-path="url(#outlier-price-clip-${index})" font-size="${priceLayout.fontSize}" font-weight="750" fill="${COLORS.outlier}">${escapeXml(price)}</text>`
    }).join("\n")
    const outlierSection = hasOutliers ? `<rect x="66" y="${outlierTop}" width="788" height="${outlierHeight}" fill="#FFF5F2" stroke="#E8CBC4"/>
<rect x="66" y="${outlierTop}" width="6" height="${outlierHeight}" fill="${COLORS.outlier}"/>
<text x="96" y="${outlierTop + 37}" font-size="17" font-weight="800" fill="#7D342D">未计入均值的异常价格</text>
<text x="96" y="${outlierTop + 65}" font-size="13" fill="#91655E">这些数据仍会显示，便于管理员核查来源。</text>
<line x1="96" y1="${outlierTop + OUTLIER_HEADER_HEIGHT}" x2="824" y2="${outlierTop + OUTLIER_HEADER_HEIGHT}" stroke="#E8CBC4"/>
${outlierRows}` : ""

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="Microsoft YaHei, sans-serif" data-outlier-bottom="${outlierBottom}" data-last-outlier-row-bottom="${lastOutlierRowBottom}" data-footer-bottom="${footerBottom}" data-panel-bottom="${panelBottom}">
<rect width="${WIDTH}" height="${height}" fill="${COLORS.canvas}"/>
<rect x="${OUTER_X}" y="26" width="860" height="${panelBottom - 26}" fill="${COLORS.panel}" stroke="${COLORS.border}"/>
<rect x="${OUTER_X}" y="26" width="12" height="106" fill="${COLORS.accent}"/>

<text x="66" y="68" font-size="30" font-weight="800" fill="${COLORS.text}">商店价格均值</text>
<clipPath id="header-subtitle-clip"><rect x="66" y="80" width="620" height="30"/></clipPath>
<text x="66" y="102" clip-path="url(#header-subtitle-clip)" font-size="15" fill="#777469">${escapeXml(itemName)} · ${escapeXml(report.label)}价格 · 已自动剔除异常样本</text>
<text x="854" y="67" text-anchor="end" font-size="12" font-weight="700" fill="${COLORS.valid}">${marketLabel}</text>
<text x="854" y="94" text-anchor="end" font-size="13" fill="${COLORS.muted}">${escapeXml(generatedAt)}</text>
<line x1="66" y1="132" x2="854" y2="132" stroke="#DED8CB"/>

<rect x="66" y="158" width="788" height="154" fill="#F7F4EC" stroke="#E4DED1"/>
<rect x="66" y="158" width="6" height="154" fill="${COLORS.accent}"/>
<text x="96" y="196" font-size="14" font-weight="700" fill="#777469">清洗后平均价格</text>
<clipPath id="average-price-clip"><rect x="96" y="210" width="${AVERAGE_PRICE_MAX_WIDTH}" height="70"/></clipPath>
<text x="96" y="269" clip-path="url(#average-price-clip)" font-size="${averageLayout.fontSize}" font-weight="800" fill="${COLORS.text}">${escapeXml(averageText)}</text>
<text x="${averageUnitX}" y="267" font-size="21" font-weight="700" fill="#777469">金币</text>
<line x1="500" y1="184" x2="500" y2="286" stroke="#D9D2C3"/>
<text x="530" y="205" font-size="13" fill="${COLORS.muted}">原始样本</text>
<text x="530" y="242" font-size="27" font-weight="800" fill="${COLORS.text}">${report.validShops.length + report.outliers.length}</text>
<text x="636" y="205" font-size="13" fill="${COLORS.muted}">计入均值</text>
<text x="636" y="242" font-size="27" font-weight="800" fill="${COLORS.valid}">${report.validShops.length}</text>
<text x="755" y="205" font-size="13" fill="${COLORS.muted}">异常样本</text>
<text x="755" y="242" font-size="27" font-weight="800" fill="${COLORS.outlier}">${report.outliers.length}</text>
<text x="530" y="276" font-size="12" fill="#999588">IQR 四分位距清洗</text>

<text x="66" y="359" font-size="18" font-weight="800" fill="${COLORS.text}">有效数据来源</text>
<text x="854" y="359" text-anchor="end" font-size="13" fill="${COLORS.muted}">${report.validShops.length} 家商店</text>
${sourceTags}

${outlierSection}

<line x1="66" y1="${footerLineY}" x2="854" y2="${footerLineY}" stroke="#DED8CB"/>
<text x="66" y="${footerTextY}" font-size="12" fill="#999588">ChatBot Price Insight</text>
<text x="854" y="${footerTextY}" text-anchor="end" font-size="12" fill="#999588">单位：金币</text>
</svg>`
}

export function renderPriceAverage(report: PriceAverageReport): Buffer {
    const image = new Resvg(renderPriceAverageSvg(report), {
        font: {loadSystemFonts: true, defaultFontFamily: "Microsoft YaHei"}
    }).render().asPng()
    return Buffer.from(image.buffer, image.byteOffset, image.byteLength)
}
