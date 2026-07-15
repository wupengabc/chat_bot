import type {LogFilter} from "../../../utils/log_utils.js"

export type ParsedLogArgs =
    | {ok: true; page: number; filter: LogFilter}
    | {ok: false; message: string}

export type LogAccess =
    | {ok: true; gameId: string; permission: number}
    | {ok: false; message: string}

type PermissionStorage = {
    get_user_info(userId: string): {game_id?: string | null} | null | undefined
}

type PlayerStorage = {
    user_permission_map: Record<string, number>
    get_user_info(gameId: string): {role?: string | null} | null | undefined
}

const usage = "用法：log [页码] [type=info|warn|error] [platform=<平台>] [plugin=<插件>]"

function invalidLogArgs(): ParsedLogArgs {
    return {ok: false, message: usage}
}

export function parseLogArgs(args: readonly string[]): ParsedLogArgs {
    const filter: LogFilter = {}
    const normalizedKeys = new Set<string>()
    let page = 1
    let hasPage = false

    for (const rawArg of args) {
        const arg = rawArg.trim()
        if (/^\d+$/.test(arg)) {
            const parsedPage = Number(arg)
            if (hasPage || !Number.isSafeInteger(parsedPage) || parsedPage < 1) return invalidLogArgs()
            page = parsedPage
            hasPage = true
            continue
        }

        const separatorIndex = arg.indexOf("=")
        if (separatorIndex < 0) return invalidLogArgs()

        const key = arg.slice(0, separatorIndex).trim().toLowerCase()
        const value = arg.slice(separatorIndex + 1).trim()
        if (!value || normalizedKeys.has(key)) return invalidLogArgs()
        normalizedKeys.add(key)

        if (key === "type") {
            const type = value.toLowerCase()
            if (type !== "info" && type !== "warn" && type !== "error") return invalidLogArgs()
            filter.type = type
        } else if (key === "platform") {
            filter.platform = value
        } else if (key === "plugin") {
            filter.plugin = value
        } else {
            return invalidLogArgs()
        }
    }

    return {ok: true, page, filter}
}

export function resolveLogAccess(
    userId: string,
    permissionStorage?: PermissionStorage | null,
    playerStorage?: PlayerStorage | null,
): LogAccess {
    if (!permissionStorage || !playerStorage) return {ok: false, message: "日志系统未初始化"}

    const gameId = permissionStorage.get_user_info(userId)?.game_id
    if (!gameId) return {ok: false, message: "你暂未绑定游戏账号"}

    const role = playerStorage.get_user_info(gameId)?.role
    const permission = role ? playerStorage.user_permission_map[role] ?? 0 : 0
    if (!Number.isFinite(permission) || permission < 2) {
        return {ok: false, message: "权限不足，只有权限等级 2 的用户可以查询日志"}
    }

    return {ok: true, gameId, permission}
}
