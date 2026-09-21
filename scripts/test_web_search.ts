import assert from "node:assert/strict"
import {extractWebImageCandidates, fetchWebImage, fetchWebPage} from "../service/net/fetch.js"
import {isPublicHttpUrl, searchWeb, searchWebWithDiagnostics} from "../service/net/search.js"

const originalFetch = globalThis.fetch
const observedQueries: string[] = []

try {
    globalThis.fetch = async (input: URL | RequestInfo): Promise<Response> => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
        if (url.hostname === "www.bing.com") {
            observedQueries.push(url.searchParams.get("q") || "")
            if (url.searchParams.get("q")?.startsWith("many") === true) {
                return new Response(Array.from({length: 20}, (_, index) =>
                    `<li class="b_algo"><h2><a href="https://example.com/result-${index}">Result ${index}</a></h2><p>Description ${index}</p></li>`,
                ).join(""))
            }
            return new Response(`
                <li class="b_algo"><h2><a href="https://example.com/article?utm_source=bing">Bing result</a></h2><p>First result</p></li>
                <li class="b_algo"><h2><a href="https://example.org/second">Second result</a></h2><p>Second description</p></li>
            `)
        }
        if (url.hostname === "html.duckduckgo.com") {
            return new Response(`
                <a class="result__a" href="https://example.com/article?ref=duck">Duplicate result</a>
                <span class="result__snippet">Duplicate description</span>
                <a class="result__a" href="https://example.net/third">Third result</a>
                <span class="result__snippet">Third description</span>
            `)
        }
        if (url.hostname === "1.1.1.1" && url.pathname === "/redirect") {
            return new Response(null, {status: 302, headers: {location: "/page"}})
        }
        if (url.hostname === "1.1.1.1" && url.pathname === "/page") {
            return new Response(`<html><head><title> Example page </title></head><body><main><figure><img src="/photo.png" alt="Relevant photo" title="Photo title"><figcaption>Photo caption</figcaption></figure>${"content ".repeat(300)}</main></body></html>`, {
                headers: {"content-type": "text/html; charset=utf-8"},
            })
        }
        if (url.hostname === "1.1.1.1" && url.pathname === "/photo.png") {
            return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
                headers: {"content-type": "image/png"},
            })
        }
        throw new Error("engine unavailable")
    }

    const results = await searchWeb("test query", {
        engines: ["bing", "duckduckgo", "baidu"],
        max_results: 3,
        parallel_engines: 2,
    })

    assert.deepEqual(results.map(result => result.url), [
        "https://example.com/article",
        "https://example.org/second",
        "https://example.net/third",
    ])
    assert.deepEqual(results.map(result => result.engine), ["bing", "bing", "duckduckgo"])
    const manyResults = await searchWeb("many", {engines: ["bing"], max_results: 20})
    assert.equal(manyResults.length, 20)
    const ranged = await searchWeb("many", {
        engines: ["bing"],
        max_results: 20,
        time_from: "2026-08-01T00:00:00+08:00",
        time_to: "2026-08-29T23:59:59+08:00",
        exclude_urls: ["https://example.com/result-0"],
    })
    assert.equal(ranged.length, 19)
    assert.match(observedQueries.at(-1) || "", /after:2026-07-31/)
    assert.match(observedQueries.at(-1) || "", /before:2026-08-30/)
    const fallback = await searchWebWithDiagnostics("test query", {engines: ["baidu", "bing"], max_results: 3})
    assert.deepEqual(fallback.diagnostics.map(item => [item.engine, item.result_count, item.error !== null]), [
        ["baidu", 0, true],
        ["bing", 2, false],
    ])
    assert.equal(await isPublicHttpUrl("http://127.0.0.1/internal"), false)
    assert.equal(await isPublicHttpUrl("http://192.168.1.1/internal"), false)
    assert.equal(await isPublicHttpUrl("http://100.64.0.1/internal"), false)
    assert.equal(await isPublicHttpUrl("http://[::ffff:192.168.1.1]/internal"), false)
    assert.equal(await isPublicHttpUrl("https://1.1.1.1/"), true)

    const page = await fetchWebPage("https://1.1.1.1/redirect", {max_chars: 1_000})
    assert.equal(page.url, "https://1.1.1.1/page")
    assert.equal(page.title, "Example page")
    assert.equal(page.truncated, true)
    assert.equal(page.images[0]?.src, "https://1.1.1.1/photo.png")
    assert.equal(page.images[0]?.alt, "Relevant photo")
    assert.equal(page.images[0]?.caption, "Photo caption")
    assert.equal(extractWebImageCandidates("<img src='https://example.com/a.jpg' alt='A'>", "https://example.com/" ).length, 1)
    const image = await fetchWebImage("https://1.1.1.1/photo.png")
    assert.equal(image.mime_type, "image/png")
    assert.equal(image.buffer.length, 8)
    await assert.rejects(() => fetchWebPage("http://127.0.0.1/internal"), /公开 HTTP\(S\) 地址/)
} finally {
    globalThis.fetch = originalFetch
}
