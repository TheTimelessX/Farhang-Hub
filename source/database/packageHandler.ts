import { MongoManager, RedisManager, createTTL } from "../managers";
import { Configuration } from "../configurations";
import { Package } from "../interfaces";
import { Api, RawApi, InputMediaBuilder } from "grammy";
import { randomUUID } from "crypto";

class PackageHandler {
    private db: string = "packages";
    private coll: string = "packages_collection";
    private has_watching: boolean = false;

    constructor() {
        MongoManager.connect();
    }

    private async ensureReady(): Promise<void> {
        await MongoManager.connect();
    }

    async getPackageById(package_id: string): Promise<Package | null> {
        await this.ensureReady();
        return new Promise(async (resolve) => {
            const red_package = await RedisManager.show<Package>(`package:${package_id}`);
            if (red_package) {
                return resolve(red_package);
            }

            const db_package = await MongoManager.show(this.db, this.coll).findOne<Package>({ package_id });
            if (db_package) await RedisManager.set(`package:${package_id}`, createTTL(), db_package);

            return resolve(db_package ?? null);
        });
    }

    async getPendingPackages(): Promise<Package[]> {
        await this.ensureReady();
        return new Promise(async (resolve) => {
            const pending_packages = await MongoManager.show(this.db, this.coll)
                .find<Package>({ status: "pending" }).toArray();
            return resolve(pending_packages);
        });
    }

    async changePackageStatus(package_id: string, status: "done" | "pending"): Promise<void> {
        await this.ensureReady();
        return new Promise(async (resolve) => {
            const xpackage = await this.getPackageById(package_id);
            if (!xpackage) return resolve();

            xpackage.status = status;
            await MongoManager.show(this.db, this.coll).updateOne({ package_id }, { $set: { status } });
            await RedisManager.set(`package:${package_id}`, createTTL(), xpackage);
            return resolve();
        });
    }

    async increaseRequest(package_id: string): Promise<void> {
        await this.ensureReady();
        return new Promise(async (resolve) => {
            const xpackage = await this.getPackageById(package_id);
            if (!xpackage) return resolve();

            xpackage.requested++;
            await MongoManager.show(this.db, this.coll).updateOne({ package_id }, { $set: { requested: xpackage.requested } });
            await RedisManager.set(`package:${package_id}`, createTTL(), xpackage);
            return resolve();
        });
    }

    async addPackage(packaged: Omit<Package, "package_id" | "status" | "requested">): Promise<Package> {
        await this.ensureReady();
        return new Promise(async (resolve) => {
            const package_id = randomUUID();
            const package_info: Package = {
                ...packaged,
                package_id,
                status: "pending",
                requested: 0
            };

            await MongoManager.show(this.db, this.coll).insertOne(package_info);
            await RedisManager.set(`package:${package_id}`, createTTL(), package_info);
            return resolve(package_info);
        });
    }

    async deletePackage(package_id: string): Promise<boolean> {
        await this.ensureReady();
        return new Promise(async (resolve) => {
            const does_exist = await this.getPackageById(package_id);
            if (!does_exist) return resolve(false);

            await MongoManager.show(this.db, this.coll).deleteOne({ package_id });
            const red_package = await RedisManager.show<Package>(`package:${package_id}`);
            if (red_package) await RedisManager.del(`package:${package_id}`);

            return resolve(true);
        });
    }

    async watch(bot: Api<RawApi>, configuration: Configuration): Promise<void> {
        if (this.has_watching) return;
        this.has_watching = true;
        await this.ensureReady();

        setInterval(async () => {
            const pending_packages = await this.getPendingPackages();
            const limit_time_ms = 5000;
            let queue_on = 1;

            for (const pending_package of pending_packages) {
                if (pending_package.banner_will_at <= Date.now()) {
                    setTimeout(async () => {
                        try {
                            await this.sendBanner(bot, configuration, pending_package);
                        } catch (e) {
                            console.error("[packageHandler::watch]", e);
                        }
                    }, limit_time_ms * queue_on);

                    queue_on += 1;
                }
            }
        }, 10000);
    }

    private async sendBanner(
        bot: Api<RawApi>,
        configuration: Configuration,
        pending_package: Package
    ): Promise<void> {
        const deepLink = `https://t.me/${configuration.bot_username.replaceAll("@", "")}?start=pck_${pending_package.package_id}`;

        if (pending_package.banner_type === "text") {
            const smsg = await bot.sendMessage(
                configuration.posting_channel_id,
                pending_package.banner_caption,
                {
                    entities: pending_package.banner_entities,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "⇨ 𝑫𝒐𝒘𝒏𝒍𝒐𝒂𝒅",
                                    url: deepLink,
                                    style: "primary"
                                }
                            ]
                        ]
                    }
                }
            );

            await this.changePackageStatus(pending_package.package_id, "done");
            await this.notifyAdmin(bot, pending_package, smsg.message_id);
            return;
        }

        const banner_file_ids = pending_package.banner_file_ids ?? [];
        if (banner_file_ids.length === 0) {
            console.error("[packageHandler::sendBanner] no banner file ids");
            return;
        }

        const old_length = pending_package.banner_caption.length;
        const download_text = "\n\n⇨ 𝑫𝒐𝒘𝒏𝒍𝒐𝒂𝒅";
        const new_caption = pending_package.banner_caption + download_text;

        const new_entities = [...pending_package.banner_entities, {
            offset: old_length + 2,
            length: "⇨ 𝑫𝒐𝒘𝒏𝒍𝒐𝒂𝒅".length,
            type: "text_link" as const,
            url: deepLink
        }];

        let message_post_id: number;

        if (banner_file_ids.length > 1) {
            const mediaGroup = banner_file_ids.map((fileId, index) =>
                InputMediaBuilder.photo(fileId, {
                    ...(index === 0 && {
                        caption: new_caption,
                        caption_entities: new_entities
                    })
                })
            );

            const smsg = await bot.sendMediaGroup(
                configuration.posting_channel_id,
                mediaGroup
            );

            message_post_id = smsg[smsg.length - 1]!.message_id;
        } else {
            const smsg = await bot.sendPhoto(
                configuration.posting_channel_id,
                banner_file_ids[0]!,
                {
                    caption: new_caption,
                    caption_entities: new_entities,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "⇨ 𝑫𝒐𝒘𝒏𝒍𝒐𝒂𝒅",
                                    url: deepLink,
                                    style: "primary"
                                }
                            ]
                        ]
                    }
                }
            );

            message_post_id = smsg.message_id;
        }

        await this.changePackageStatus(pending_package.package_id, "done");
        await this.notifyAdmin(bot, pending_package, message_post_id);
    }

    private async notifyAdmin(bot: Api<RawApi>, pending_package: Package, message_id: number): Promise<void> {
        const text_to_send = `✅ | بنر با موفقیت داخل چنل گذاشته شد\n\n🔹 | <code>${pending_package.package_id}</code>`;
        await bot.sendMessage(
            pending_package.scheduled_by,
            text_to_send,
            { parse_mode: "HTML" }
        );
    }
}

export const packageHandler = new PackageHandler();