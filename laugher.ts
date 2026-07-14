import fs from "node:fs"
import path from "node:path"
import {spawn, type ChildProcess} from "node:child_process"
import {fileURLToPath} from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const repository = process.env.UPDATE_REPOSITORY ?? "sg250/chat_bot"
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
async function gitee<T>(endpoint: string): Promise<T> {
    const separator = endpoint.includes("?") ? "&" : "?"
    const token = process.env.GITEE_TOKEN ? `${separator}access_token=${encodeURIComponent(process.env.GITEE_TOKEN)}` : ""
    const response = await fetch(`https://gitee.com/api/v5/repos/${repository}${endpoint}${token}`)
    if (!response.ok) throw new Error(`Gitee API ${response.status}: ${await response.text()}`)
    return response.json() as Promise<T>
}

async function download(filePath: string): Promise<Buffer> {
    const url = `https://gitee.com/${repository}/raw/${encodeURIComponent(branch)}/${filePath.split("/").map(encodeURIComponent).join("/")}`
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
        stdio: "inherit",
        detached: process.platform !== "win32"
    })
    app = child
    child.on("exit", code => {
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

        for (const item of wanted) {
            if (item.path.endsWith(".ts") && state.files[item.path] !== item.sha) {
                writeAtomic(safePath(item.path), await download(item.path))
                state.files[item.path] = item.sha
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
        if (!initial && changed > 0) await restartApp()
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
console.log(`[laugher] 已启动，每 ${interval / 60_000} 分钟检查 Gitee ${repository}/${branch}`)