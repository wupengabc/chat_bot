import {OpenAI} from "openai";
import fs from "fs";
import path from "path";
import {pathToFileURL} from "node:url";
import { path_utils } from "../../utils/path_utils.js";

function get_config() {
    return JSON.parse(fs.readFileSync(path.join(path_utils.get_project_root_path(), "/service/ai_service/config.json"), "utf-8"));
}
export function get_ai_session() {
    const config = get_config();
    const session = new OpenAI({
        apiKey: config.key,
        baseURL: config.api
    })
    return {
        session,
        model: config.model
    }
}