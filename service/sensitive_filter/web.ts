import type {NextFunction, Request, Response} from "express";
import {verify_resource_token} from "../../service/web_service/api/user/auth/index.js";
import {get_storage} from "../../storage/index.js";
import {
    contains_sensitive_segments,
    filter_json,
    filter_text,
    SENSITIVE_INPUT_MESSAGE,
    type SensitiveActor,
} from "./index.js";

const INSTALLATION_MARK = "__sensitive_filter_installed";

function shouldFilterWebInput(request: Request): boolean {
    // PW is a server-side map-scan locator rather than user-facing text. It can
    // legitimately contain words from the filter list and must reach Mineflayer unchanged.
    return request.path !== "/api/map-shares/scan";
}

function requestActor(request: Request): SensitiveActor | null {
    // Public API and Agent Lobby responses must be identical for every viewer;
    // never let an owner's bypass reveal a different public version.
    if (request.path.startsWith("/api/public/") || request.path === "/api/agent/lobby" || request.path.startsWith("/api/agent/lobby/")) {
        return null;
    }
    const user = verify_resource_token(request);
    if (user) return {game_id: user.username};
    const apiKey = typeof request.query?.apikey === "string" ? request.query.apikey.trim() : "";
    if (!apiKey) return null;
    const storage = get_storage("bangxi_server_storage") as {verify_api_key?: (key: string) => {username?: string} | null} | undefined;
    const apiUser = storage?.verify_api_key?.(apiKey);
    return apiUser?.username ? {game_id: apiUser.username} : null;
}

/** Install the Web API input/output boundary exactly once per Express app. */
export function install_web_filter(app: any): void {
    if (app.locals?.[INSTALLATION_MARK]) return;
    app.locals[INSTALLATION_MARK] = true;

    app.use((request: Request, response: Response, next: NextFunction) => {
        const actor = requestActor(request);
        if (shouldFilterWebInput(request) && (contains_sensitive_segments(request.body, actor) || contains_sensitive_segments(request.query, actor))) {
            response.status(400).json({success: false, message: SENSITIVE_INPUT_MESSAGE});
            return;
        }

        const originalJson = response.json.bind(response);
        response.json = ((body: unknown) => originalJson(filter_json(body, actor))) as Response["json"];

        const originalSend = response.send.bind(response);
        response.send = ((body: unknown) => {
            if (Buffer.isBuffer(body) || body instanceof Uint8Array) return originalSend(body);
            if (typeof body !== "string") return originalSend(filter_json(body, actor));
            const contentType = response.get("content-type") || "";
            if (contentType.includes("application/json")) {
                try { return originalSend(JSON.stringify(filter_json(JSON.parse(body), actor))); }
                catch { return originalSend(filter_text(body, actor)); }
            }
            return originalSend(filter_text(body, actor));
        }) as Response["send"];
        next();
    });
}
