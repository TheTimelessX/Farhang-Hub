import { MessageEntity } from "grammy/types";

export interface Package {
    type: "photo" | "video" | "document";
    package_id: string;
    file_ids: string[];
    file_ids_length: number;
    status: "done" | "pending";
    requested: number;
    scheduled_by: number;
    banner_caption: string;
    banner_entities: MessageEntity[];
    banner_file_id?: string;
    banner_type: "text" | "photo";
    banner_will_at: number;
}
