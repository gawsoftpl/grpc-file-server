import {Inject, Injectable, Logger} from "@nestjs/common";
import {
    FileChunk,
    GetRequest,
    GetResponse, GetResponseFileInfo,
    RegisterUploadRequest, UploadRequest, UploadResponse,
} from "../interfaces/fileserver.interface";
import { SaveData, StorageInterface} from "../interfaces/storage.interface";
import {tap, Subject, mergeMap, first, concatMap, of, EMPTY,} from "rxjs";
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js'
import {ConfigService} from "@nestjs/config";
import {Counter, Gauge} from "prom-client";
import {InjectMetric} from "@willsoto/nestjs-prometheus";
import {FileMemoryInterface} from "../interfaces/file.interface";

interface UploadStreamDataType {
    payload: RegisterUploadRequest,
    subject: Subject<SaveData>
    saved_date: number
}

interface GetStreamType {
    saved_date: number
}

@Injectable()
export class AppService {

    private logs: Logger = new Logger(AppService.name)
    private uploadStreams: Map<string, UploadStreamDataType>
    private getStreams: Map<string, GetStreamType>
    private upload_register_max_time: number

    constructor(
        @Inject('MemoryStorage')
        private memoryStorage: StorageInterface,
        @Inject('DiskStorage')
        private diskStorage: StorageInterface,
        @InjectMetric('files_uploaded')
        protected files_uploaded: Counter<string>,
        @InjectMetric('files_downloaded')
        protected files_downloaded: Counter<string>,
        @InjectMetric('files_memory_downloaded')
        protected files_memory_downloaded: Counter<string>,
        @InjectMetric('files_downloaded_bytes')
        protected files_downloaded_bytes: Counter<string>,
        @InjectMetric('files_memory_downloaded_bytes')
        protected files_memory_downloaded_bytes: Counter<string>,
        @InjectMetric('files_uploaded_bytes')
        protected files_uploaded_bytes: Counter<string>,
        @InjectMetric('files_uploading')
        protected files_uploading: Gauge<string>,
        @InjectMetric('files_downloading')
        protected files_downloading: Gauge<string>,
        private configService: ConfigService
    ) {
        // Copy data from disk to memory
        this.uploadStreams = new Map()
        this.getStreams = new Map()
        this.upload_register_max_time = configService.get('garbageCollection.upload_register_max_time')

        const garbageCollectionInterval = configService.get('garbageCollection.interval') * 1000

        this.diskStorage.on('new_item', (key) => {
            this.logs.debug(`Received item to remove from memoryStorage ${key}`)
            this.memoryStorage.delete(key)
                .subscribe({
                    error: (err) => {
                        this.logs.error('Error with remove item from memory after add new item to disk')
                        this.logs.error(err)
                    }
                })
        })

        setInterval(() => {
            this.garbageCollection()
        }, garbageCollectionInterval)

        setInterval(() => {
            this.diskStorage.garbageCollection()
        }, garbageCollectionInterval)

        setInterval(() => {
            this.memoryStorage.garbageCollection()
        }, garbageCollectionInterval)

        setInterval(() => {
            this.files_uploading.set(this.uploadStreams.size)
            this.files_downloading.set(this.getStreams.size)
        }, 2_000)
    }

    protected garbageCollection()
    {
        const now = Date.now()
        this.uploadStreams.forEach((item, key) => {
            if ((item.saved_date + this.upload_register_max_time) > now) {
                item.subject.complete()
                this.uploadStreams.delete(key)
            }
        })

        this.getStreams.forEach((item, key) => {
            if ((item.saved_date + this.upload_register_max_time) > now) {
                this.getStreams.delete(key)
            }
        })
    }

