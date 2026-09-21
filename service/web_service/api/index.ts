import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import type {Express} from "express";
import {install_web_filter} from "../../../service/sensitive_filter/web.js";

function getApiModulePaths(dir: string): string[] {
    const modules: string[] = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            modules.push(...getApiModulePaths(entryPath));
            continue;
        }
        if (entry.name === "index.js" || (entry.name === "index.ts" && !fs.existsSync(path.join(dir, "index.js")))) {
            modules.push(entryPath);
        }
    }
    return modules;
}

export async function init(app: Express): Promise<() => void> {
    install_web_filter(app);
    const sourceDir = path.dirname(fileURLToPath(import.meta.url));
    const reloadToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const disposeHandlers: Array<() => void> = [];
    for (const modulePath of getApiModulePaths(sourceDir).filter(item => item !== path.join(sourceDir, "index.js") && item !== path.join(sourceDir, "index.ts"))) {
        const moduleUrl = `${pathToFileURL(modulePath).href}?reload=${reloadToken}`;
        const module = await import(moduleUrl);
        if (typeof module.init !== "function") continue;
        const dispose = await module.init(app);
        if (typeof dispose === "function") disposeHandlers.push(dispose);
        if (typeof module.dispose === "function") disposeHandlers.push(module.dispose);
    }
    return () => {
        for (const dispose of disposeHandlers) dispose();
    };
}
