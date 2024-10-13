import {Inject, Injectable, Logger, RequestTimeoutException} from "@nestjs/common";
import {
    FileChunk,
    GetRequest,
    GetResponse, GetResponseFileInfo,
    RegisterUploadRequest, UploadRequest, UploadResponse,
} from "../interfaces/fileserver.interface";
import { SaveData, StorageInterface} from "../interfaces/storage.interface";
import {tap, Subject, mergeMap, timer, takeUntil, throwError, catchError, switchMap} from "rxjs";
import { randomUUID } from 'crypto'
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js'
import {ConfigService} from "@nestjs/config";

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
    private sendToMemory: Subject<SaveData>
    private uploadStreams: Map<string, UploadStreamDataType>
    private getStreams: Map<string, GetStreamType>
    private upload_register_max_time: number

    constructor(
        @Inject('MemoryStorage')
        private memoryStorage: StorageInterface,
        @Inject('DiskStorage')
        private diskStorage: StorageInterface,
        private configService: ConfigService
    ) {
        // Copy data from disk to memory
        this.sendToMemory = new Subject()
        this.uploadStreams = new Map()
        this.getStreams = new Map()
        this.upload_register_max_time = configService.get('garbageCollection.upload_register_max_time')
        this.memoryStorage.save(this.sendToMemory.asObservable())

        setInterval(() => {
            this.garbageCollection()
        }, configService.get('garbageCollection.interval'))

        setInterval(() => {
            this.diskStorage.garbageCollection()
        }, configService.get('garbageCollection.interval'))

        setInterval(() => {
            this.memoryStorage.garbageCollection()
        }, configService.get('garbageCollection.interval'))
    }

    protected garbageCollection()
    {
        const now = Date.now()
        this.uploadStreams.forEach((item, key) => {
            if ((item.saved_date + this.upload_register_max_time) > now) {
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
            const id = randomUUID().toString()

            // Subject for send message to disk
            const subject = new Subject<SaveData>()

            // On response from disk
            this.diskStorage.save(subject)
                .subscribe({
                    next: (result) => {
                        response.next({
                            chunk: {
                                upload_id: id,
                                success: result
                            }
                        })
                    },
                    complete: () => {
                        response.next({
                            saved: {
                                upload_id: id
                            }
                        })
                    },
                    error: (err) => {
                        response.error(new RpcException({
                            message: err.messgae,
                            code: status.INTERNAL
                        }))
                    }
                })

            this.uploadStreams.set(id, {
                payload: payload.register,
                subject: subject,
                saved_date: Date.now()
            })
            response.next({
                register: {
                    upload_id: id,
                    request_id: payload.register.request_id
                }
            })
        } else if(payload?.chunk) {
            const uploadStream = this.uploadStreams.get(payload.chunk.upload_id)
            if (!uploadStream) {
                response.error(new RpcException({
                    message: "Cant find upload stream",
                    code: status.INTERNAL
                }))
                return;
            }

            uploadStream.subject.next({
                content: payload.chunk.content,
                file_name: uploadStream.payload.file_name,
                ttl: uploadStream.payload.ttl,
                metadata: uploadStream.payload.metadata
            })

            if (payload.chunk.last_chunk){
                uploadStream.subject.complete()
                this.uploadStreams.delete(payload.chunk.upload_id)
            }
        }else{
            response.error(new RpcException({
                message: "You have to send chunk or register payload",
                code: status.INVALID_ARGUMENT
            }))
        }

    }


    getFile(payload: GetRequest, response: Subject<GetResponse>): void
    {

        this.memoryStorage.exists(payload.file_name).pipe(
            mergeMap((memoryExists) => {
                if (memoryExists) {
                    this.logs.debug('Get file from memory')
                    return this.memoryStorage.load(payload.file_name, payload.chunk_size)
                }

                return this.diskStorage.load(payload.file_name, payload.chunk_size)
                    .pipe(
                        tap(value => {
                            if (value.exists && value.content){
                                this.sendToMemory.next({
                                    file_name: payload.file_name,
                                    content: value.content,
                                    ttl: value.ttl,
                                    metadata: ""
                                })
                            }
                        })
                    )

            }),
        ).subscribe({
            next: (data) => {
                const stream = this.getStreams.get(payload.request_id)
                if (!stream) {
                    this.getStreams.set(payload.request_id, {
                        saved_date: Date.now()
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

                response.next({
                    chunk: {
                        content: data.content,
                        request_id: payload.request_id,
                    } as FileChunk
                })

            },
            error: (err) => {
                response.next(err)
            },
            complete: () => {
                this.getStreams.delete(payload.request_id)
                response.next({
                    completed: {
                        request_id: payload.request_id
                    }
                })
            }
        })

    }

}