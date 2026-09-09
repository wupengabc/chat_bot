# 受保护世界地图

本目录的 `config.json` 是仅部署机器可读取、并被 Git 忽略的运行配置。固定世界种子只能保存于其中的敏感 `world_seeds` 字段，绝不能放入 `config_example.json`、前端构建产物、日志或任何 API 响应。

## 管理配置

在管理员配置中心编辑“受保护世界地图”：

- `enabled`：启用用户端“数据探索 -> 世界地图”入口。
- `allowed_usernames`：可访问地图的 Minecraft 用户名列表；管理员和所有者自动拥有权限。
- `world_seeds`：每个世界的种子。配置中心读取配置时会脱敏，留空保存不会覆盖已有种子。
- `worlds`：仅填写公开世界 ID、显示名称、Minecraft 版本及启用状态。

`config.json` 是本地运行配置，已由仓库忽略；首次部署可从 `config_example.json` 创建。管理员保存配置后立即影响 API 授权，无需将配置发送到客户端。

## 内置计算与传输

`web_service` 会将仓库内 `vendor/seed-map` 中的原始计算 Worker 适配到 Node `worker_threads`。部署时不再依赖项目外部的 `Seed-Map-Modify` 目录；`renderer_source_path` 仅用于需要替换计算源时覆盖默认目录。不需要 Chrome、Edge、无头浏览器或外部生成器。

仓库只保留运行所需的两个上游文件：

- `vendor/seed-map/js/cb3-libs.503f4741.js`：Minecraft 版本和群系元数据。
- `vendor/seed-map/js/inline-worker-min.503f4741.js`：世界地图计算 Worker。

这些文件来自本次迁移指定的 `Seed-Map-Modify`。上游目录未附带许可证文件，推送到公开仓库前需由仓库所有者确认其再分发授权。

通过 `/api/worlds/socket` 建立 WebSocket 后，客户端先以首条消息提交 JWT，服务端验证令牌与用户名白名单后才接收地图请求。随后客户端仅发送世界 ID、维度、缩放和坐标；Node Worker 计算生物群系并将已转换的 RGBA 像素缓冲区回传，用户端以 Canvas 绘制。Seed 只在临时 Worker 内存中使用，绝不会发送到用户浏览器、写入响应、URL 或日志。种子目前以明文保存于被 Git 忽略的服务器 `config.json`，因此部署环境必须限制该文件的读取权限；生产环境应进一步由受控密钥服务管理配置文件加密。

生成结果永久缓存于被 Git 忽略的 `service/world_map/cache`。每个瓦片覆盖 512×512 方块，Worker 从计算阶段就使用 128×128 采样（每个采样点覆盖 4×4 方块），随后传输和缓存该低采样结果。缓存不设置过期时间或容量上限，只有管理员和所有者能在配置中心的“受保护世界地图”配置中查看占用并清除。缓存文件名使用带本机随机盐的 HMAC，不包含 Seed、世界 ID 或坐标明文；修改世界种子、版本、维度、坐标或群系筛选会自动使用不同缓存项。

POI 图层尚未从原始浏览器程序中提取，`/api/worlds/:worldId/pois` 会明确返回 `501`，不会伪造空数据。

## 上游版本迁移指南

当 `C:\Users\25089\Desktop\Seed-Map-Modify` 更新后，不要直接复制整个项目，也不要把 `index.html`、`cb3-finder` 或其他浏览器 UI 文件加入本仓库。当前服务端只依赖版本/群系元数据和世界计算 Worker 两个文件。

### 1. 确认上游入口文件

打开上游的 `index.html`，找到实际加载的以下两个脚本。文件名中的哈希可能随版本变化，不能继续假设为 `503f4741`：

```html
<script src="./js/inline-worker-min.<hash>.js"></script>
<script src="./js/cb3-libs.<hash>.js"></script>
```

- `inline-worker-min.<hash>.js`：Seed Map 世界计算 Worker。
- `cb3-libs.<hash>.js`：Minecraft 版本、版本枚举和群系颜色元数据。

