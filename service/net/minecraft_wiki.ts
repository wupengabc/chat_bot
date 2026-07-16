interface WikiSearchResult {
    title?: string;
    url?: string;
    snippet?: string;
}

interface WikiSearchResponse {
    success?: boolean;
    data?: {results?: WikiSearchResult[]};
}

interface WikiPageResponse {
    success?: boolean;
    data?: {page?: {content?: {markdown?: string}}};
}

/** 搜索 Minecraft Wiki，返回最多两个结果。 */
export async function searchMinecraftWiki(query: string): Promise<WikiSearchResult[]> {
    const url = new URL("https://mcwiki.rice-awa.top/api/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "2");

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Minecraft Wiki 搜索失败: ${response.status}`);
    }

    const data = await response.json() as WikiSearchResponse;
    if (!data.success) {
        throw new Error("Minecraft Wiki 搜索失败");
    }

    return data.data?.results ?? [];
}

/** 获取 Minecraft Wiki 页面并转换后的 Markdown 内容。 */
export async function fetchMinecraftWikiPage(title: string): Promise<string> {
    const response = await fetch(`https://mcwiki.rice-awa.top/api/page/${encodeURIComponent(title)}?format=markdown`);
    if (!response.ok) {
        throw new Error(`Minecraft Wiki 页面获取失败: ${response.status}`);
    }

    const data = await response.json() as WikiPageResponse;
    const markdown = data.success ? data.data?.page?.content?.markdown : undefined;
    if (!markdown) {
        throw new Error("Minecraft Wiki 页面不存在或没有内容");
    }

    return markdown.replace(/\\./g, "").replace(/[\r\n]/g, " ");
}
