import { fastify as fast } from "fastify";
import { Bot } from "grammy";
import { Update, KeyboardButton } from "grammy/types";
import { Configuration, loadConfiguration, saveConfiguration } from "../configurations";
import { packageHandler, stepHandler } from "../database";
import { Package } from "../interfaces";

const conf = loadConfiguration();
const app = fast({ logger: false });
const bot = new Bot(conf.bot_token).api;

const sent_users = new Set<number>();
const making_package = new Map<number, Omit<Partial<Package>, "package_id" | "status" | "requested">>();
const stored_file_ids = new Map<number, string[]>();

type MediaGroupBuffer = {
    user_id: number;
    chat_id: number;
    step: { step: string; type?: string };
    photos: string[]; 
    first_message_id: number;
    is_banner: boolean; 
    timeout: NodeJS.Timeout;
};

const media_group_buffer = new Map<string, MediaGroupBuffer>();
const MEDIA_GROUP_DELAY_MS = 1000;

packageHandler.watch(bot, conf);

async function flushMediaGroup(media_group_id: string) {
    const buffered = media_group_buffer.get(media_group_id);
    if (!buffered) return;

    media_group_buffer.delete(media_group_id);

    if (buffered.is_banner) {
        
        await stepHandler.add(buffered.user_id, { step: "getSendTimer", timestamp: Date.now() });
        const pre_pack = making_package.get(buffered.user_id)!;
        making_package.set(buffered.user_id, {
            ...pre_pack,
            banner_file_ids: buffered.photos,
            file_ids_length: buffered.photos.length
        });

        await bot.sendMessage(
            buffered.chat_id,
            "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | بنر توی چه زمانی ارسال بشه به چنل؟ مثال: ۱۰ دقیقه",
            {
                reply_parameters: { message_id: buffered.first_message_id }
            }
        );
        return;
    }

    if (buffered.step.step === "getContent" && buffered.step.type === "photo") {
        if (!stored_file_ids.has(buffered.user_id)) {
            stored_file_ids.set(buffered.user_id, [...buffered.photos]);
        } else {
            const pre_stored = stored_file_ids.get(buffered.user_id)!;
            pre_stored.push(...buffered.photos);
            stored_file_ids.set(buffered.user_id, pre_stored);
        }
    }
}

function largestPhotoFileId(photo: { file_id: string }[]): string {
    return photo[photo.length - 1]!.file_id;
}

function pushSinglePhoto(user_id: number, file_id: string) {
    if (!stored_file_ids.has(user_id)) {
        stored_file_ids.set(user_id, [file_id]);
    } else {
        stored_file_ids.get(user_id)!.push(file_id);
    }
}

