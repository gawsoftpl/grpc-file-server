import {Injectable, Logger} from "@nestjs/common";
import {FileInterface, FileMemoryInterface} from "../interfaces/file.interface";
import {ConfigService} from "@nestjs/config";
import { FileChunk, GetRequest, GetResponse} from "../interfaces/fileserver.interface";
import {Observable, Subject} from "rxjs";
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js';
import {StorageInterface} from "../interfaces/storage.interface";
import {emptyChunk} from "../helpers/emptyChunk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class CantFindElementException extends Error {}

@Injectable()
export class MemoryStorage implements StorageInterface {

    private files: Map<string, FileMemoryInterface>
    private logs: Logger = new Logger(MemoryStorage.name)
    private memory_size: number
    private max_memory: number

    constructor(
        private configService: ConfigService
    ) {
        this.files = new Map()
        this.memory_size = 0;
        this.max_memory = configService.get('storages.memory.max_memory');
    }

    async exists(fileName: string): Promise<boolean>
    {
        return this.files.has(fileName)
    }

    get(payload: GetRequest): Observable<GetResponse>
    {


        return new Observable(observer=> {
            (async() => {
                let file: FileMemoryInterface;
                try{
                    file = this.files.get(payload.file_name);

                    if (!file) {
                        throw new CantFindElementException();
                    }

                    const timeout = setTimeout(() => {
                        this.logs.error('Timeout for file lock')
                        throw new CantFindElementException();
                    }, 5000);

                    while(file.lock) {
                        await sleep(50)
                    }

                    if (timeout)
                        clearTimeout(timeout)

                    file.lock = true;
                    file.usageCounter++;
                    const chunks = Math.ceil(file.data.byteLength / payload.chunk_size)
                    for(let i= 0;i<chunks; i++) {
                        const chunkOffset = payload.chunk_size * i;

                        const baseChunk = i == 0 ? {
                            ttl: file.ttl,
                            file_name: payload.file_name,
                            file_size: file.data.byteLength,
                            metadata: file.metadata,
                            created_date: file.save_date,
                        } : emptyChunk(payload.file_name)

                        observer.next({
                            exists: true,
                            chunk: {
                                ...baseChunk,
                                content: file.data.slice(chunkOffset, (chunkOffset + payload.chunk_size))
                            }
                        })
                    }

                    observer.complete()
                } catch(err) {
                    if (err instanceof CantFindElementException) {
                        observer.next({
                            exists: false,
                            chunk: emptyChunk(payload.file_name)
                        })
                        observer.complete()
                        return
                    }
                    observer.error(err)
                } finally {
                    if(file)
                        file.lock = false;
                }
            })();

        })
    }

    save(payload: Observable<FileChunk>): Observable<boolean>
    {
        const subject = new Subject<boolean>()
        const savedChunks: Array<boolean> = [];

        payload.subscribe({
            next: (chunk) => {
                savedChunks.push(this.saveInMemory(chunk));
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

    saveInMemory(payload: FileChunk): boolean
    {
        let file: FileMemoryInterface;

        if (!payload?.file_name)
            throw new RpcException({message: 'No send file_name', code: status.INVALID_ARGUMENT})

        try {
            const fileSize = Number(payload.file_size)

            if (fileSize + this.memory_size > this.max_memory) {
                this.releaseMemory(payload.file_name, payload.file_size)
            }

            if (!this.files.has(payload.file_name)) {
                this.files.set(payload.file_name, {
                    data: new Uint8Array(fileSize),
                    ttl: payload.ttl,
                    save_date: new Date().getTime(),
                    usageCounter: 0,
                    byteOffset: 0,
                    lock: false,
                    metadata: payload.metadata
                })
            }

            if (!payload?.content)
                throw new RpcException({message: 'No send content bytes', code: status.INVALID_ARGUMENT})

            file = this.files.get(payload.file_name)

            if (file.byteOffset >= file.data.byteLength) {
                this.logs.error(`You cant send file bigger that declared file size: ${file.data.byteLength}`)
                return false;
            }

            file.lock = true;
            file.data.set(payload.content, file.byteOffset)
            this.memory_size += payload.content.byteLength
            file.byteOffset += payload.content.byteLength

            return true;
        }catch (err){
            this.logs.error(err)
            throw new RpcException({message: err.message, code: status.INTERNAL})
        } finally {
            if(file)
                file.lock = false;
        }

        return false;
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
        this.logs.debug("Garbage collection")

        const actualDate = new Date().getTime()
        this.files.forEach((item, key) => {
            if (item.save_date + item.ttl < actualDate) {
                this.removeItem(key)
            }
        })
    }

    protected removeItem(key: string): number
    {
        const item = this.files.get(key)
        item.lock = true;
        const releasedMemory = item.data.byteLength
        this.memory_size -= releasedMemory
        this.files.delete(key)
        this.logs.debug(`Released item ${key}`)
        return releasedMemory
    }

}