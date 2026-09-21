<script setup lang="ts">
import { useAlertStore } from "../../../stores/alert";

const alertStore = useAlertStore();
const pluginPath = "C:\\Users\\25089\\Desktop\\kugou_openpets\\test-plugin";
const recommendedConfig = `apikey: 你的 API Key
ipaddress: 公网服务器
gettime: 10
displaytime: 5`;
const endpoint = "https://api.wupeng1.top/api/public/info?apikey=你的_API_Key";

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    alertStore.success("已复制", `${label}已复制到剪贴板`);
  } catch {
    alertStore.error("复制失败", "请手动选择内容进行复制");
  }
}
</script>

<template>
  <article class="pet-document">
    <header class="pet-header">
      <div class="pet-kicker"><span>OPENPETS PLUGIN</span><b>动态状态</b></div>
      <h1>宠物插件配置</h1>
      <p>让 OpenPets 宠物同步显示邦溪服务器的公开聊天、玩家加入、离开与切区状态。</p>
      <div class="pet-links">
        <a href="https://openpets.dev/zh" target="_blank" rel="noreferrer">下载 OpenPets <span>↗</span></a>
        <a href="https://static.wupeng1.top/openpet_bangxi.zip" target="_blank" rel="noreferrer">下载插件压缩包 <span>↓</span></a>
      </div>
    </header>

    <div class="pet-body">
      <aside class="pet-outline">
        <span>配置指南</span>
        <a href="#install">加载插件</a>
        <a href="#settings">插件设置</a>
        <a href="#endpoint">请求接口</a>
        <a href="#tests">功能测试</a>
        <a href="#behavior">去重与展示</a>
        <a href="#troubleshooting">常见问题</a>
      </aside>

      <div class="pet-content">
        <section id="install">
          <div class="section-number">01</div>
          <h2>加载插件</h2>
          <p>打开 OpenPets 控制面板，依次点击“插件”、“本地/开发”和“加载本地插件”，再选择插件压缩包解压后的文件夹。</p>
          <div class="copy-line"><code>{{ pluginPath }}</code><button type="button" @click="copyText(pluginPath, '插件目录')">复制路径</button></div>
          <div class="unzip-callout"><strong>请选择解压后的文件夹</strong><span>不要直接选择下载的 <code>openpet_bangxi.zip</code> 压缩包。先解压，再选择其中的插件文件夹。</span></div>
          <div class="permission-card">
            <strong>首次加载时批准权限</strong>
            <span>宠物气泡显示</span><span>插件命令</span><span>插件状态</span><span>网络访问</span><span>本地网络访问</span>
          </div>
        </section>

        <section id="settings">
          <div class="section-number">02</div>
          <h2>插件设置</h2>
          <p>进入“服务器动态”插件设置，填写下列配置。API Key 由 OpenPets 以秘密配置保存，不应写入公开文本或截图。</p>
          <div class="setting-table">
            <div class="setting-head"><span>配置项</span><span>示例</span><span>说明</span></div>
            <div><code>apikey</code><span>你的 API Key</span><small>服务端接口密钥</small></div>
            <div><code>ipaddress</code><span>公网服务器</span><small>默认使用 <code>https://api.wupeng1.top</code></small></div>
            <div><code>gettime</code><span>5</span><small>请求间隔，范围 2 到 60 秒</small></div>
            <div><code>displaytime</code><span>5</span><small>气泡显示时间，范围 1 到 60 秒</small></div>
          </div>
          <div class="billing-card">
            <div><span>单次调用</span><strong>0.01 积分</strong></div>
            <div><span>10 秒间隔</span><strong>8,640 次 / 天</strong></div>
            <div><span>每日消耗</span><strong>86.40 积分</strong></div>
            <p>每次成功调用公开接口都会扣除 0.01 积分。账户没有足够积分时接口会调用失败，插件将无法获取新消息和玩家状态。</p>
          </div>
          <div class="config-block"><header><span>推荐持续运行配置</span><button type="button" @click="copyText(recommendedConfig, '推荐配置')">复制</button></header><pre><code>{{ recommendedConfig }}</code></pre></div>
        </section>

        <section id="endpoint">
          <div class="section-number">03</div>
          <h2>请求接口</h2>
          <p>插件使用 GET 请求访问公开接口。公网请求必须使用 HTTPS，OpenPets 不允许插件向公网发送明文 HTTP 请求。</p>
          <div class="endpoint-card"><span>GET</span><code>{{ endpoint }}</code><button type="button" @click="copyText(endpoint, '接口地址')">复制</button></div>
          <p>接口返回 JSON，消息和玩家列表均可为空：</p>
          <pre><code>{
  "success": true,
  "messages": [{
    "username": "玩家名",
    "content": "这是一条服务器消息",
    "create_time": "2026-07-29 12:00:00"
  }],
  "players": [{
    "username": "player_001",
    "display_name": "[一区]玩家名"
  }]
}</code></pre>
        </section>

        <section id="tests">
          <div class="section-number">04</div>
          <h2>功能测试</h2>
          <div class="test-grid">
            <article><header><b>消息</b><span>公开聊天</span></header><p>返回一条 `messages` 内容后，宠物气泡只显示消息正文，不显示玩家名。</p><code>服务器消息测试成功</code></article>
            <article><header><b>加入</b><span>玩家状态</span></header><p>先返回空玩家列表，再新增玩家。</p><code>[一区]测试玩家 加入了服务器</code></article>
            <article><header><b>离开</b><span>玩家状态</span></header><p>先让玩家存在，下一次请求从列表中移除。</p><code>[一区]测试玩家 离开了服务器</code></article>
            <article><header><b>切区</b><span>显示名变更</span></header><p>保持用户名不变，修改 `display_name` 中的区服前缀。</p><code>player_001 切区：一区 -&gt; 二区</code></article>
          </div>
        </section>

        <section id="behavior">
          <div class="section-number">05</div>
          <h2>去重与展示规则</h2>
          <div class="behavior-list">
            <div><b>消息清理</b><span>删除 `�` 等替换乱码、不可见字符和控制字符；规范化 Unicode 与空格；正文最长保留 140 个字符。</span></div>
            <div><b>会话去重</b><span>同一正文在当前插件运行期间只显示一次。服务端重复返回、时间变化或消息顺序变化都不会导致闪烁。</span></div>
            <div><b>去重容量</b><span>当前会话最多记住最近 200 条已显示消息；重载插件后会清空本次会话记录。</span></div>
            <div><b>气泡队列</b><span>多条新消息按顺序显示。后一条会等待前一条的显示时间结束，不会立即覆盖。</span></div>
          </div>
          <div class="timing-note"><strong>气泡时间测试</strong><p>将 <code>displaytime</code> 设为 <code>3</code>。收到新消息后，气泡应显示约 3 秒并自动消失。</p></div>
        </section>

        <section id="troubleshooting">
          <div class="section-number">06</div>
          <h2>常见问题</h2>
          <details open><summary>一直显示“正在等待本地服务器”</summary><p>确认 API Key 正确；确认公网接口可访问且返回 HTTP 200；检查响应中的 <code>success</code> 为 <code>true</code>；并确认 OpenPets 已批准网络访问权限。</p></details>
          <details><summary>修改消息后没有马上显示</summary><p>插件首次成功连接只建立基准，不播放历史消息。先完成一次正常请求，再新增一条消息进行测试。</p></details>
          <details><summary>同一条消息没有再次显示</summary><p>这是会话去重的预期行为。同一正文只展示一次；重载插件后才会清空去重记录。</p></details>
          <details><summary>公网请求失败</summary><p>检查服务器地址是否使用 HTTPS。OpenPets 会阻止插件访问公网明文 HTTP 接口。</p></details>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