如果新版本不再包含这两个角色相同的文件，或者改成 WASM、ES Module、多个 Worker 文件，不要仅靠重命名强行迁移，需要先调整 Node 适配层。

### 2. 替换仓库内文件

删除 `service/world_map/vendor/seed-map/js` 中旧的这两个上游文件，将新版本对应文件复制到同一目录。不要复制任何配置、Seed、浏览器缓存或用户数据。

复制后更新 `service/web_service/api/worlds/renderer.ts` 中的三处文件名引用：

- `sourceDirectory()` 对 Worker 文件的存在性检查。
- `libraries()` 加载的 `cb3-libs` 文件名。
- `calculate()` 传给 `seed_worker.ts` 的 Worker 文件名。

可以使用以下 PowerShell 命令确认源文件和迁移后文件完全一致，两个位置的 SHA256 应分别相同：

```powershell
Get-FileHash -Algorithm SHA256 "C:\Users\25089\Desktop\Seed-Map-Modify\js\cb3-libs.<hash>.js"
Get-FileHash -Algorithm SHA256 "service\world_map\vendor\seed-map\js\cb3-libs.<hash>.js"
Get-FileHash -Algorithm SHA256 "C:\Users\25089\Desktop\Seed-Map-Modify\js\inline-worker-min.<hash>.js"
Get-FileHash -Algorithm SHA256 "service\world_map\vendor\seed-map\js\inline-worker-min.<hash>.js"
```

### 3. 检查 Node Worker 协议

当前 `service/web_service/api/worlds/seed_worker.ts` 依赖以下上游行为：

- `inline-worker-min` 在顶层创建一个 `Blob`，Blob 内容是实际 Worker 源码。
- Worker 通过 `message`/`onmessage` 接收消息。
- 请求类型是 `check`，参数中包含 `seed`、`platform`、`dimension`、`tileSize`、`tileScale` 和 `tile`。
- 响应类型仍是 `check`，并在 `results.biomes` 与 `results.biomeScale` 中返回群系数据。
- `cb3-libs` 仍可由 Node CommonJS `require()` 加载，并提供 `Edition.Java`、`JavaVersion` 和 `biomeList`。

只要其中任意一项发生变化，就必须同步修改 `seed_worker.ts` 和 `renderer.ts`。不得为了兼容新版本而把 Seed 或原始 Worker 结果发送到前端；浏览器仍只能收到服务端转换后的 RGBA 和群系 ID。

### 4. 使旧永久缓存失效

上游算法、版本枚举或群系颜色发生变化时，将 `service/web_service/api/worlds/cache.ts` 中的 `CACHE_REVISION` 增加 `1`。缓存键会因此变化，旧文件不会被新请求命中。

部署验证完成后，在管理员配置中心打开“受保护世界地图”，点击“清除永久缓存”删除旧版本遗留文件。不要手动删除正在运行服务使用的缓存目录。

### 5. 完整验证

迁移后至少执行：

```powershell
pnpm exec tsc --noEmit
pnpm --dir "service\web_service\web" run build
git diff --check
git status --short
```

还必须使用管理员配置中心已保存的服务端 Seed 做运行验证，但不得将 Seed 写入测试文件、命令行、日志或提交记录：

1. 分别请求主世界、下界和末地的地图区块，确认 WebSocket 返回数据且 Canvas 正常绘制。
2. 对同一坐标请求两次，确认第二次命中服务端永久缓存。
3. 更换坐标、Minecraft 版本和群系筛选，确认结果及缓存键会变化。
4. 在配置中心清除缓存，确认区块数量和磁盘占用归零，再次访问时能够重新生成。
5. 检查 `/api/worlds` 返回的版本与群系列表，确认新增或删除的上游数据已正确反映到前端。

### 6. 提交前检查

- `git diff` 中只能出现预期的两个新上游文件、适配代码、缓存修订号和文档变化。
- `service/world_map/config.json`、`service/world_map/cache`、Seed、令牌和本机路径不得进入提交。
- 删除已不再引用的旧哈希文件，避免部署包同时携带多版计算器。
- 再次确认新上游版本的许可证及再分发授权；没有明确授权时不要推送到公开仓库。
