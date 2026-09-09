import {OpenAI} from "openai";
import fs from "fs";
import path from "path";
import { path_utils } from "../../utils/path_utils.js";

function get_config(config_name: string) {
    const all_config = JSON.parse(fs.readFileSync(path.join(path_utils.get_project_root_path(), "/service/ai_service/config.json"), "utf-8"));
    return all_config.configs.filter((config: any) => config?.name === config_name)[0] || null;
}
export function get_ai_session(config_name: string) {
    const config = get_config(config_name);
    if (!config) {
        return null;
    }
    const session = new OpenAI({
        apiKey: config.key,
        baseURL: config.api
    })
    return {
        session,
        model: config.model
    }
}