app.post("/fhub", async (request, reply) => {
    await reply.send("OK");
    const update = request.body as Update;

    if (conf.log_messages) console.log(update);

    if (update.message) {
        if (update.message.text) {
            if (update.message.text.startsWith("/cancel") && isAdmin(update.message.from.id)) {
                await stepHandler.delete(update.message.from.id);
                if (making_package.has(update.message.from.id)) making_package.delete(update.message.from.id);
                if (stored_file_ids.has(update.message.from.id)) making_package.delete(update.message.from.id);
                let mgb_to_delete: string[] = [];
                Array.from(media_group_buffer.entries()).filter((mgb) => {if (mgb[1].user_id === update.message!.from.id) mgb_to_delete.push(mgb[0])});
                for (const arrbg of mgb_to_delete){
                    media_group_buffer.delete(arrbg);
                }

                await bot.sendMessage(
                    update.message.chat.id,
                    "✅ | تمام پروسه های شما دلیت شد",
                    {
                        reply_parameters: {
                            message_id: update.message.message_id
                        }
                    }
                );
                return;
            } else if (update.message.text.startsWith("/start")) {
                if (update.message.chat.type !== "private") return;

                const configur = loadConfiguration();
                const ismember = await isMember(update.message.from.id, configur);
                if (ismember !== null) {
                    const items_to_push = [];
                    for (const lid of ismember.links_to_join) {
                        items_to_push.push({ text: "کانال", url: lid });
                    }

                    await bot.sendMessage(
                        update.message.chat.id,
                        "🔴 | برای استفاده از ربات اول جوین لینک داخل کانال زیر بشو",
                        {
                            reply_parameters: { message_id: update.message.message_id },
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "Farhang Hub",
                                            url: "https://t.me/" + conf.protected_channel.replace("@", "")
                                        }
                                    ],
                                    items_to_push
                                ]
                            }
                        }
                    );
                    return;
                }

                if (update.message.text.startsWith("/start pck_")) {
                    const package_id = update.message.text.slice(11).trim();
                    if (package_id.length === 0) {
                        await bot.sendMessage(
                            update.message.chat.id,
                            "🔴 | لینک نا معتبره",
                            { reply_parameters: { message_id: update.message.message_id } }
                        );
                        return;
                    }

                    const package_info = await packageHandler.getPackageById(package_id);

                    if (!package_info) {
                        await bot.sendMessage(
                            update.message.chat.id,
                            "🔴 | لینک نا معتبره",
                            { reply_parameters: { message_id: update.message.message_id } }
                        );
                        return;
                    }

                    const _pack = sent_users.has(update.message.from.id);

                    if (_pack) {
                        await bot.sendMessage(
                            update.message.chat.id,
                            "🔴 | لطفا تا پاک شدن محتوای ارسال شده صبر کنید بعد برای درخواست مجدد اقدام کنید",
                            { reply_parameters: { message_id: update.message.message_id } }
                        );
                        return;
                    }

                    const objects: number[] = [];

                    switch (package_info.type) {
                        case "photo":
                            await packageHandler.increaseRequest(package_id);
                            for (const fid of package_info.file_ids) {
                                try {
                                    const sent_photo = await bot.sendPhoto(
                                        update.message.chat.id,
                                        fid,
                                        { caption: `تعداد دانلود: ${package_info.requested}` }
                                    );
                                    objects.push(sent_photo.message_id);
                                } catch (e) {
                                    console.error("[server::sendPhoto]", e);
                                }
                            }
                            break;
                        case "document":
                            await packageHandler.increaseRequest(package_id);
                            for (const fid of package_info.file_ids) {
                                try {
                                    const send_document = await bot.sendDocument(
                                        update.message.chat.id,
                                        fid,
                                        { caption: `تعداد دانلود: ${package_info.requested}` }
                                    );
                                    objects.push(send_document.message_id);
                                } catch (e) {
                                    console.error("[server::sendDocument]", e);
                                }
                            }
                            break;
                        case "video":
                            await packageHandler.increaseRequest(package_id);
                            for (const fid of package_info.file_ids) {
                                try {
                                    const sent_video = await bot.sendVideo(
                                        update.message.chat.id,
                                        fid,
                                        { caption: `تعداد دانلود: ${package_info.requested}` }
                                    );
                                    objects.push(sent_video.message_id);
                                } catch (e) {
                                    console.error("[server::sendVideo]", e);
                                }
                            }
                            break;
                    }

                    if (objects.length !== 0) {
                        sent_users.add(update.message.from.id);
                        setTimeout(async () => {
                            sent_users.delete(update.message!.from.id);
                            await bot.deleteMessages(update.message!.chat.id, objects);
                        }, package_info.banner_delete_at);
                    }

                } else {
                    await bot.sendMessage(
                        update.message.chat.id,
                        "🚀 | به ربات آپلودر فرهنگ هاب خوش اومدید\n\n💎 | برای استفاده از آپلودر باید از لینک های کانال استفاده کنید",
                        {
                            reply_parameters: { message_id: update.message.message_id },
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
            } else if (update.message.text.startsWith("/panel") && isAdmin(update.message.from.id)) {
                if (update.message.chat.type !== "private") return;
                await bot.sendMessage(
                    update.message.chat.id,
                    "👤 | به پنل خوش اومدی ادمین جون\n\n🍓 | دوست داری باهم چیکار کنیم؟ از پنل زیر بهم بگو :D",
                    {
                        reply_parameters: { message_id: update.message.message_id },
                        reply_markup: {
                            keyboard: getKeyboard(),
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
                return;

            } else if (update.message.text === "تمام" && isAdmin(update.message.from.id)) {
                const pre_stored = stored_file_ids.get(update.message.from.id);
                if (!pre_stored) {
                    await bot.sendMessage(
                        update.message.chat.id,
                        "شما درحال حاضر در موقعیت ثبت پکیج نیستید"
                    );
                    return;
                } else {
                    await stepHandler.delete(update.message.from.id);
                    const pck = making_package.get(update.message.from.id) as any;
                    making_package.set(update.message.from.id, {
                        ...pck,
                        file_ids: pre_stored,
                        file_ids_length: pre_stored.length
                    });
                    stored_file_ids.delete(update.message.from.id);

                    const pack = await packageHandler.addPackage(
                        making_package.get(update.message.from.id) as any
                    );

                    await bot.sendMessage(
                        update.message.chat.id,
                        `✅ | بسته با موفقیت ساخته شد\n\n🆔 | <code>${pack.package_id}</code>`,
                        {
                            parse_mode: "HTML",
                            reply_parameters: { message_id: update.message.message_id },
                            reply_markup: {
                                keyboard: getKeyboard(),
                                one_time_keyboard: true,
                                resize_keyboard: true
                            }
                        }
                    );

                    making_package.delete(update.message.from.id);
                    return;
                }

            } else if (update.message.text === "🟥 حذف جوین اجباری 🟥" && isAdmin(update.message.from.id)) {
                if (update.message.chat.type !== "private") return;
                await bot.sendMessage(
                    update.message.chat.id,
                    "🆔 | برای حذف اطلاعات جوین اجباری فقط آیدی عددی کانالی که میخوای جوین اجباریش رو از روی من برداری بفرست تا من برای ممبر های جدید نشون ندم",
                    { reply_parameters: { message_id: update.message.message_id } }
                ).then(async (msg) => {
                    await stepHandler.add(update.message!.from.id, {
                        step: "getDeleteForceId",
                        timestamp: Date.now(),
                        mid: msg.message_id
                    });
                });
                return;

            } else if (update.message.text === "📋 لیست جوین اجباری 📋" && isAdmin(update.message.from.id)) {
                if (update.message.chat.type !== "private") return;
                const conf = loadConfiguration();
                let txt = `📄 | لیست جوین اجباری [ ${conf.force_to.length} ]\n`;

                for (const frc of conf.force_to) {
                    txt += `\n` + "=".repeat(20) + `🆔 | آیدی عددی: <code>${frc.id}</code>\n🔗 | لینک: ${frc.private_link}`;
                }

                await bot.sendMessage(
                    update.message.chat.id,
                    txt,
                    {
                        parse_mode: "HTML",
                        reply_parameters: { message_id: update.message.message_id },
                        reply_markup: {
                            keyboard: getKeyboard(),
                            one_time_keyboard: true,
                            resize_keyboard: true
                        }
                    }
                );
                return;

            } else if (update.message.text === "📦 تنظیم جوین اجباری 📦" && isAdmin(update.message.from.id)) {
                if (update.message.chat.type !== "private") return;
                await bot.sendMessage(
                    update.message.chat.id,
                    "🆔 | برای تنظیم جوین اجباری آیدی عددی چنل مورد نظر رو ارسال بکن\n\n⚠️ | قبل از ست کردن تنظیمات حتما مطمعن باش که ربات داخل چنل مورد نظر ادمینه در غیر این صورت ربات عملکرد ناموفقی خواهد داشت",
                    { reply_parameters: { message_id: update.message.message_id } }
                ).then(async (msg) => {
                    await stepHandler.add(update.message!.from.id, {
                        step: "getForceJoinId",
                        timestamp: Date.now(),
                        mid: msg.message_id
                    });
                });
                return;

            } else if (update.message.text === "⚒️ ساخت بنر ⚒️" && isAdmin(update.message.from.id)) {
                if (update.message.chat.type !== "private") return;
                making_package.set(update.message.chat.id, { scheduled_by: update.message.from.id });
                await bot.sendMessage(
                    update.message.chat.id,
                    "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | نوع بسته چی باشه؟",
                    {
                        reply_parameters: { message_id: update.message.message_id },
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: `📷 عکس`, callback_data: "selectpackagetype_photo" },
                                    { text: `ویدیو 📹`, callback_data: "selectpackagetype_video" }
                                ],
                                [
                                    { text: `📂 فایل 📂`, callback_data: "selectpackagetype_document" }
                                ]
                            ]
                        }
                    }
                );
                return;

            } else {
                if (isAdmin(update.message.from.id)) {
                    const has_step = await stepHandler.has(update.message.from.id);

                    if (has_step) {
                        if (has_step.step === "getCaption") {
                            await stepHandler.delete(update.message.from.id);
                            const pre_pack = making_package.get(update.message.from.id)!;
                            making_package.set(update.message.from.id, {
                                ...pre_pack,
                                banner_caption: update.message.text,
                                banner_entities: update.message.entities ?? []
                            });
                            await bot.sendMessage(
                                update.message.chat.id,
                                "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | نوع بنر چی باشه؟",
                                {
                                    reply_parameters: { message_id: update.message.message_id },
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                { text: `🗨️ متن خالی`, callback_data: "selectbannertype_text" },
                                                { text: `عکس 📷`, callback_data: "selectbannertype_photo" }
                                            ]
                                        ]
                                    }
                                }
                            );
                            return;

                        } else if (has_step.step === "getSendTimer") {
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
                                { reply_parameters: { message_id: update.message.message_id } }
                            );
                            return;

                        } else if (has_step.step === "getEndTimer") {
                            const splitted = update.message.text.split(" ");
                            if (splitted.length !== 2) return;
                            const awaitable_eng_number = await toEnglishDigits(splitted[0]!);
                            const awaitable_timer_type = await persianToEnglish(splitted[1]!) as "hours" | "minutes" | "seconds";
                            const ask_for_ms = await convertTime(parseInt(awaitable_eng_number), awaitable_timer_type);

                            const pre_pack = making_package.get(update.message.from.id)!;
                            making_package.set(update.message.from.id, { ...pre_pack, banner_delete_at: ask_for_ms });

                            await stepHandler.add(update.message.from.id, {
                                step: "getContent",
                                timestamp: Date.now(),
                                type: making_package.get(update.message.from.id)?.type
                            });
                            await bot.sendMessage(
                                update.message.chat.id,
                                "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | فایل هارو ارسال بکن, در آخر که همه ی محتوا آپلود شد بنویسید تمام",
                                { reply_parameters: { message_id: update.message.message_id } }
                            );
                            return;

                        } else if (has_step.step === "getForceJoinId") {
                            if (!(/^-\d+$/.test(update.message.text))) return;
                            const pre_step = await stepHandler.has(update.message.from.id);
                            await stepHandler.add(update.message.from.id, {
                                step: "getForceJoinLink",
                                timestamp: Date.now(),
                                id: parseInt(update.message.text),
                                mid: pre_step!.mid
                            });
                            await bot.editMessageText(
                                update.message.chat.id,
                                pre_step!.mid,
                                "🆔 | لینک چنل مورد نظر رو ارسال بکن\n\n⚠️ | قبل از ست کردن تنظیمات حتما مطمعن باش که ربات داخل چنل مورد نظر ادمینه در غیر این صورت ربات عملکرد ناموفقی خواهد داشت"
                            );
                            return;

                        } else if (has_step.step === "getForceJoinLink") {
                            if (!(/^https?:\/\/.+/.test(update.message.text))) return;
                            stepHandler.has(update.message.from.id).then(async (userStep) => {
                                await stepHandler.delete(update.message!.from.id);
                                const conf = loadConfiguration();
                                conf.force_to.push({ id: userStep!.id, private_link: update.message!.text! });
                                saveConfiguration(conf);
                                await bot.editMessageText(
                                    update.message!.chat.id,
                                    userStep!.mid,
                                    "✅ | عضو اجباری با موفقیت اضافه شد"
                                );
                                return;
                            });

                        } else if (has_step.step === "getDeleteForceId") {
                            if (!(/^-\d+$/.test(update.message.text))) return;
                            const pre_step = await stepHandler.has(update.message.from.id);
                            await stepHandler.delete(update.message.from.id);
                            await bot.deleteMessage(update.message.chat.id, pre_step!.mid);
                            const conf = loadConfiguration();
                            const target_channel = conf.force_to.find((vl) => vl.id === parseInt(update.message!.text!));
                            if (!target_channel) {
                                await bot.sendMessage(
                                    update.message.chat.id,
                                    "🔴 | همچین آیدی چنلی توی لیست من پیدا نشد",
                                    {
                                        reply_parameters: { message_id: update.message.message_id },
                                        reply_markup: {
                                            keyboard: getKeyboard(),
                                            one_time_keyboard: true,
                                            resize_keyboard: true
                                        }
                                    }
                                );
                                return;
                            }

                            conf.force_to = conf.force_to.filter((vl) => vl.id !== parseInt(update.message!.text!));
                            saveConfiguration(conf);

                            await bot.sendMessage(
                                update.message.chat.id,
                                "✅ | کانال مورد نظر با موفقیت از لیست جوین اجباری حذف شد",
                                {
                                    reply_parameters: { message_id: update.message.message_id },
                                    reply_markup: {
                                        keyboard: getKeyboard(),
                                        one_time_keyboard: true,
                                        resize_keyboard: true
                                    }
                                }
                            );
                            return;
                        }
                    }
                }
            }
        }

        
        else if (update.message.photo) {
            if (!isAdmin(update.message.from.id)) return;

            const has_step = await stepHandler.has(update.message.from.id);
            if (!has_step) return;

            const largest = largestPhotoFileId(update.message.photo);

            
            if (has_step.step === "getBannerPhoto") {
                if (update.message.media_group_id) {
                    
                    const mgid = update.message.media_group_id;
                    const existing = media_group_buffer.get(mgid);

                    if (existing) {
                        existing.photos.push(largest);
                        
                        clearTimeout(existing.timeout);
                        existing.timeout = setTimeout(() => {
                            flushMediaGroup(mgid).catch((e) => console.error("[flushMediaGroup:banner]", e));
                        }, MEDIA_GROUP_DELAY_MS);
                    } else {
                        const timeout = setTimeout(() => {
                            flushMediaGroup(mgid).catch((e) => console.error("[flushMediaGroup:banner]", e));
                        }, MEDIA_GROUP_DELAY_MS);

                        media_group_buffer.set(mgid, {
                            user_id: update.message.from.id,
                            chat_id: update.message.chat.id,
                            step: { step: has_step.step, type: has_step.type },
                            photos: [largest],
                            first_message_id: update.message.message_id,
                            is_banner: true,
                            timeout
                        });
                    }
                } else {
                    
                    await stepHandler.add(update.message.from.id, { step: "getSendTimer", timestamp: Date.now() });
                    const pre_pack = making_package.get(update.message.from.id)!;
                    making_package.set(update.message.from.id, {
                        ...pre_pack,
                        banner_file_ids: [largest],
                        file_ids_length: 1
                    });
                    await bot.sendMessage(
                        update.message.chat.id,
                        "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | بنر توی چه زمانی ارسال بشه به چنل؟ مثال: ۱۰ دقیقه",
                        { reply_parameters: { message_id: update.message.message_id } }
                    );
                }
                return;
            }

            
            if (has_step.step === "getContent" && has_step.type === "photo") {
                if (update.message.media_group_id) {
                    
                    const mgid = update.message.media_group_id;
                    const existing = media_group_buffer.get(mgid);

                    if (existing) {
                        existing.photos.push(largest);
                        clearTimeout(existing.timeout);
                        existing.timeout = setTimeout(() => {
                            flushMediaGroup(mgid).catch((e) => console.error("[flushMediaGroup:content]", e));
                        }, MEDIA_GROUP_DELAY_MS);
                    } else {
                        const timeout = setTimeout(() => {
                            flushMediaGroup(mgid).catch((e) => console.error("[flushMediaGroup:content]", e));
                        }, MEDIA_GROUP_DELAY_MS);

                        media_group_buffer.set(mgid, {
                            user_id: update.message.from.id,
                            chat_id: update.message.chat.id,
                            step: { step: has_step.step, type: has_step.type },
                            photos: [largest],
                            first_message_id: update.message.message_id,
                            is_banner: false,
                            timeout
                        });
                    }
                } else {
                    pushSinglePhoto(update.message.from.id, largest);
                }
            }
        }

        
        else if (update.message.document) {
            if (isAdmin(update.message.from.id)) {
                const has_step = await stepHandler.has(update.message.from.id);
                if (!has_step) return;

                if (has_step.step === "getContent" && has_step.type === "document") {
                    if (!stored_file_ids.has(update.message.from.id)) {
                        stored_file_ids.set(update.message.from.id, [update.message.document.file_id]);
                    } else {
                        stored_file_ids.get(update.message.from.id)!.push(update.message.document.file_id);
                    }
                }
            }
        }

        
        else if (update.message.video) {
            if (isAdmin(update.message.from.id)) {
                const has_step = await stepHandler.has(update.message.from.id);
                if (!has_step) return;

                if (has_step.step === "getContent" && has_step.type === "video") {
                    if (!stored_file_ids.has(update.message.from.id)) {
                        stored_file_ids.set(update.message.from.id, [update.message.video.file_id]);
                    } else {
                        stored_file_ids.get(update.message.from.id)!.push(update.message.video.file_id);
                    }
                }
            }
        }
    }

    
    else if (update.callback_query) {
        if (!update.callback_query.data) return;
        if (!update.callback_query.message) return;
        if (!update.callback_query.message.from) return;

        if (update.callback_query.data.startsWith("selectpackagetype")) {
            const packtype = update.callback_query.data.slice(18) as "photo" | "video" | "document";
            const pre_pack = making_package.get(update.callback_query.from.id)!;
            making_package.set(update.callback_query.from.id, { ...pre_pack, type: packtype });
            stepHandler.add(update.callback_query.from.id, { step: "getCaption", timestamp: Date.now() });
            await bot.editMessageText(
                update.callback_query.message.chat.id,
                update.callback_query.message.message_id,
                "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | کپشن چی باشه؟ ارسالش کن"
            );

        } else if (update.callback_query.data.startsWith("selectbannertype")) {
            const bannertype = update.callback_query.data.slice(17) as "photo" | "text";
            const pre_pack = making_package.get(update.callback_query.from.id)!;
            making_package.set(update.callback_query.from.id, { ...pre_pack, banner_type: bannertype });

            if (bannertype === "photo") {
                stepHandler.add(update.callback_query.from.id, { step: "getBannerPhoto", timestamp: Date.now() });
                await bot.editMessageText(
                    update.callback_query.message.chat.id,
                    update.callback_query.message.message_id,
                    "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | عکس بنر رو ارسال بکن (می‌تونی چندتا عکس به صورت آلبوم بفرستی)"
                );
                return;
            } else {
                await stepHandler.add(update.callback_query.from.id, { step: "getSendTimer", timestamp: Date.now() });
                await bot.sendMessage(
                    update.callback_query.message.chat.id,
                    "📦 | با این پنل میتونی بنر بسازی تا ربات خودکار به چنل ارسال بکنه\n\n💡 | بنر توی چه زمانی ارسال بشه به چنل؟ مثال: ۱۰ دقیقه",
                    { reply_parameters: { message_id: update.callback_query.message.message_id } }
                );
                return;
            }
        }
    }
});

