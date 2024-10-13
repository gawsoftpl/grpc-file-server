import {Inject, Injectable, Logger} from "@nestjs/common";
import {FileChunk, GetRequest, GetResponse, UploadStatus} from "../interfaces/fileserver.interface";
import {StorageInterface} from "../interfaces/storage.interface";
import {tap, Observable, Subject, Subscription, switchMap, of} from "rxjs";

@Injectable()
export class AppService {

    private logs: Logger = new Logger(AppService.name)
    private sendToMemory: Subject<FileChunk>

    constructor(
        @Inject('MemoryStorage')
        private memoryStorage: StorageInterface,
        @Inject('DiskStorage')
        private diskStorage: StorageInterface
    ) {
        // Copy data from disk to memory
        this.sendToMemory = new Subject()
        this.memoryStorage.save(this.sendToMemory.asObservable())
    }

    saveFile(payload: Observable<FileChunk>)
    {
        return this.diskStorage.save(payload)
    }

    getFile(payload: GetRequest): Observable<GetResponse>
    {
        return this.memoryStorage.exists(payload.file_name).pipe(
            switchMap((memoryExists) => {

                if (memoryExists) {
                    this.logs.debug('Get file from memory')
                    return this.memoryStorage.get(payload)
                }
                return this.diskStorage.get(payload)
                    .pipe(
                        tap(value => {

                            if (value.exists && value.chunk){
                                this.sendToMemory.next(value.chunk)
                            }
                        })
                    )
            })
        )

    }

}