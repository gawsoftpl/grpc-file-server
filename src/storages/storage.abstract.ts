import {ConfigService} from "@nestjs/config";
import {Subscriber} from "rxjs";
import {LoadData} from "../interfaces/storage.interface";

export abstract class StorageAbstract {

    private readChunkSize: number

    constructor(
        protected configService: ConfigService
    ) {
        this.readChunkSize = configService.get('storages.disk.read_chunk_size')
    }

    /**
     * Send to subscribe file not exists
     *
     * @param subscriber
     * @protected
     */
    protected fileNoExistsResponse(subscriber: Subscriber<LoadData>) {
        subscriber.next({
            exists: false,
            content: new Uint8Array(),
            file_size: 0,
            metadata: "",
            ttl: 0,
        })
        subscriber.complete()
    }

    protected getReadChunkSize(chunkSize?: number ): number
    {
        const convertedValue = this.convertToInt(chunkSize)
        if (convertedValue > 16)
            return convertedValue;

        return this.readChunkSize;
    }

    protected convertToInt(value: any): number
    {
        const valueInt = parseInt(value)
        if (isNaN(value)) return 0
        return valueInt
    }
}