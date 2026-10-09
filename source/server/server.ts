import { fastify as fast } from "fastify";
import { Bot } from "grammy";
import { Update } from "grammy/types";
import { loadConfiguration } from "../configurations";
import { packageHandler, stepHandler } from "../database";

const conf = loadConfiguration();
const app = fast({ logger: false });
const bot = new Bot(conf.bot_token).api;

const sent_packages = new Set<{ chat_id: number, mids: number[], next: number, at: number }>();

app.post("/fhub", async (request , reply) => {
    await reply.send("OK");
    const update = request.body as Update;

    if (update.message){
        if (update.message.text){
            if (update.message.text.startsWith("/start")){
                if (update.message.chat.type !== "private") return;

                const ismember = await isMember(update.message.from.id);
                if (!ismember) {
                    await bot.sendMessage(
                        update.message.chat.id,
                        "🔴 | برای استفاده از ربات اول جوین لینک داخل کانال زیر بشو",
                        {
                            reply_parameters: {
                                message_id: update.message.message_id
                            },
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "Farhang Hub",
                                            url: "https://t.me/" + conf.protected_channel.replace("@", "")
                                        }
                                    ]
                                ]
                            }
                        }
                    );
                    return;
                }

                if (update.message.text.startsWith("/start pck_")){
                    const package_id = update.message.text.slice(11).trim();
                    if (package_id.length === 0){
                        await bot.sendMessage(
                            update.message.chat.id,
                            "🔴 | لینک نا معتبره",
                            {
                                reply_parameters: {
                                    message_id: update.message.message_id
                                }
                            }
                        );
                        return;
                    }

                    const package_info = await packageHandler.getPackageById(package_id);

                    if (!package_info){
                        await bot.sendMessage(
                            update.message.chat.id,
                            "🔴 | لینک نا معتبره",
                            {
                                reply_parameters: {
                                    message_id: update.message.message_id
                                }
                            }
                        );
                        return;
                    }

                    const _pack = Array.from(sent_packages).find((val) => val.chat_id === update.message!.chat.id);

                    if (_pack){
                        await bot.sendMessage(
                            update.message.chat.id,
                            "🔴 | لطفا تا پاک شدن محتوای ارسال شده صبر کنید بعد برای درخواست مجدد اقدام کنید",
                            {
                                reply_parameters: {
                                    message_id: update.message.message_id
                                }
                            }
                        );
                        return;
                    }

                    switch (package_info.type) {
                        case "photo":
                            await packageHandler.increaseRequest(package_id);
                            for (const fid of package_info.file_ids){
                                let objects: number[] = [];
                                try {
                                    const sent_photo = await bot.sendPhoto(
                                        update.message.chat.id,
                                        fid
                                    );
                                    objects.push(sent_photo.message_id);
                                } catch (e) {
                                    console.error("[server::sentPhoto]", e);
                                }

                                if (objects.length !== 0){
                                    sent_packages.add({
                                        chat_id: update.message.chat.id,
                                        at: Date.now(),
                                        next: package_info.banner_delete_at,
                                        mids: objects
                                    });
                                }
                            }
                            break;
                        case "document":
                            await packageHandler.increaseRequest(package_id);
                            for (const fid of package_info.file_ids){
                                let objects: number[] = [];
                                try {
                                    const send_document = await bot.sendDocument(
                                        update.message.chat.id,
                                        fid
                                    );
                                    objects.push(send_document.message_id);
                                } catch (e) {
                                    console.error("[server:sendDocument:]", e);
                                }

                                if (objects.length !== 0){
                                    sent_packages.add({
                                        chat_id: update.message.chat.id,
                                        at: Date.now(),
                                        next: package_info.banner_delete_at,
                                        mids: objects
                                    });
                                }
                            }
                            break;
                        case "video":
                            await packageHandler.increaseRequest(package_id);
                            for (const fid of package_info.file_ids){
                                let objects: number[] = [];
                                try {
                                    const sent_video = await bot.sendVideo(
                                        update.message.chat.id,
                                        fid
                                    );
                                    objects.push(sent_video.message_id);
                                } catch (e) {
                                    console.error("[server::sendVideo]", e);
                                }

                                if (objects.length !== 0){
                                    sent_packages.add({
                                        chat_id: update.message.chat.id,
                                        at: Date.now(),
                                        next: package_info.banner_delete_at,
                                        mids: objects
                                    });
                                }
                            }
                            break;
                    }
                } else {
                    await bot.sendMessage(
                        update.message.chat.id,
                        "🚀 | به ربات آپلودر فرهنگ هاب خوش اومدید\n\n💎 | برای استفاده از آپلودر باید از لینک های کانال استفاده کنید",
                        {
                            reply_parameters: {
                                message_id: update.message.message_id
                            },
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "Farhang Hub",
                                            url: "https://t.me/" + conf.protected_channel.replace("@", "")
                                        }
                                    ]
                                ]
                            }
                        }
                    );
                    return;
                }
            }
        }
    }
});

app.listen({ port: 6578, host: "127.0.0.1" }, async (err, addr) => {
    if (err) console.error("[server]", err.message);
    if (addr) console.error("[server]", addr);
});

async function isMember(userId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(conf.posting_channel_id, userId);
    return ["creator", "administrator", "member", "restricted"].includes(member.status);
  } catch (error) {
    return false;
  }
}

function convertTime(context: number, from: "seconds" | "minutes" | "hours"): number {
    switch (from){
        case "seconds":
            return context * 1000;
        case "minutes":
            return context * 60 * 1000;
        case "hours":
            return context * 3600 * 1000;
    }
}

setInterval(async () => {
    for (const pck of sent_packages.entries()){
        if ((pck[0].next + pck[0].at) <= Date.now()){
            

            for (const mid of pck[0].mids){
                await bot.deleteMessages(
                    pck[0].chat_id,
                    pck[0].mids
                );
            }

            sent_packages.delete(pck[0]);
        }
    }
}, 5000);
