export interface PriceValue {
    price: number
}

export interface ShopPriceValue extends PriceValue {
    shop: string
}

export interface AdjustedShop extends ShopPriceValue {
    adjusted_price: number
}

export function split_price_outliers<T extends PriceValue>(prices: T[]): {valid: T[], outliers: T[]} {
    if (prices.length <= 5) return {valid: prices, outliers: []}

    const sorted = prices.map(item => Number(item.price)).sort((a, b) => a - b)
    const q1 = sorted[Math.floor(sorted.length * 0.25)]
    const q3 = sorted[Math.floor(sorted.length * 0.75)]
    const iqr = q3 - q1
    const lower = q1 - 1.5 * iqr
    const upper = q3 + 1.5 * iqr
    const valid = prices.filter(item => Number(item.price) >= lower && Number(item.price) <= upper)
    const outliers = prices.filter(item => Number(item.price) < lower || Number(item.price) > upper)
    return valid.length ? {valid, outliers} : {valid: prices, outliers: []}
}

/** 先按商店做均价计算，再在商店间做 IQR 异常值剔除；
 *  对因均价偏离被标记为异常的商店，尝试从其店内原始价格中选取一个最接近市场均价的单品价格，若该价格落在 IQR 正常范围内则纳入有效数据。 */
export function calculate_adjusted_shop_average(
    shopAverages: ShopPriceValue[],
    rawShopPrices: Map<string, number[]>,
): {valid: ShopPriceValue[], adjusted: AdjustedShop[], outliers: ShopPriceValue[]} {
    if (shopAverages.length <= 5) return {valid: shopAverages, adjusted: [], outliers: []}

    const sorted = shopAverages.map(item => Number(item.price)).sort((a, b) => a - b)
    const q1 = sorted[Math.floor(sorted.length * 0.25)]
    const q3 = sorted[Math.floor(sorted.length * 0.75)]
    const iqr = q3 - q1
    const lower = q1 - 1.5 * iqr
    const upper = q3 + 1.5 * iqr

    const valid = shopAverages.filter(item => Number(item.price) >= lower && Number(item.price) <= upper)
    const outlierShops = shopAverages.filter(item => Number(item.price) < lower || Number(item.price) > upper)
    if (!outlierShops.length) return {valid: shopAverages, adjusted: [], outliers: []}

    const marketAverage = valid.reduce((sum, item) => sum + Number(item.price), 0) / valid.length

    const adjusted: AdjustedShop[] = []
    const stillOutliers: ShopPriceValue[] = []

    for (const shop of outlierShops) {
        const rawPrices = rawShopPrices.get(shop.shop)
        if (!rawPrices || rawPrices.length <= 1) {
            stillOutliers.push(shop)
            continue
        }
        const best = rawPrices.reduce((best, price) =>
            Math.abs(price - marketAverage) < Math.abs(best - marketAverage) ? price : best
        )
        if (best >= lower && best <= upper) {
            adjusted.push({shop: shop.shop, price: shop.price, adjusted_price: best})
        } else {
            stillOutliers.push(shop)
        }
    }

    return {valid, adjusted, outliers: stillOutliers}
}
