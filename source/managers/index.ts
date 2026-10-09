export { mongoManager as MongoManager } from "./mongodb";
export { redisManager as RedisManager } from "./redis";
import { randomInt } from "node:crypto";

export function createTTL(reason: "user" | "project" | "package" = "package"): number {
    switch (reason){
        case "user":
            return randomInt(60,  360);
        case "project":
            return randomInt(30, 180);
        case "package":
            return randomInt(30, 250);
        default:
            return randomInt(60, 500);
    }
}

