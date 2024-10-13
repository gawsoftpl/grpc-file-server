import {Injectable, Logger} from "@nestjs/common";
import { FileMemoryInterface} from "../interfaces/file.interface";
import {ConfigService} from "@nestjs/config";
import {Observable, Subject} from "rxjs";
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js';
import {LoadData, SaveData, StorageInterface} from "../interfaces/storage.interface";
import {FileLockedException} from "../exceptions/FileLockedException";
import {StorageAbstract} from "./storage.abstract";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


@Injectable()
export class MemoryStorage extends StorageAbstract implements StorageInterface {

    private files: Map<string, FileMemoryInterface>
    private logs: Logger = new Logger(MemoryStorage.name)
    private memory_size: number
    private max_memory: number

    constructor(
        protected configService: ConfigService
    ) {
        super(configService)
        this.files = new Map()
        this.memory_size = 0;
        this.max_memory = configService.get('storages.memory.max_memory');
    }

    exists(fileName: string)
    {
        return new Observable<boolean>(subscriber =>  {
            subscriber.next(this.files.has(fileName))
            subscriber.complete()
        })
    }

    load(fileName: string, chunkSize: number): Observable<LoadData>
    {
        return new Observable(observer=> {
            (async() => {
                let file: FileMemoryInterface;
                try{
                    file = this.files.get(fileName);

                    if (!file || file.data.length == 0) {
                        observer.next({
                            content: new Uint8Array(),
                            exists: false,
                            metadata: "",
                            file_size: 0,
                            ttl: 0
                        })
                        observer.complete()
                        return;
                    }

                    const timeout = setTimeout(() => {
                        this.logs.error('Timeout for file lock')
                        throw new FileLockedException();
                    }, 5000);

                    while(file.lock) {
                        await sleep(50)
                    }

                    if (timeout)
                        clearTimeout(timeout)

                    file.lock = true;
                    file.usageCounter++;

                    const parsedChunkSize = this.getReadChunkSize(chunkSize)

                    const chunks = Math.ceil(file.data.length / parsedChunkSize)
                    for(let i= 0;i<chunks; i++) {
                        const chunkOffset = parsedChunkSize * i;
                        observer.next({
                            exists: true,
                            file_size: file.data.length,
                            metadata: file.metadata,
                            ttl: file.ttl,
                            content: file.data.subarray(chunkOffset, (chunkOffset + parsedChunkSize))
                        })
                    }

                    observer.complete()

                } catch(err) {
                    observer.error(new RpcException({
                        message: err.message,
                        code: status.INTERNAL
                    }))
                } finally {
                    if(file)
                        file.lock = false;
                }
            })();

        })
    }

    save(chunkData: Observable<SaveData>): Observable<boolean>
    {
        const subject = new Subject<boolean>()
        const savedChunks: Array<boolean> = [];

        chunkData.subscribe({
            next: async(chunk) => {
                savedChunks.push(await this.saveInMemory(chunk));
            },
            complete: () => {
                subject.next(savedChunks.every(item => item))
                subject.complete()
            },
            error: (err) => {
                subject.error(err)
            }
        })

        return subject.asObservable()

    }

    protected async saveInMemory(payload: SaveData): Promise<boolean>
    {
        return new Promise((resolve, reject) => {
            let file: FileMemoryInterface;

            if (!payload?.file_name)
                throw new RpcException({message: 'No send file_name', code: status.INVALID_ARGUMENT})

            try {
                const fileSize = Number(payload.content.byteLength)

                if (fileSize + this.memory_size > this.max_memory) {
                    this.releaseMemory(payload.file_name, payload.content.byteLength)
                }

                if (!this.files.has(payload.file_name)) {
                    this.files.set(payload.file_name, {
                        data: Buffer.alloc(0),
                        ttl: payload.ttl,
                        save_date: new Date().getTime() / 1000,
                        usageCounter: 0,
                        byteOffset: 0,
                        lock: false,
                        metadata: payload.metadata
                    })
                }

                if (!payload?.content)
                    throw new RpcException({message: 'No send content bytes', code: status.INVALID_ARGUMENT})

                file = this.files.get(payload.file_name)
                file.lock = true;
                file.data = Buffer.concat([file.data, payload.content])
                this.memory_size += file.data.length

                resolve(true)

            }catch (err){
                this.logs.error(err)
                reject(err)
            } finally {
                if(file)
                    file.lock = false;
            }
        });

    }

    protected releaseMemory(addingKey: string, bytesRequired: number) {
        this.logs.debug('Try to release memory for new element')
        const entries = this.files.entries();
        let releasedMemory = 0;

        while(releasedMemory < bytesRequired) {
            const result = entries.next().value
            if (!result || result?.done) return;

            if (result[0] != addingKey) {
                this.logs.debug(`Release ${result[0]}`)
                releasedMemory += this.removeItem(result[0])
            }
        }
    }

    async garbageCollection(): Promise<void>{
        this.logs.log('Start disk garbage collection')
        const now = new Date().getTime() / 1000
        let candidatesForRemoval = [];

        this.files.forEach((item, key) => {
            // Step 1: Remove expired items
            if ((item.ttl + item.save_date) < now) {
                this.memory_size -= item.data.length
                this.files.delete(key);
            } else {
                candidatesForRemoval.push({ key, fileSize: item.data.length, ttl: item.ttl, usageCounter: item.usageCounter });
            }
        });

        // If buffer use min 60%
        if (this.memory_size < (this.max_memory * 0.6))
            return

        candidatesForRemoval.sort((a, b) => {
            if (a.usageCounter === b.usageCounter) {
                return a.ttl - b.ttl; // If usage is the same, remove the one closest to expiration
            }
            return a.usageCounter - b.usageCounter; // Least used items should be removed first
        });

        // Let's assume we remove half of the least used or near-expiry items
        const itemsToRemove = Math.ceil(candidatesForRemoval.length / 2);

        for (let i = 0; i < itemsToRemove; i++) {
            this.memory_size -= candidatesForRemoval[i].fileSize
            this.files.delete(candidatesForRemoval[i].key);
        }

    }

    protected removeItem(key: string): number
    {
        const item = this.files.get(key)
        item.lock = true;
        const releasedMemory = item.data.length
        this.memory_size -= releasedMemory
        this.files.delete(key)
        this.logs.debug(`Released item ${key}`)
        return releasedMemory
    }

    setMaxMemory(size: number)
    {
        this.max_memory = size
    }
}