app.listen({ port: 6578, host: "127.0.0.1" }, async (err, addr) => {
    if (err) console.error("[server]", err.message);
    if (addr) console.error("[server]", addr);
});


async function isMember(userId: number, configuration: Configuration): Promise<{ links_to_join: string[] } | null> {
    const all_links = { links_to_join: [...configuration.force_to.map((vl) => vl.private_link)] };
    try {
        let status = false;
        const member = await bot.getChatMember(conf.posting_channel_id, userId);
        status = ["creator", "administrator", "member", "restricted"].includes(member.status);

        if (!status) return all_links;

        for (const force of configuration.force_to) {
            const member = await bot.getChatMember(force.id, userId);
            const member_status = ["creator", "administrator", "member", "restricted"].includes(member.status);
            if (!member_status) return all_links;
        }

        return null;
    } catch (error) {
        return all_links;
    }
}

function isAdmin(uid: number): boolean {
    return conf.admins.includes(uid);
}

async function persianToEnglish(input: string): Promise<string> {
    switch (input) {
        case "ساعت": return "hours";
        case "دقیقه": return "minutes";
        case "ثانیه": return "seconds";
        default: return "seconds";
    }
}

async function toEnglishDigits(input: string): Promise<string> {
    const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
    const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

    return input.replace(/[۰-۹٠-٩]/g, (char) => {
        const pIdx = persianDigits.indexOf(char);
        if (pIdx !== -1) return String(pIdx);
        const aIdx = arabicDigits.indexOf(char);
        if (aIdx !== -1) return String(aIdx);
        return char;
    });
}

async function convertTime(context: number, from: "seconds" | "minutes" | "hours"): Promise<number> {
    switch (from) {
        case "seconds": return context * 1000;
        case "minutes": return context * 60 * 1000;
        case "hours": return context * 3600 * 1000;
    }
}

function getKeyboard(): KeyboardButton[][] {
    return [
        [
            { text: "⚒️ ساخت بنر ⚒️", style: "success" },
            { text: "📦 تنظیم جوین اجباری 📦", style: "success" }
        ],
        [
            { text: "📋 لیست جوین اجباری 📋", style: "primary" }
        ],
        [
            { text: "🟥 حذف جوین اجباری 🟥", style: "danger" }
        ]
    ];
}

