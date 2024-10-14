import {ConfigService} from "@nestjs/config";
import {Subscriber} from "rxjs";
import {LoadData, StorageEvents} from "../interfaces/storage.interface";
import { EventEmitter } from 'events'

export abstract class StorageAbstract extends EventEmitter {

    private readChunkSize: number

    constructor(
        protected configService: ConfigService
    ) {
        super()
        this.readChunkSize = configService.get('storages.disk.read_chunk_size')
    }

    emit<K extends keyof StorageEvents>(event: K, ...args: StorageEvents[K] extends void ? [] : StorageEvents[K]): boolean {
        return super.emit(event, ...args);
    }

    on<K extends keyof StorageEvents>(event: K, listener: (...args: StorageEvents[K] extends void ? [] : StorageEvents[K]) => void): this {
        return super.on(event, listener);
    }

    once<K extends keyof StorageEvents>(event: K, listener: (...args: StorageEvents[K] extends void ? [] : StorageEvents[K]) => void): this {
        return super.once(event, listener);
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