import { fastify as fast } from "fastify";
import { Bot } from "grammy";
import { Update } from "grammy/types";
import { loadConfiguration } from "../configurations";
import { packageHandler, stepHandler } from "../database";
import { Package } from "../interfaces";

const conf = loadConfiguration();
const app = fast({ logger: false });
const bot = new Bot(conf.bot_token).api;

const sent_packages = new Set<{ chat_id: number, mids: number[], next: number, at: number }>();
const making_package = new Map<number, Omit<Partial<Package>, "package_id" | "status" | "requested">>();

app.post("/fhub", async (request , reply) => {
    await reply.send("OK");
    const update = request.body as Update;

    if (update.message){
        if (update.message.text){
            if (update.message.text.startsWith("/start") && !isAdmin(update.message.from.id)){
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
            } else if (update.message.text.startsWith("/start") && isAdmin(update.message.from.id)){
                if (update.message.chat.type !== "private") return;
                await bot.sendMessage(
                    update.message.chat.id,
                    "👤 | به پنل خوش اومدی ادمین جون\n\n🍓 | دوست داری باهم چیکار کنیم؟ از پنل زیر بهم بگو :D",
                    {
                        reply_parameters: {
                            message_id: update.message.message_id
                        },
                        reply_markup: {
                            keyboard: [
                                [
                                    {
                                        text: "📦 ساخت بنر 📦",
                                        style: "success"
                                    }
                                ]
                            ],
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );

                return;
            } else if (update.message.text === "📦 ساخت بنر 📦" && isAdmin(update.message.from.id)){
                if (update.message.chat.type !== "private") return;
                making_package.set(update.message.chat.id, { scheduled_by: update.message.from.id });
                await bot.sendMessage(
                    update.message.chat.id,
                    "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | نوع بسته چی باشه؟",
                    {
                        reply_parameters: {
                            message_id: update.message.message_id
                        },
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: `📷 عکس`,
                                        callback_data: "selectpackagetype_photo"
                                    },
                                    {
                                        text: `ویدیو 📹`,
                                        callback_data: "selectpackagetype_video"
                                    }
                                ],
                                [
                                    {
                                        text: `🗎 فایل 🗎`,
                                        callback_data: "selectpackagetype_document"
                                    }
                                ]
                            ]
                        }
                    }
                );

                return;
            } else {
                if (isAdmin(update.message.from.id)){
                    const has_step = await stepHandler.has(update.message.from.id);

                    if (has_step){
                        if (has_step.step === "getCaption"){
                            await stepHandler.delete(update.message.from.id);
                            const pre_pack = making_package.get(update.message.from.id)!;
                            making_package.set(update.message.from.id, { ...pre_pack, banner_caption: update.message.text, banner_entities: update.message.entities ?? [] });
                            await bot.sendMessage(
                                update.message.chat.id,
                                "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | نوع بنر چی باشه؟",
                                {
                                    reply_parameters: {
                                        message_id: update.message.message_id
                                    },
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                {
                                                    text: `🗟 متن خالی`,
                                                    callback_data: "selectbannertype_textonly"
                                                },
                                                {
                                                    text: `عکس 📷`,
                                                    callback_data: "selectbannertype_piconly"
                                                }
                                            ],
                                        ]
                                    }
                                }
                            );

                            return;
                        } else if (has_step.step === "getSendTimer"){
                            const splitted = update.message.text.split(" ");
                            if (splitted.length !== 2) return;
                            const awaitable_eng_number = await toEnglishDigits(splitted[0]!);
                            const awaitable_timer_type = await persianToEnglish(splitted[1]!) as "hours" | "minutes" | "seconds";
                            const ask_for_ms = await convertTime(parseInt(awaitable_eng_number), awaitable_timer_type);

                            const pre_pack = making_package.get(update.message.from.id)!;
                            making_package.set(update.message.from.id, { ...pre_pack, banner_will_at: Date.now() + ask_for_ms });

                            await stepHandler.add(update.message.from.id, { step: "getEndTimer", timestamp: Date.now() });
                            await bot.sendMessage(
                                update.message.chat.id,
                                "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | بعد از اینکه محتوا ارسال شد, چه مدت بعد پاک بکنه؟ مثال: ۳۰ ثانیه",
                                {
                                    reply_parameters: {
                                        message_id: update.message.message_id
                                    }
                                }
                            );

                            return;
                        } else if (has_step.step === "getEndTimer"){
                            const splitted = update.message.text.split(" ");
                            if (splitted.length !== 2) return;
                            const awaitable_eng_number = await toEnglishDigits(splitted[0]!);
                            const awaitable_timer_type = await persianToEnglish(splitted[1]!) as "hours" | "minutes" | "seconds";
                            const ask_for_ms = await convertTime(parseInt(awaitable_eng_number), awaitable_timer_type);

                            const pre_pack = making_package.get(update.message.from.id)!;
                            making_package.set(update.message.from.id, { ...pre_pack, banner_delete_at: ask_for_ms });

                            await stepHandler.delete(update.message.from.id);
                            const pack_id = await packageHandler.addPackage(
                                making_package.get(update.message.from.id) as any
                            );

                            await bot.sendMessage(
                                update.message.chat.id,
                                `✅ | بسته با موفقیت ساخته شد\n\n🆔 | <code>${pack_id}</code>`,
                                {
                                    parse_mode: "HTML",
                                    reply_parameters: {
                                        message_id: update.message.message_id
                                    }
                                }
                            );

                            return;
                        }
                    }
                }
            }
        } else if (update.callback_query){
            if (!update.callback_query.data) return;
            if (!update.callback_query.message) return;

            if (update.callback_query.data.startsWith("selectpackagetype")){
                const packtype = update.callback_query.data.slice(18) as "photo" | "video" | "document";
                const pre_pack = making_package.get(update.callback_query.from.id)!;
                making_package.set(update.callback_query.from.id, { ...pre_pack, type: packtype });
                stepHandler.add(update.callback_query.from.id, { step: "getCaption", timestamp: Date.now() });
                await bot.editMessageText(
                    update.callback_query.message.chat.id,
                    update.callback_query.message.message_id,
                    "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | کپشن چی باشه؟ ارسالش کن"
                );
            } else if (update.callback_query.data.startsWith("selectbannertype")){
                const bannertype = update.callback_query.data.slice(17) as "photo" | "text";
                const pre_pack = making_package.get(update.callback_query.from.id)!;
                making_package.set(update.callback_query.from.id, { ...pre_pack, banner_type: bannertype });
                if (bannertype === "photo"){
                    stepHandler.add(update.callback_query.from.id, { step: "getBannerPhoto", timestamp: Date.now() });
                    await bot.editMessageText(
                        update.callback_query.message.chat.id,
                        update.callback_query.message.message_id,
                        "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | عکس بنر رو ارسال بکن"
                    );
                    return;
                } else {
                    await stepHandler.add(update.message.from.id, { step: "getSendTimer", timestamp: Date.now() });
                    await bot.sendMessage(
                        update.message.chat.id,
                        "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | بنر توی چه زمانی ارسال بشه به چنل؟ مثال: ۱۰ دقیقه",
                        {
                            reply_parameters: {
                                message_id: update.message.message_id
                            }
                        }
                    );

                    return;
                }
            }
        } else if (update.message.photo){
            if (isAdmin(update.message.from.id)){
                const has_step = await stepHandler.has(update.message.from.id);
                if (!has_step) return;

                if (has_step.step === "getBannerPhoto" && update.message.photo){
                    await stepHandler.add(update.message.from.id, { step: "getSendTimer", timestamp: Date.now() });
                    const pre_pack = making_package.get(update.message.from.id)!;
                    making_package.set(update.message.from.id, { ...pre_pack, banner_file_ids: update.message.photo.map((vl) => vl.file_id), file_ids_length: update.message.photo.length });
                    await bot.sendMessage(
                        update.message.chat.id,
                        "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | بنر توی چه زمانی ارسال بشه به چنل؟ مثال: ۱۰ دقیقه",
                        {
                            reply_parameters: {
                                message_id: update.message.message_id
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

function isAdmin(uid: number): boolean {
    return conf.admins.includes(uid);
}

async function persianToEnglish(input: string): Promise<string> {
    switch (input) {
        case "ساعت":
            return "hours";
        case "دقیقه":
            return "minutes";
        case "ثانیه":
            return "seconds";
        default:
            return "seconds";
    }
}

async function toEnglishDigits(input: string): Promise<string> {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits  = "٠١٢٣٤٥٦٧٨٩";

  return input.replace(/[۰-۹٠-٩]/g, (char) => {
    const pIdx = persianDigits.indexOf(char);
    if (pIdx !== -1) return String(pIdx);

    const aIdx = arabicDigits.indexOf(char);
    if (aIdx !== -1) return String(aIdx);

    return char;
  });
}

async function convertTime(context: number, from: "seconds" | "minutes" | "hours"): Promise<number> {
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
            await bot.deleteMessages(
                pck[0].chat_id,
                pck[0].mids
            );

            sent_packages.delete(pck[0]);
        }
    }
}, 5000);
