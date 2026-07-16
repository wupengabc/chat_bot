import { NodeHtmlMarkdown } from "node-html-markdown";

const markdownConverter = new NodeHtmlMarkdown();

/**
 * 获取网页内容并转换为 Markdown。
 */
export async function fetchMarkdown(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }

    return markdownConverter.translate(await response.text());
}