.pet-document { min-width: 0; color: var(--panel-text); }
.pet-header { padding: 42px clamp(26px, 5vw, 70px) 35px; color: #eef5f1; background: #18382e; border-bottom: 1px solid #315c49; }
.pet-kicker { display: flex; align-items: center; gap: 8px; }.pet-kicker span { color: #9ed56c; font: 800 9px ui-monospace, SFMono-Regular, Consolas, monospace; }.pet-kicker b { padding: 3px 6px; color: #cce9d9; border: 1px solid #557965; border-radius: 2px; font-size: 8px; }
.pet-header h1 { margin: 14px 0 9px; font-size: 36px; line-height: 1.1; letter-spacing: 0; }.pet-header p { max-width: 680px; margin: 0; color: #c2d4ca; font-size: 13px; line-height: 1.7; }
.pet-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 23px; }.pet-links a { padding: 8px 10px; color: #eef5f1; background: #224a3a; border: 1px solid #4c765e; border-radius: 3px; font-size: 10px; font-weight: 800; text-decoration: none; }.pet-links a:hover { background: #2c5b47; }.pet-links a span { margin-left: 5px; color: #a5dc73; }
.pet-body { display: grid; grid-template-columns: minmax(0, 760px); justify-content: center; gap: 26px; padding: 34px clamp(24px, 5vw, 70px) 80px; }.pet-outline { position: sticky; z-index: 1; top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 7px; padding: 10px 12px; background: color-mix(in srgb, var(--panel-bg) 92%, transparent); border: 1px solid var(--border); border-left: 3px solid var(--accent); box-shadow: 0 6px 18px color-mix(in srgb, var(--shadow) 30%, transparent); backdrop-filter: blur(8px); }.pet-outline span { margin-right: 4px; font-size: 10px; font-weight: 800; }.pet-outline a { padding: 4px 6px; color: var(--muted-text); border-radius: 2px; font-size: 10px; text-decoration: none; }.pet-outline a:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
.pet-content { min-width: 0; }.pet-content section { position: relative; padding-bottom: 42px; scroll-margin-top: 20px; }.pet-content section + section { padding-top: 38px; border-top: 1px solid var(--border); }.section-number { margin-bottom: 8px; color: var(--accent); font: 800 10px ui-monospace, SFMono-Regular, Consolas, monospace; }.pet-content h2 { margin: 0 0 13px; font-size: 19px; letter-spacing: 0; }.pet-content p { margin: 0 0 16px; color: var(--muted-text); font-size: 12px; line-height: 1.8; }.pet-content code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.copy-line, .endpoint-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; margin: 17px 0; padding: 9px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }.copy-line code, .endpoint-card code { min-width: 0; overflow-wrap: anywhere; font-size: 10px; }.copy-line button, .endpoint-card button, .config-block button { height: 28px; padding: 0 8px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; font-size: 9px; font-weight: 800; }.copy-line button:hover, .endpoint-card button:hover, .config-block button:hover { border-color: var(--accent); color: var(--accent); }
.unzip-callout { display: grid; gap: 5px; margin: 17px 0; padding: 13px 14px; color: var(--warning-text); background: var(--warning-soft); border-left: 3px solid var(--warning); }.unzip-callout strong { font-size: 11px; }.unzip-callout span { color: var(--panel-text); font-size: 10px; line-height: 1.65; }
.permission-card { display: flex; flex-wrap: wrap; gap: 7px; padding: 14px; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); border-left: 3px solid var(--accent); }.permission-card strong { width: 100%; margin-bottom: 3px; font-size: 11px; }.permission-card span { padding: 4px 6px; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 2px; font-size: 9px; }
.setting-table { margin: 18px 0; overflow-x: auto; border: 1px solid var(--border); }.setting-table > div { display: grid; grid-template-columns: 120px 140px minmax(200px, 1fr); gap: 10px; min-width: 560px; padding: 10px 12px; font-size: 10px; }.setting-table > div + div { border-top: 1px solid var(--border); }.setting-table .setting-head { color: var(--muted-text); background: var(--surface); font-size: 9px; font-weight: 800; }.setting-table code { color: var(--accent); }.setting-table small { color: var(--muted-text); font-size: 10px; }.billing-card { display: grid; grid-template-columns: repeat(3, 1fr); margin: 18px 0; background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 38%, var(--border)); border-left: 3px solid var(--warning); }.billing-card > div { display: grid; gap: 5px; padding: 13px; }.billing-card > div + div { border-left: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border)); }.billing-card span { color: var(--warning-text); font-size: 9px; }.billing-card strong { font-size: 12px; }.billing-card > p { grid-column: 1 / -1; margin: 0; padding: 12px 13px; color: var(--panel-text); border-top: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border)); font-size: 10px; line-height: 1.7; }.config-block { margin-top: 18px; border: 1px solid var(--border); }.config-block header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--surface); border-bottom: 1px solid var(--border); }.config-block header span { font-size: 10px; font-weight: 800; }.config-block pre { margin: 0; }
.endpoint-card { grid-template-columns: auto minmax(0, 1fr) auto; }.endpoint-card > span { padding: 4px 6px; color: var(--accent-contrast); background: var(--accent); border-radius: 2px; font: 800 8px ui-monospace, SFMono-Regular, Consolas, monospace; }
pre { max-width: 100%; margin: 18px 0; padding: 19px; overflow-x: auto; color: #dce5df; background: #111713; border: 1px solid #354039; border-radius: 3px; font-size: 10px; line-height: 1.75; }.test-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.test-grid article { padding: 13px; background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }.test-grid header { display: flex; align-items: center; justify-content: space-between; gap: 9px; }.test-grid header b { font-size: 11px; }.test-grid header span { color: var(--muted-text); font-size: 8px; }.test-grid p { margin: 11px 0; font-size: 10px; line-height: 1.65; }.test-grid > article > code { display: block; padding: 8px; color: var(--accent); background: var(--panel-bg); border-left: 2px solid var(--accent); font-size: 9px; line-height: 1.6; overflow-wrap: anywhere; }
.behavior-list { border-top: 1px solid var(--border); }.behavior-list > div { display: grid; grid-template-columns: 105px minmax(0, 1fr); gap: 13px; padding: 13px 0; border-bottom: 1px solid var(--border); }.behavior-list b { font-size: 11px; }.behavior-list span { color: var(--muted-text); font-size: 10px; line-height: 1.7; }.timing-note { margin-top: 18px; padding: 13px 14px; background: var(--warning-soft); border-left: 3px solid var(--warning); }.timing-note strong { color: var(--warning-text); font-size: 11px; }.timing-note p { margin: 6px 0 0; color: var(--panel-text); font-size: 10px; }
details { border-bottom: 1px solid var(--border); } details:first-of-type { border-top: 1px solid var(--border); } summary { padding: 14px 2px; cursor: pointer; font-size: 11px; font-weight: 800; } details p { padding: 0 2px 14px; margin: 0; font-size: 10px; }
@media (max-width: 760px) { .pet-header { padding: 28px 20px; }.pet-header h1 { font-size: 28px; }.pet-body { display: grid; gap: 20px; padding: 28px 18px 60px; }.pet-outline { position: static; }.test-grid { grid-template-columns: 1fr; }.behavior-list > div { grid-template-columns: 1fr; gap: 5px; }.billing-card { grid-template-columns: 1fr; }.billing-card > div + div { border-top: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border)); border-left: 0; }.endpoint-card { grid-template-columns: auto minmax(0, 1fr); }.endpoint-card button { grid-column: 2; justify-self: start; } }
</style>
