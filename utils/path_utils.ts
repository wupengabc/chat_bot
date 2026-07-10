import * as path from 'path'
import { fileURLToPath } from 'url'
import * as fs from "node:fs";

function get_project_root_path() {
    // @ts-ignore
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    return path.resolve(__dirname, '..')
}


function get_path_dir_list(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => path.join(dir, item.name));
}

export const path_utils = {
    get_project_root_path,
    get_path_dir_list,
}