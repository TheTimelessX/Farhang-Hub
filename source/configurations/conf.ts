import { join as joinPath } from "path";
import { readFileSync, writeFileSync } from "fs";

const config_path = joinPath(__dirname, "conf.json");

export interface Configuration {
    bot_token: string;
    bot_username: string;
    admins: number[];
    protected_channel: string;
    posting_channel_id: number;
}

export function loadConfiguration(): Configuration {
    const buff_content = readFileSync(config_path);
    const content = JSON.parse(buff_content.toString()) as Configuration;
    return content;
}

export function saveConfiguration(configuration: Configuration): void {
    const conf = JSON.stringify(configuration, null, 4);
    writeFileSync(config_path, conf);
}

