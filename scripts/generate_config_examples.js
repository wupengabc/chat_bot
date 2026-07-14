import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ignoredDirectories = new Set([".git", ".idea", "node_modules"])
const sensitiveKeys = /^(accessToken|apiKey|key|password|secret|token)$/i

function exampleValue(definition, currentValue) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) return currentValue
    const defaultValue = definition.default
    if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
        return Object.fromEntries(Object.entries(defaultValue).map(([key, child]) => [
            key,
            exampleValue(child, currentValue?.[key])
        ]))
    }
    return defaultValue ?? currentValue
}

function sanitize(value, key = "") {
    if (sensitiveKeys.test(key)) return `your_${key.toLowerCase()}_here`
    if (Array.isArray(value)) return value.map(item => sanitize(item))
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            sanitize(childValue, childKey)
        ]))
    }
    return value
}

function buildExample(config) {
    const example = structuredClone(config)
    if (config.config_template && Array.isArray(config.configs)) {
        example.configs = config.configs.map((item, index) => {
            const generated = Object.fromEntries(Object.entries(config.config_template).map(([key, definition]) => [
                key,
                exampleValue(definition, item[key])
            ]))
            return {name: index === 0 ? "example" : `example${index + 1}`, ...generated}
        })
    }
    return sanitize(example)
}
function scan(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) scan(path.join(directory, entry.name))
            continue
        }
        if (entry.name !== "config.json") continue

        const configPath = path.join(directory, entry.name)
        const examplePath = path.join(directory, "config_example.json")
        if (fs.existsSync(examplePath)) {
            console.log(`跳过（已存在）: ${path.relative(root, examplePath)}`)
            continue
        }

        try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
            fs.writeFileSync(examplePath, `${JSON.stringify(buildExample(config), null, 2)}\n`, "utf8")
            console.log(`已生成: ${path.relative(root, examplePath)}`)
        } catch (error) {
            console.error(`生成失败: ${path.relative(root, configPath)} - ${error.message}`)
            process.exitCode = 1
        }
    }
}

scan(root)