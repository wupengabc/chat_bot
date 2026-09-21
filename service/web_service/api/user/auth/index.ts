import {createHmac, timingSafeEqual} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {Express, Request, Response} from "express";
import {get_storage} from "../../../../../storage/index.js";
import {log_utils} from "../../../../../utils/log_utils.js";
import {path_utils} from "../../../../../utils/path_utils.js";

const JWT_ALGORITHM = "HS256";
const RESOURCE_TOKEN_EXPIRES_IN_SECONDS = 60 * 15;
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;

interface AuthenticatedUser {
    username: string;
    role: string;
    registered: boolean;
}

type TokenType = "resource" | "refresh";

interface JwtConfig {
    web_jwt_resource_secret?: string;
    web_jwt_refresh_secret?: string;
}

function getJwtSecrets(): {resource: string, refresh: string} | null {
    try {
        const configPath = path.join(path_utils.get_project_root_path(), "config.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as JwtConfig;
        const resource = config.web_jwt_resource_secret;
        const refresh = config.web_jwt_refresh_secret;
        if (!resource || !refresh || resource.length < 32 || refresh.length < 32) return null;
        return {resource, refresh};
    } catch {
        return null;
    }
}

function base64UrlEncode(value: string): string {
    return Buffer.from(value).toString("base64url");
}

function base64UrlDecode<T>(value: string): T | null {
    try {
        return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
    } catch {
        return null;
    }
}

function signJwt(user: AuthenticatedUser, type: TokenType, secret: string, expiresIn: number): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({alg: JWT_ALGORITHM, typ: "JWT"}));
    const payload = base64UrlEncode(JSON.stringify({sub: user.username, role: user.role, token_type: type, iat: now, exp: now + expiresIn}));
    const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
}

function verifyJwt(token: string, type: TokenType, secret: string): AuthenticatedUser | null {
    const [headerPart, payloadPart, signature] = token.split(".");
    if (!headerPart || !payloadPart || !signature) return null;

    const header = base64UrlDecode<{alg?: string, typ?: string}>(headerPart);
    const payload = base64UrlDecode<{sub?: string, role?: string, token_type?: string, exp?: number}>(payloadPart);
    if (header?.alg !== JWT_ALGORITHM || header.typ !== "JWT" || !payload?.sub || !payload.role || !payload.exp || payload.token_type !== type) return null;

    const expectedSignature = createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest();
    const providedSignature = Buffer.from(signature, "base64url");
    if (expectedSignature.length !== providedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

    return {username: payload.sub, role: payload.role, registered: true};
}

function getBearerToken(request: Request): string | null {
    const authorization = request.header("authorization");
    if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim() || null;
    // Browser image elements cannot attach Authorization headers. Keep query-token support
    // limited to authenticated map artwork preview requests.
    if (request.method === "GET" && request.path.startsWith("/api/map-shares-preview/")) {
        const token = request.query.token;
        return typeof token === "string" ? token.trim() || null : null;
    }
    return null;
}

/** 验证请求中的资源 Token，并检查用户是否存在，供需要登录身份的用户端路由复用。 */
export function verify_resource_token(request: Request): AuthenticatedUser | null {
    const token = getBearerToken(request);
    const secrets = getJwtSecrets();
    if (!token || !secrets) return null;
    const user = verifyJwt(token, "resource", secrets.resource);
    if (!user) return null;
    const storage = get_storage("bangxi_server_storage") as {get_user_info?: (username: string) => any} | undefined;
    const dbUser = storage?.get_user_info?.(user.username);
    if (!dbUser) return null;
    // A role embedded in an already-issued token can be stale after an
    // account permission change. Use the current game account record.
    return {
        ...user,
        role: typeof dbUser.role === "string" ? dbUser.role : "member",
    };
}

function issueTokens(user: AuthenticatedUser, secrets: {resource: string, refresh: string}) {
    return {
        resource_token: signJwt(user, "resource", secrets.resource, RESOURCE_TOKEN_EXPIRES_IN_SECONDS),
        refresh_token: signJwt(user, "refresh", secrets.refresh, REFRESH_TOKEN_EXPIRES_IN_SECONDS),
        resource_expires_in: RESOURCE_TOKEN_EXPIRES_IN_SECONDS,
        refresh_expires_in: REFRESH_TOKEN_EXPIRES_IN_SECONDS,
    };
}

function getRequestIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || "unknown";
}

