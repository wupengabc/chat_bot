import fs from "node:fs"
import path from "node:path"
import {spawn, type ChildProcess} from "node:child_process"
import {timingSafeEqual} from "node:crypto"
import {createServer, type Server} from "node:http"
import {fileURLToPath} from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(root, "config.json")
if (!fs.existsSync(configPath)) {
    throw new Error(`未找到配置文件: ${configPath}`)
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    update_repository: string
    update_branch: string
    gitee_token?: string
    webhook_host: string
    webhook_port: number
    webhook_path: string
    webhook_key: string
}
const repository = config.update_repository
const branch = config.update_branch
const giteeToken = config.gitee_token ?? ""
const webhookHost = config.webhook_host
const webhookPort = Number(config.webhook_port)
const webhookPath = config.webhook_path
const webhookKey = config.webhook_key
const statePath = path.join(root, ".laugher-state.json")
let app: ChildProcess | null = null
let webhookServer: Server | null = null
let checking = false
let shuttingDown = false
let restarting = false
let restartTimer: ReturnType<typeof setTimeout> | null = null

type TreeItem = {path: string, type: "blob" | "tree", sha: string}
type State = {files: Record<string, string>}

function readState(): State {
    if (!fs.existsSync(statePath)) return {files: {}}
    try {
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"))
        return {files: state.files ?? {}}
    } catch {
        return {files: {}}
    }
}

function safePath(relativePath: string): string {
    const absolute = path.resolve(root, relativePath)
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
        throw new Error(`拒绝仓库外路径: ${relativePath}`)
    }
    return absolute
}

