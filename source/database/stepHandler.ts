class StepHandler {
    private steps = new Map<number, { step: string, timestamp: number, [k: string]: any }>();

    constructor() {
        // setInterval(async () => {
        //     for (const step of this.steps){
        //         if ((step[1].timestamp + 420000) <= Date.now()){
        //             await this.delete(step[0]);
        //         }
        //     }
        // }, 10000);
    }

    async add(k: number, record: { step: string, timestamp: number, [k: string]: any }): Promise<void> {
        this.steps.set(k, record);
    }

    async has(k: number): Promise<{ step: string, timestamp: number, [k: string]: any } | null> {
        if (this.steps.has(k)) return this.steps.get(k)!;
        else return null;
    }

    async delete(k: number): Promise<void> {
        if (this.steps.has(k)) this.steps.delete(k);
    }
}

export const stepHandler = new StepHandler();