export async function init(app: Express) {
app.post("/api/user/auth/login", (request: Request, response: Response) => {
    const secrets = getJwtSecrets();
    if (!secrets) {
response.status(503).json({success: false, message: "JWT 密钥未配置"});
        return;
    }

    const {username, password} = request.body ?? {};
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
        log_utils.logger("web_api", "auth", `登录失败：请求参数无效，IP: ${getRequestIp(request)}`, "warn");
        response.status(400).json({success: false, message: "用户名和密码为必填项"});
        return;
    }

    const storage = get_storage("bangxi_server_storage") as {verify_user_password?: (username: string, password: string) => AuthenticatedUser | null} | undefined;
    const user = storage?.verify_user_password?.(username, password);
    if (!user || user.registered !== true) {
        const account = typeof username === "string" ? username.trim() || "(空)" : "(无效)";
        log_utils.logger("web_api", "auth", `登录失败：用户不存在，用户名 ${account}，IP: ${getRequestIp(request)}`, "warn");
        response.status(401).json({success: false, message: "用户不存在"});
        return;
    }

    log_utils.logger("web_api", "auth", `登录成功：用户名 ${user.username}，IP: ${getRequestIp(request)}`, "info");

    response.json({
        success: true,
        ...issueTokens(user, secrets),
        user,
    });
});

app.post("/api/user/auth/refresh", (request: Request, response: Response) => {
    const secrets = getJwtSecrets();
    const refreshToken = request.body?.refresh_token;
    if (!secrets) {
        response.status(503).json({success: false, message: "JWT 密钥未配置"});
        return;
    }

    const user = typeof refreshToken === "string"
        ? verifyJwt(refreshToken, "refresh", secrets.refresh)
        : null;

    if (!user) {
        response.status(401).json({success: false, message: "刷新令牌无效或已过期"});
        return;
    }

    const storage = get_storage("bangxi_server_storage") as {get_user_info?: (username: string) => any} | undefined;
    const dbUser = storage?.get_user_info?.(user.username);
    if (!dbUser) {
        response.status(401).json({success: false, message: "用户已被删除"});
        return;
    }

    response.json({
        success: true,
        ...issueTokens({
            ...user,
            role: typeof dbUser.role === "string" ? dbUser.role : "member",
        }, secrets),
    });
});

app.get("/api/user/auth/me", (request: Request, response: Response) => {
    const user = verify_resource_token(request);

    if (!user) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    response.json({success: true, user});
});

app.get("/api/user/auth/api-key", (request: Request, response: Response) => {
    const user = verify_resource_token(request);
    if (!user) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    const storage = get_storage("bangxi_server_storage") as {has_api_key?: (username: string) => boolean} | undefined;
    if (!storage?.has_api_key) {
        response.status(503).json({success: false, message: "用户存储不可用"});
        return;
    }
    response.json({success: true, configured: storage.has_api_key(user.username)});
});

app.post("/api/user/auth/api-key", (request: Request, response: Response) => {
    const user = verify_resource_token(request);
    if (!user) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }

    const storage = get_storage("bangxi_server_storage") as {create_api_key?: (username: string) => string | null} | undefined;
    const apiKey = storage?.create_api_key?.(user.username);
    if (!apiKey) {
        response.status(503).json({success: false, message: "无法创建 API key"});
        return;
    }
    log_utils.logger("web_api", "auth", `用户 ${user.username} 创建了 API key，IP: ${getRequestIp(request)}`, "info");
    response.json({success: true, apikey: apiKey});
});
}
