import type {Request, Response} from "express";
import {verify_resource_token} from "../user/auth/index.js";

export interface AdminRequest extends Request {
    admin?: {
        username: string;
        role: string;
    };
}

export function require_admin(request: AdminRequest, response: Response, next: () => void): void {
    const user = verify_resource_token(request);
    if (!user) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }
    if (user.role !== "admin" && user.role !== "owner") {
        response.status(403).json({success: false, message: "需要管理员权限"});
        return;
    }
    request.admin = {username: user.username, role: user.role};
    next();
}

export function require_owner(request: AdminRequest, response: Response, next: () => void): void {
    const user = verify_resource_token(request);
    if (!user) {
        response.status(401).json({success: false, message: "资源令牌无效或已过期"});
        return;
    }
    if (user.role !== "owner") {
        response.status(403).json({success: false, message: "该操作仅所有者可执行"});
        return;
    }
    request.admin = {username: user.username, role: user.role};
    next();
}