    upload(payload: UploadRequest, response: Subject<UploadResponse>): void
    {
        if (payload?.register) {

            // Subject for send message to disk
            const subject = new Subject<SaveData>()

            // On response from disk
            this.diskStorage.save(subject)
                .subscribe({
                    next: (result) => {
                        response.next({
                            chunk: {
                                request_id: payload.register.request_id,
                                success: result
                            }
                        })
                    },
                    complete: () => {
                        response.next({
                            saved: {
                                request_id: payload.register.request_id,
                            }
                        })
                    },
                    error: (err) => {
                        this.logs.error(err);
                        response.error(new RpcException({
                            message: err.messgae,
                            code: status.INTERNAL
                        }))
                    }
                })

            this.uploadStreams.set(payload.register.request_id, {
                payload: payload.register,
                subject: subject,
                saved_date: Date.now()
            })
            response.next({
                register: {
                    request_id: payload.register.request_id,
                }
            })
        } else if(payload?.chunk) {

            const uploadStream = this.uploadStreams.get(payload.chunk.request_id)
            if (!uploadStream) {
                response.error(new RpcException({
                    message: "Cant find upload stream",
                    code: status.INTERNAL
                }))
                return;
            }

            this.files_uploaded_bytes.inc(payload.chunk.content.length)

            uploadStream.subject.next({
                content: payload.chunk.content,
                file_name: uploadStream.payload.file_name,
                ttl: uploadStream.payload.ttl,
                metadata: uploadStream.payload.metadata
            })

        }else if(payload?.complete){
            const uploadStream = this.uploadStreams.get(payload.complete.request_id)
            uploadStream.subject.complete()
            this.uploadStreams.delete(payload.complete.request_id)
            this.files_uploaded.inc()
        }else{
            response.error(new RpcException({
                message: "You have to send chunk or register payload",
                code: status.INVALID_ARGUMENT
            }))
        }
    }


    getFile(payload: GetRequest, response: Subject<GetResponse>): void
    {
        // Convert big int to string
        const chunkSize = parseInt(payload.chunk_size.toString())
        this.memoryStorage.exists(payload.file_name).pipe(
            mergeMap((memoryExists) => {
                if (memoryExists) {
                    this.logs.debug('Get file from memory')
                    this.files_memory_downloaded.inc()
                    return this.memoryStorage.load(payload.file_name, chunkSize)
                        .pipe(tap(item => this.files_memory_downloaded_bytes.inc(item.content.length)))
                }

                // Get data from hdd
                const dataFromStorage = this.diskStorage.load(payload.file_name, chunkSize);

                // Save hdd data in memory
                const streamToMemory = new Subject<SaveData>()
                this.memoryStorage.save(streamToMemory.asObservable())
                dataFromStorage
                    .pipe(
                        concatMap((val) => {
                            if (val.exists) {
                                return of(val)
                            }
                            return EMPTY
                        })
                    )
                    .subscribe({
                        next: (chunk) => streamToMemory.next({
                            file_name: payload.file_name,
                            metadata: chunk.metadata,
                            ttl: chunk.ttl,
                            content: chunk.content
                        }),
                        complete: () => streamToMemory.complete(),
                        error: (e) => streamToMemory.error(e)
                    })

                return dataFromStorage
            })
        ).subscribe({
            next: (data) => {

                // Send first chunk with file info
                const stream = this.getStreams.get(payload.request_id)
                if (!stream) {
                    this.getStreams.set(payload.request_id, {
                        saved_date: Date.now(),
                    })

                    response.next({
                        file: {
                            file_size: data.file_size,
                            metadata: data.metadata,
                            request_id: payload.request_id,
                            exists: data.exists
                        } as GetResponseFileInfo
                    })
                }

                // Stream file bytes
                if (data.content.length > 0) {
                    response.next({
                        chunk: {
                            content: data.content,
                            request_id: payload.request_id,
                        } as FileChunk
                    })
                    this.files_downloaded_bytes.inc(data.content.length)
                }

            },
            error: (err) => {
                response.next(err)
            },
            complete: () => {
                response.next({
                    completed: {
                        request_id: payload.request_id
                    }
                })
                this.getStreams.delete(payload.request_id)
                this.files_downloaded.inc()
            }
        })

    }

}