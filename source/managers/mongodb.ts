import { MongoClient, Collection, Document } from "mongodb";

class MongoManager {
    private driver: MongoClient = new MongoClient("mongodb://localhost:27017");
    private hasConnected: boolean = false;

    constructor(){
        this.connect();
    }

    async connect(){
        if (!this.hasConnected){
            await this.driver.connect();
            this.hasConnected = true;
        }
    }

    show(dbs: string, collection: string): Collection<Document> {
        if (!this.hasConnected){
            throw new Error("[MongoManager] database not connected please call `connect` first");
        } else {
            return this.driver.db(dbs).collection(collection);
        }
    }

    async close(): Promise<boolean> {
        if (!this.hasConnected){
            return false;
        } else {
            await this.driver.close();
            return true;
        }
    }
}

export const mongoManager = new MongoManager();
