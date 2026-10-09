import { Redis } from "ioredis";

class RedisManager {
    private driver: Redis = new Redis({
        host: "127.0.0.1",
        port: 6379,
        password: "thisistheendormyredispasswdlol23456",
        db: 0,
        keyPrefix: "app:",
        retryStrategy: (times) => Math.min(times * 200, 2000),
        maxRetriesPerRequest: 5,
        lazyConnect: true,
        enableOfflineQueue: true,
        connectTimeout: 10000,
        commandTimeout: 5000
    });

    constructor(){
        this.driver.on("error", (errmsg) => {
            console.error("[RedisManager]", errmsg.message);
        });

        this.driver.on("connect", () => {
            console.log("[RedisManager] redis database has connected");
        });
    }

    async set(prefix: string, ttl: number, data: Object): Promise<void> {
        await this.driver.set(prefix, JSON.stringify(data));
        await this.driver.expire(prefix, ttl);
    }

    async del(prefix: string): Promise<void> {
        await this.driver.del(prefix);
    }

    async show<T>(prefix: string): Promise<T | null> {
        const res = await this.driver.get(prefix);
        return res !== null ? JSON.parse(res) as T : null;
    }

    async close(){
        this.driver.disconnect();
    }
}

export const redisManager = new RedisManager();
