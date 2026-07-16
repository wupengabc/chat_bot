import { NodeHtmlMarkdown } from "node-html-markdown";

const markdownConverter = new NodeHtmlMarkdown();

/**
 * 使用 Bing 搜索并将结果页转换为 Markdown。
 */
export async function searchMarkdown(query: string): Promise<string> {
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", query);

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        }
    });
    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }

    return markdownConverter.translate(await response.text());
}
