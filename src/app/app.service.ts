import {Inject, Injectable, Logger} from "@nestjs/common";
import {
    FileChunk,
    GetRequest, GetRequestData, GetRequestStartSendChunks,
    GetResponse,
    RegisterUploadRequest, UploadRequest, UploadResponse,
} from "../interfaces/fileserver.interface";
import {LoadData, SaveData, StorageInterface} from "../interfaces/storage.interface";
import {
    tap,
    Subject,
    mergeMap,
    concatMap,
    of,
    finalize,
    catchError,
    throwError,
    takeUntil,
    timer, switchMap,
} from "rxjs";
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js'
import {ConfigService} from "@nestjs/config";
import {Counter, Gauge} from "prom-client";
import {InjectMetric} from "@willsoto/nestjs-prometheus";
import {TimeoutException} from "../exceptions/TimeoutException";
import {Config} from "../config/config";

interface UploadStreamDataType {
    payload: RegisterUploadRequest,
    subject: Subject<SaveData>
    saved_date: number
}

interface GetStreamType {
    saved_date: number
    file_name: string
    file_data: LoadData
}

@Injectable()
export class AppService {

    private logs: Logger = new Logger(AppService.name)
    private uploadStreams: Map<string, UploadStreamDataType>
    private getStreams: Map<string, GetStreamType>
    private upload_register_max_time: number
    private download_register_max_time: number
    private configTimeouts: typeof Config.timeouts;

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
        this.configTimeouts = configService.get('timeouts')
        this.uploadStreams = new Map()
        this.getStreams = new Map()
        this.upload_register_max_time = configService.get('garbageCollection.upload_register_max_time') * 1000
        this.download_register_max_time = configService.get('garbageCollection.download_register_max_time') * 1000

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
            if ((item.saved_date + this.download_register_max_time) > now) {
                this.getStreams.delete(key)
            }
        })
    }

    upload(payload: UploadRequest, response: Subject<UploadResponse>): void
    {
        if (payload?.register) {
            this.logs.debug(`New upload request ${payload.register.request_id}`)
            // Subject for send message to disk
            const subject = new Subject<SaveData>()

            // On response from disk
            this.diskStorage.save(subject.pipe(
                takeUntil(timer(this.configTimeouts.upload)
                    .pipe(
                        switchMap((x) => throwError(() => {
                            this.uploadStreams.delete(payload.register.request_id)
                            subject.unsubscribe()
                            return new TimeoutException(`Timeout for upload file request id: ${payload.register.request_id} max ${this.configTimeouts.upload}ms`)
                        }))
                    )
                ),
                catchError(err => {
                    response.next({
                        error: {
                            request_id: payload.register.request_id,
                            message: err?.message ?? "Unknown error",
                            code: status.ABORTED
                        }
                    })
                    return throwError(err);
                }),
            ))
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
                        response.next({
                            error: {
                                request_id: payload.register.request_id,
                                message: err?.message ?? "Unknown error",
                                code: status.INTERNAL
                            }
                        })
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
                response.next({
                    error: {
                        request_id: payload.chunk.request_id,
                        message: "Cant find upload stream. Please first send register request and after register send chunks",
                        code: status.INTERNAL
                    }
                })
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
            if (!uploadStream){
                response.next({
                    error: {
                        request_id: payload.complete.request_id,
                        message: "Cant find upload stream. Please first send register request and after register send chunks and complete when finished",
                        code: status.INTERNAL
                    }
                })
                return;
            }
            uploadStream.subject.complete()
            this.uploadStreams.delete(payload.complete.request_id)
            this.files_uploaded.inc()
        }else{
            response.next({
                error: {
                    request_id: "",
                    message: "You have to send chunk or register payload",
                    code: status.INVALID_ARGUMENT
                }
            })
        }
    }

    getFile(payload: GetRequest, response: Subject<GetResponse>): void
    {
        if (payload?.file){
            this.getFileData(payload.file, response)
        }else if (payload?.chunk){
            this.emitFileChunks(payload.chunk, response)
        }else{
            throw new RpcException({
                message: "Wrong message for getRequest",
                code: status.INVALID_ARGUMENT
            })
        }
    }

    getFileData(payload: GetRequestData, response: Subject<GetResponse>): void
    {
        this.logs.debug(`New get file data request ${payload.request_id}`)
        const timeoutOperator = () => timer(this.configTimeouts.download)
            .pipe(
                switchMap(() => throwError(() => {
                    this.getStreams.delete(payload.request_id)
                    return new TimeoutException(`Timeout for download file data request_id: ${payload.request_id}, ${payload.file_name}  max ${this.configTimeouts.download}ms`)
                }))
            )

        // Convert big int to string
        this.memoryStorage.exists(payload.file_name).pipe(
            takeUntil(timeoutOperator()),
            mergeMap((memoryExists) => {
                if (memoryExists) {
                    this.logs.debug('Get file data from memory')
                    return this.memoryStorage.load(payload.file_name)
                }
                // Get data from hdd
                return this.diskStorage.load(payload.file_name);
            }),
            catchError(err => {
                this.logs.error(err);
                response.next({
                    error: {
                        request_id: payload.request_id,
                        message: err?.message ?? "Unknown error",
                        code: status.ABORTED
                    }
                })
                return throwError(err);
            }),
        ).subscribe({
            next: (data) => {

                if (data.exists){
                    this.getStreams.set(payload.request_id, {
                        saved_date: Date.now(),
                        file_data: data,
                        file_name: payload.file_name,
                    })
                }

                response.next({
                    file: {
                        file_size: data.file_size,
                        metadata: data.metadata,
                        request_id: payload.request_id,
                        exists: data.exists
                    }
                })

            },
            complete: () => {
                response.next({
                    completed_data: {
                        request_id: payload.request_id
                    }
                })
            },
            error: (err) => {
                response.next(err)
            },
        })
    }

    emitFileChunks(payload: GetRequestStartSendChunks, response: Subject<GetResponse>) {
        this.logs.debug(`New download chunks request ${payload.request_id}`)
        const stream = this.getStreams.get(payload.request_id)
        if (!stream) {
            response.next({
                error: {
                    request_id: payload.request_id,
                    message: `Cant find get stream ${payload.request_id}. Please first send message GetRequestData and after GetRequestStartSendChunks`,
                    code: status.ABORTED
                }
            })
            return;
        }

        const timeoutOperator = () => timer(this.configTimeouts.download)
            .pipe(
                switchMap(() => throwError(() => {
                    this.getStreams.delete(payload.request_id)
                    return new TimeoutException(`Timeout for download file chunks request_id: ${payload.request_id}, max ${this.configTimeouts.download}ms`)
                }))
            )


        // Convert big int to string
        const chunkSize = parseInt(payload.chunk_size.toString())
        this.memoryStorage.exists(stream.file_name).pipe(
            takeUntil(timeoutOperator()),
            mergeMap((memoryExists) => {
                if (memoryExists) {
                    this.logs.debug('Get file from memory')
                    this.files_memory_downloaded.inc()
                    return this.memoryStorage.loadChunks(stream.file_name, chunkSize)
                        .pipe(tap(item => this.files_memory_downloaded_bytes.inc(item.length)))
                }
                // Get data from hdd
                const dataFromStorage = this.diskStorage.loadChunks(stream.file_name, chunkSize);

                // Save hdd data in memory
                const streamToMemory = new Subject<SaveData>()
                this.memoryStorage.save(streamToMemory.asObservable())

                let firstChunk = true
                // Copy data from hdd to memory with pipe
                return dataFromStorage
                    .pipe(
                        takeUntil(timeoutOperator()),
                        concatMap((chunkData) => {
                            if (firstChunk) {
                                streamToMemory.next({
                                    file_name: stream.file_name,
                                    metadata: stream.file_data.metadata,
                                    ttl: stream.file_data.ttl,
                                    content: chunkData
                                })
                                firstChunk = false
                            }
                            return of(chunkData)
                        }),
                        finalize(() => {
                            streamToMemory.complete()
                        })
                    )
            }),
            catchError(err => {
                this.logs.error(err);
                response.next({
                    error: {
                        request_id: payload.request_id,
                        message: err?.message ?? "Unknown error",
                        code: status.ABORTED
                    }
                })
                return throwError(err);
            }),
        ).subscribe({
            next: (data) => {

                // Stream file bytes
                if (data.length > 0) {
                    response.next({
                        chunk: {
                            content: data,
                            request_id: payload.request_id,
                        } as FileChunk
                    })
                    this.files_downloaded_bytes.inc(data.length)
                }

            },
            error: (err) => {
                response.next(err)
            },
            complete: () => {
                response.next({
                    completed_chunks: {
                        request_id: payload.request_id
                    }
                })
                this.getStreams.delete(payload.request_id)
                this.files_downloaded.inc()
            }
        })
    }

}