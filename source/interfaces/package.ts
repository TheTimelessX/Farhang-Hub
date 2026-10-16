import { MessageEntity } from "grammy/types";

export interface Package {
    package_id: string;
    status: "pending" | "done";
    requested: number;
    type: "photo" | "video" | "document";
    file_ids: string[];
    file_ids_length: number;
    banner_type: "photo" | "text";
    banner_caption: string;
    banner_entities: MessageEntity[];
    banner_file_ids?: string[];
    banner_will_at: number;
    banner_delete_at: number;
    scheduled_by: number;
}