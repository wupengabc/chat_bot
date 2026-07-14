import fs from "node:fs"
import path from "node:path"
import {spawn, type ChildProcess} from "node:child_process"
import {fileURLToPath} from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const repository = process.env.UPDATE_REPOSITORY ?? "wupengabc/chat_bot"
const branch = process.env.UPDATE_BRANCH ?? "main"
const interval = Number(process.env.UPDATE_INTERVAL_MS ?? 60_000)
const statePath = path.join(root, ".laugher-state.json")
let app: ChildProcess | null = null
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
async function github<T>(endpoint: string): Promise<T> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "chatbot-laugher"
    }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, {headers})
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
    return response.json() as Promise<T>
}

async function download(filePath: string): Promise<Buffer> {
    const headers: Record<string, string> = {"User-Agent": "chatbot-laugher"}
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const url = `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/${filePath.split("/").map(encodeURIComponent).join("/")}`
    const response = await fetch(url, {headers})
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
        const branchInfo = await github<{commit: {sha: string}}>(`/branches/${encodeURIComponent(branch)}`)
        const tree = await github<{tree: TreeItem[]}>(`/git/trees/${branchInfo.commit.sha}?recursive=1`)
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
        console.log(`[laugher] ${initial ? "启动" : "定时"}检查完成，同步 ${changed} 个 TypeScript 文件`)
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
async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    restarting = false
    if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
    }
    console.log(`[laugher] 收到 ${signal}，正在停止`)
    await stopApp(signal)
    process.exit(0)
}

if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("UPDATE_INTERVAL_MS 必须是大于 0 的毫秒数")
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

await checkForUpdates(true)
startApp()
setInterval(() => void checkForUpdates(), interval)
console.log(`[laugher] 已启动，每 ${interval / 60_000} 分钟检查 GitHub ${repository}/${branch}`)