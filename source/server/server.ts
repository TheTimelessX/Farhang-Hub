import { fastify as fast } from "fastify";
import { Bot } from "grammy";
import { Update } from "grammy/types";
import { loadConfiguration } from "../configurations";

const conf = loadConfiguration();
const app = fast({ logger: false });
const bot = new Bot(conf.bot_token).api;


app.listen({ port: 6578, host: "127.0.0.1" }, async (err, addr) => {
    if (err) console.error("[server]", err.message);
    if (addr) console.error("[server]", addr);
});
