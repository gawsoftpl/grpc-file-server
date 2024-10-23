import {Injectable, Logger} from "@nestjs/common";
import { FileMemoryInterface} from "../interfaces/file.interface";
import {ConfigService} from "@nestjs/config";
import {Observable, Subject, timeout} from "rxjs";
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js';
import {LoadData, SaveData, StorageInterface} from "../interfaces/storage.interface";
import {FileLockedException} from "../exceptions/FileLockedException";
import {StorageAbstract} from "./storage.abstract";
import {InjectMetric} from "@willsoto/nestjs-prometheus";
import {Gauge} from "prom-client";
import {Cache} from "../helpers/cache";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


@Injectable()
export class MemoryStorage extends StorageAbstract implements StorageInterface {

    //private files: Map<string, FileMemoryInterface>
    private files: Cache<string, FileMemoryInterface>
    private logs: Logger = new Logger(MemoryStorage.name)
    private memory_size: number
    private defaultTtlSec: number
    private max_memory: number

    constructor(
        protected configService: ConfigService,
        @InjectMetric('memory_storage')
        protected memory_storage_metrics: Gauge<string>
    ) {
        super(configService)

        this.memory_size = 0;
        this.max_memory = configService.get('storages.memory.max_memory');
        this.defaultTtlSec = configService.get('storages.memory.ttl')

        this.files = new Cache({
            maxMemory: this.max_memory,
            maxTtl: configService.get('storages.disk.max_ttl'),
        })

        this.files.on('remove', (file, key) => {
            this.logs.debug(`Remove memory cache ${key}`)
            this.removeItem(key, file)
        })

        setInterval(() => {
            this.memory_storage_metrics.set(this.memory_size)
        }, 1000)
    }

    exists(fileName: string)
    {
        return new Observable<boolean>(subscriber =>  {
            subscriber.next(this.files.has(fileName))
            subscriber.complete()
        })
    }


    loadChunks(fileName: string, chunkSize: number): Observable<Uint8Array> {
        return new Observable(observer=> {

            (async() => {
                let file: FileMemoryInterface;
                try{
                    file = this.files.get(fileName);
                    if (!file || file.data.length == 0) {
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

                    const parsedChunkSize = this.getReadChunkSize(chunkSize)
                    const chunks = Math.ceil(file.data.length / parsedChunkSize)
                    for(let i= 0;i<chunks; i++) {
                        const chunkOffset = parsedChunkSize * i;
                        this.logs.debug(`Load from memory ${fileName} ${parsedChunkSize} bytes `)
                        observer.next(file.data.subarray(chunkOffset, (chunkOffset + parsedChunkSize)))
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

    load(fileName: string): Observable<LoadData>
    {
        return new Observable(observer=> {

            (async() => {
                let file: FileMemoryInterface;
                try{
                    file = this.files.get(fileName);
                    if (!file || file.data.length == 0) {
                        this.fileNoExistsResponse(observer)
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

                    observer.next({
                        exists: true,
                        file_size: file.data.length,
                        metadata: file.metadata,
                        ttl: file.ttl,
                    })

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
        let fileInfo: Omit<FileMemoryInterface, 'save_date' | 'data' | 'fileSize'> & {
            file_name: string
        };
        const buffers = []

        chunkData.subscribe({
            next: async(chunk) => {
                if (!chunk?.content)
                    throw new RpcException({message: 'No send content bytes', code: status.INVALID_ARGUMENT})

                const ttl = chunk?.ttl ? this.convertToInt(chunk.ttl) : this.defaultTtlSec

                if (!fileInfo) {
                    fileInfo = {
                        file_name: chunk.file_name,
                        lock: true,
                        metadata: chunk.metadata,
                        ttl: ttl,
                    }
                }
                buffers.push(chunk.content)
            },
            complete: () => {
                if (!fileInfo || buffers.length == 0) {
                    subject.next(false)
                    subject.complete()
                    return
                }

                const fullFile = Buffer.concat(buffers);
                this.files.set(fileInfo.file_name, {
                    data: fullFile,
                    ttl: fileInfo.ttl,
                    fileSize: fullFile.length,
                    save_date: new Date().getTime() / 1000,
                    lock: false,
                    metadata: fileInfo.metadata
                }, fileInfo.ttl)

                this.memory_size += fullFile.length

                subject.next(true)
                subject.complete()
            },
            error: (err) => {
                subject.error(err)
            }
        })

        return subject.asObservable()

    }

    delete(fileName: string): Observable<boolean>
    {
        return new Observable((subscriber) => {
            try{
                subscriber.next(this.files.delete(fileName))
                subscriber.complete()
            }catch(err){
                subscriber.error(err)
            }
        })
    }

    garbageCollection(): Promise<void> {
        return;
    }

    protected removeItem(key: string, fileInfo: FileMemoryInterface): void
    {
        this.memory_size -= fileInfo.fileSize
    }

    setMaxMemory(size: number)
    {
        this.max_memory = size
    }


}