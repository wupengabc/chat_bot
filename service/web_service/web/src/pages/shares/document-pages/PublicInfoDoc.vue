<script setup lang="ts">
import { useAlertStore } from "../../../stores/alert";

const alertStore = useAlertStore();
const nodeExample = `const apiKey = process.env.BX_API_KEY;
if (!apiKey) throw new Error("请设置环境变量 BX_API_KEY");

const url = new URL("http://127.0.0.1:8788/api/public/info");
url.searchParams.set("apikey", apiKey);

const response = await fetch(url);
if (!response.ok) {
  throw new Error(\`请求失败: \${response.status} \${await response.text()}\`);
}

const data = await response.json();
console.log(JSON.stringify(data, null, 2));`;

async function copyExample() {
  try {
    await navigator.clipboard.writeText(nodeExample);
    alertStore.success("已复制", "Node.js 示例已复制到剪贴板");
  } catch {
    alertStore.error("复制失败", "请手动选择代码进行复制");
  }
}
</script>

<template>
  <article class="api-document">
    <header class="document-header">
      <div class="document-eyebrow"><span>PUBLIC API</span><b>稳定版</b></div>
      <h1>游戏公开信息</h1>
      <p>使用 API Key 持续轮询邦溪服务器的公开聊天和在线玩家快照。</p>
      <div class="endpoint"><strong>GET</strong><code>/api/public/info</code><span>每次 0.01 积分</span></div>
    </header>

    <div class="document-body">
      <aside class="page-outline">
        <span>本页目录</span>
        <a href="#overview">概览</a>
        <a href="#authentication">鉴权与计费</a>
        <a href="#polling">轮询规则</a>
        <a href="#response">响应结构</a>
        <a href="#example">调用示例</a>
      </aside>

      <div class="document-content">
        <section id="overview">
          <h2>概览</h2>
          <p>接口只返回 Mineflayer 收到的公开聊天和当前在线玩家，不包含私聊、系统消息、UUID 或网络延迟。它是实时轮询接口，不提供历史消息检索。</p>
          <div class="fact-row">
            <div><span>协议</span><strong>HTTPS / JSON</strong></div>
            <div><span>鉴权</span><strong>API Key</strong></div>
            <div><span>单次费用</span><strong>0.01 积分</strong></div>
          </div>
        </section>

        <section id="authentication">
          <h2>鉴权与计费</h2>
          <p>登录网页后，从账户菜单的 <strong>API Key</strong> 页面创建密钥。密钥只显示一次，重新生成会立即废止旧密钥。</p>
          <div class="request-line"><span>Query</span><code>?apikey=你的_API_KEY</code></div>
          <div class="billing-callout">
            <strong>每次成功调用扣除 0.01 积分</strong>
            <p>无效密钥不会扣费。余额不足时返回 HTTP <code>402</code>，不会消费已积累的消息；充值后可继续获取。</p>
          </div>
          <p class="security-note">不要把 API Key 提交到代码仓库、前端公开代码或日志中。服务端程序应通过环境变量读取。</p>
        </section>

        <section id="polling">
          <h2>轮询规则</h2>
          <div class="rule-list">
            <div><b>01</b><span><strong>首次请求</strong><small>返回服务端观察到的最新一条公开消息。</small></span></div>
            <div><b>02</b><span><strong>连续请求</strong><small>返回该 Key 自上次成功请求后积累的消息，并清空本次队列。</small></span></div>
            <div><b>03</b><span><strong>闲置 60 秒</strong><small>队列过期，下一次调用重新按首次请求处理。</small></span></div>
            <div><b>04</b><span><strong>在线玩家</strong><small>每次响应都包含请求时刻的玩家列表。</small></span></div>
          </div>
        </section>

        <section id="response">
          <h2>响应结构</h2>
          <div class="field-table">
            <div class="field-head"><span>字段</span><span>类型</span><span>说明</span></div>
            <div><code>success</code><span>boolean</span><span>请求是否成功</span></div>
            <div><code>cost</code><span>number</span><span>本次扣除积分，固定为 0.01</span></div>
            <div><code>point</code><span>number</span><span>扣费后的账户积分余额</span></div>
            <div><code>messages</code><span>array</span><span>本次新增公开消息</span></div>
            <div><code>players</code><span>array</span><span>当前在线玩家</span></div>
          </div>
          <pre><code>{
  "success": true,
  "cost": 0.01,
  "point": 12.34,
  "messages": [{
    "username": "PlayerName",
    "content": "公开聊天内容",
    "create_time": "2026-07-29T12:00:00.000Z"
  }],
  "players": [{
    "username": "PlayerName",
    "display_name": "PlayerName"
  }]
}</code></pre>
        </section>

        <section id="example">
          <div class="section-heading"><div><h2>Node.js 示例</h2><p>需要 Node.js 18 或更高版本。</p></div><button type="button" @click="copyExample">复制代码</button></div>
          <pre><code>{{ nodeExample }}</code></pre>
          <div class="shell-command"><span>PowerShell</span><code>$env:BX_API_KEY = '你的_API_KEY'<br>node .\test-public-info.mjs</code></div>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