function writeAtomic(filePath: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    const temporary = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(temporary, content)
    fs.renameSync(temporary, filePath)
}
async function gitee<T>(endpoint: string): Promise<T> {
    const url = new URL(`https://gitee.com/api/v5/repos/${repository}${endpoint}`)
    if (giteeToken) url.searchParams.set("access_token", giteeToken)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Gitee API ${response.status}: ${await response.text()}`)
    return response.json() as Promise<T>
}

async function download(filePath: string): Promise<Buffer> {
    const url = new URL(`https://gitee.com/api/v5/repos/${repository}/raw/${filePath.split("/").map(encodeURIComponent).join("/")}`)
    url.searchParams.set("ref", branch)
    if (giteeToken) url.searchParams.set("access_token", giteeToken)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`下载 ${filePath} 失败: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
}

function syncConfig(examplePath: string, template: unknown): void {
    const relative = path.join(path.dirname(examplePath), "config.json")
    const destination = safePath(relative)
    if (fs.existsSync(destination)) return

    writeAtomic(destination, `${JSON.stringify(template, null, 2)}\n`)
    console.log(`[laugher] 配置不存在，已根据模板创建: ${relative}`)
}
function startApp(): void {
    if (shuttingDown || app) return
    const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
    const child = spawn(process.execPath, [tsx, "index.ts"], {
        cwd: root,
        stdio: ["pipe", "inherit", "inherit"],
        detached: process.platform !== "win32"
    })
    app = child
    if (child.stdin) process.stdin.pipe(child.stdin, {end: false})
    child.on("exit", code => {
        if (child.stdin) process.stdin.unpipe(child.stdin)
        if (app === child) app = null
        if (!shuttingDown && !restarting) {
            console.error(`[laugher] 应用退出（${code ?? "signal"}），5 秒后重启`)
            if (restartTimer) clearTimeout(restartTimer)
            restartTimer = setTimeout(() => {
                restartTimer = null
                startApp()
            }, 5000)
        }
    })
}

async function forceKillProcessTree(child: ChildProcess): Promise<void> {
    if (!child.pid) return
    if (process.platform === "win32") {
        await new Promise<void>(resolve => {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {stdio: "ignore"})
            killer.once("error", () => resolve())
            killer.once("exit", () => resolve())
        })
        return
    }

    try {
        process.kill(-child.pid, "SIGKILL")
    } catch {
        try {
            child.kill("SIGKILL")
        } catch {
            // 进程已经退出
        }
    }
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
    if (process.platform !== "win32" && child.pid) {
        try {
            process.kill(-child.pid, signal)
            return
        } catch {
            // 进程组不存在时退回普通 kill
        }
    }
    child.kill(signal)
}

async function stopApp(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (!app) return
    const child = app
    app = null
    await new Promise<void>(resolve => {
        let settled = false
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve()
        }
        const timer = setTimeout(() => {
            void forceKillProcessTree(child).finally(finish)
        }, 10_000)
        child.once("exit", finish)
        signalProcessTree(child, signal)
    })
}

async function restartApp(): Promise<void> {
    restarting = true
    if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
    }
    await stopApp()
    restarting = false
    startApp()
}

const coreFiles = new Set([
    "index.ts",
    "storage/index.ts",
    "plugin/index.ts",
    "chat_adapter/index.ts",
    "game_adapter/index.ts",
])

function reloadUpdatedModules(changedFiles: string[]): void {
    if (!app?.stdin?.writable) {
        console.warn("[laugher] 应用输入流不可用，将执行完整重启")
        void restartApp()
        return
    }

    const commands = new Set<string>()
    for (const file of changedFiles) {
        if (file.startsWith("plugin/")) commands.add("/plugin reload")
        if (file.startsWith("storage/")) commands.add("/storage reload")
        if (file.startsWith("chat_adapter/")) commands.add("/chat reload")
        if (file.startsWith("game_adapter/")) commands.add("/game reload")
    }

    for (const command of commands) {
        app.stdin.write(`${command}\n`)
        console.log(`[laugher] 已发送热重载命令: ${command}`)
    }
}

async function checkForUpdates(initial = false): Promise<void> {
    if (checking) return
    checking = true
    try {
        const state = readState()
        const branchInfo = await gitee<{commit: {sha: string}}>(`/branches/${encodeURIComponent(branch)}`)
        const tree = await gitee<{tree: TreeItem[]}>(`/git/trees/${branchInfo.commit.sha}?recursive=1`)
        const wanted = tree.tree.filter(item =>
            item.type === "blob" &&
            item.path !== "laugher.ts" &&
            (item.path.endsWith(".ts") || item.path.endsWith("config_example.json"))
        )
        let changed = 0
        const changedFiles: string[] = []

        for (const item of wanted) {
            if (item.path.endsWith(".ts") && state.files[item.path] !== item.sha) {
                writeAtomic(safePath(item.path), await download(item.path))
                state.files[item.path] = item.sha
                changedFiles.push(item.path)
                console.log(`[laugher] 已同步: ${item.path}`)
                changed++
            } else if (item.path.endsWith("config_example.json")) {
                const configPath = safePath(path.join(path.dirname(item.path), "config.json"))
                if (!fs.existsSync(configPath)) {
                    const template = JSON.parse((await download(item.path)).toString("utf8"))
                    syncConfig(item.path, template)
                }
                state.files[item.path] = item.sha
            }
        }

        writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`)
        console.log(`[laugher] ${initial ? "启动" : "WebHook"}检查完成，同步 ${changed} 个 TypeScript 文件`)
        if (!initial && changedFiles.length > 0) {
            if (changedFiles.some(file => coreFiles.has(file))) {
                console.log("[laugher] 核心入口文件已更新，执行完整重启")
                await restartApp()
            } else {
                reloadUpdatedModules(changedFiles)
            }
        }
    } catch (error) {
        console.error(`[laugher] 更新检查失败: ${error instanceof Error ? error.message : error}`)
    } finally {
        checking = false
    }
}
function secureEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual)
    const expectedBuffer = Buffer.from(expected)
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function startWebhookServer(): void {
    webhookServer = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
        if (request.method !== "POST" || url.pathname !== webhookPath) {
            response.writeHead(404).end("Not Found")
            return
        }
        if (!secureEqual(url.searchParams.get("key") ?? "", webhookKey)) {
            response.writeHead(401).end("Unauthorized")
            return
        }

        request.resume()
        response.writeHead(202, {"Content-Type": "application/json"})
            .end(JSON.stringify({accepted: true, checking}))
        if (!checking) void checkForUpdates()
    })
    webhookServer.listen(webhookPort, webhookHost, () => {
        console.log(`[laugher] WebHook 已监听 http://${webhookHost}:${webhookPort}${webhookPath}?key=***`)
    })
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    restarting = false
    if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
    }
    console.log(`[laugher] 收到 ${signal}，正在停止`)
    if (webhookServer) {
        await new Promise<void>(resolve => webhookServer!.close(() => resolve()))
        webhookServer = null
    }
    await stopApp(signal)
    process.exit(0)
}

if (!repository || !branch) {
    throw new Error("config.json 中的 update_repository 和 update_branch 不能为空")
}
if (!Number.isInteger(webhookPort) || webhookPort < 1 || webhookPort > 65535) {
    throw new Error("WEBHOOK_PORT 必须是 1-65535 之间的整数")
}
if (!webhookPath.startsWith("/")) {
    throw new Error("WEBHOOK_PATH 必须以 / 开头")
}
if (!webhookKey) {
    throw new Error("必须设置 WEBHOOK_KEY")
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

await checkForUpdates(true)
startApp()
startWebhookServer()
console.log(`[laugher] 已启动，由 WebHook 触发检查 Gitee ${repository}/${branch}`)