.api-document { min-width: 0; color: var(--panel-text); }
.document-header { padding: 42px clamp(26px, 5vw, 70px) 34px; background: var(--panel-bg); border-bottom: 1px solid var(--border); }
.document-eyebrow { display: flex; align-items: center; gap: 9px; }
.document-eyebrow span { color: var(--accent); font: 800 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.document-eyebrow b { padding: 3px 6px; color: var(--muted-text); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; font-size: 8px; }
.document-header h1 { margin: 14px 0 9px; font-size: 36px; line-height: 1.1; letter-spacing: 0; }
.document-header > p { max-width: 650px; margin: 0; color: var(--muted-text); font-size: 13px; line-height: 1.7; }
.endpoint { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; max-width: 690px; margin-top: 26px; padding: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.endpoint strong { padding: 5px 8px; color: var(--accent-contrast); background: var(--accent); border-radius: 2px; font-size: 9px; }
.endpoint code { min-width: 0; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.endpoint span { color: var(--warning-text); font-size: 10px; font-weight: 700; }
.document-body { display: grid; grid-template-columns: 150px minmax(0, 760px); justify-content: center; gap: clamp(30px, 5vw, 66px); padding: 42px clamp(24px, 5vw, 70px) 80px; }
.page-outline { position: sticky; top: 22px; align-self: start; display: grid; gap: 3px; padding-left: 13px; border-left: 2px solid var(--border); }
.page-outline span { margin-bottom: 8px; color: var(--panel-text); font-size: 10px; font-weight: 800; }
.page-outline a { padding: 5px 0; color: var(--muted-text); font-size: 10px; text-decoration: none; }
.page-outline a:hover { color: var(--accent); }
.document-content { min-width: 0; }
.document-content section { padding-bottom: 42px; scroll-margin-top: 20px; }
.document-content section + section { padding-top: 38px; border-top: 1px solid var(--border); }
.document-content h2 { margin: 0 0 13px; font-size: 19px; letter-spacing: 0; }
.document-content p { margin: 0 0 16px; color: var(--muted-text); font-size: 12px; line-height: 1.8; }
.document-content p strong { color: var(--panel-text); }
.document-content code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.fact-row { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 22px; border: 1px solid var(--border); }
.fact-row div { display: grid; gap: 7px; padding: 15px; }
.fact-row div + div { border-left: 1px solid var(--border); }
.fact-row span { color: var(--muted-text); font-size: 9px; }
.fact-row strong { font-size: 11px; }
.request-line { display: flex; align-items: center; gap: 13px; margin: 18px 0; padding: 12px 14px; overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }
.request-line span { color: var(--muted-text); font-size: 9px; font-weight: 800; }
.request-line code { white-space: nowrap; font-size: 11px; }
.billing-callout { margin: 18px 0; padding: 16px 17px; background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 38%, var(--border)); border-left: 4px solid var(--warning); }
.billing-callout strong { color: var(--warning-text); font-size: 12px; }
.billing-callout p { margin: 7px 0 0; color: var(--panel-text); font-size: 11px; }
.security-note { padding: 12px 14px; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); border-left: 3px solid var(--accent); }
.rule-list { border-top: 1px solid var(--border); }
.rule-list > div { display: grid; grid-template-columns: 34px 1fr; gap: 12px; padding: 15px 0; border-bottom: 1px solid var(--border); }
.rule-list > div > b { color: var(--accent); font: 800 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.rule-list span { display: grid; gap: 5px; }
.rule-list strong { font-size: 11px; }
.rule-list small { color: var(--muted-text); font-size: 10px; line-height: 1.6; }
.field-table { margin: 18px 0; border: 1px solid var(--border); }
.field-table > div { display: grid; grid-template-columns: 120px 90px minmax(0, 1fr); gap: 10px; padding: 10px 12px; font-size: 10px; }
.field-table > div + div { border-top: 1px solid var(--border); }
.field-table .field-head { color: var(--muted-text); background: var(--surface); font-size: 9px; font-weight: 800; }
.field-table code { color: var(--accent); }
.field-table div > span:last-child { color: var(--muted-text); }
pre { max-width: 100%; margin: 18px 0; padding: 19px; overflow-x: auto; color: #dce5df; background: #111713; border: 1px solid #354039; border-radius: 3px; font-size: 10px; line-height: 1.75; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; }
.section-heading p { margin-bottom: 0; }
.section-heading button { flex: none; height: 31px; padding: 0 11px; color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); border-radius: 3px; font-size: 10px; font-weight: 800; }
.shell-command { display: grid; grid-template-columns: 90px minmax(0, 1fr); border: 1px solid var(--border); }
.shell-command span, .shell-command code { padding: 11px; }
.shell-command span { color: var(--muted-text); background: var(--surface); border-right: 1px solid var(--border); font-size: 9px; font-weight: 800; }
.shell-command code { overflow-wrap: anywhere; font-size: 10px; line-height: 1.7; }
@media (max-width: 760px) {
  .document-header { padding: 28px 20px; }
  .document-header h1 { font-size: 28px; }
  .endpoint { grid-template-columns: auto minmax(0, 1fr); }
  .endpoint span { grid-column: 2; }
  .document-body { display: block; padding: 28px 18px 60px; }
  .page-outline { position: static; grid-template-columns: repeat(3, 1fr); margin-bottom: 35px; padding: 0 0 13px; border-bottom: 1px solid var(--border); border-left: 0; }
  .page-outline span { grid-column: 1 / -1; }
  .fact-row { grid-template-columns: 1fr; }
  .fact-row div + div { border-top: 1px solid var(--border); border-left: 0; }
  .field-table { overflow-x: auto; }
  .field-table > div { min-width: 520px; }
  .section-heading { align-items: stretch; flex-direction: column; }
  .section-heading button { align-self: flex-start; }
  .shell-command { grid-template-columns: 1fr; }
  .shell-command span { border-right: 0; border-bottom: 1px solid var(--border); }
}
</style>
