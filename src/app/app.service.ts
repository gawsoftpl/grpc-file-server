import {Injectable, Logger} from "@nestjs/common";
import {FileChunk, GetRequest, GetResponse, UploadStatus} from "../interfaces/fileserver.interface";
import {StorageInterface} from "../interfaces/storage.interface";
import {tap, Observable, Subject, Subscription, switchMap} from "rxjs";

@Injectable()
export class AppService {

    private logs: Logger = new Logger(AppService.name)
    private sendToMemory: Subject<FileChunk>

    constructor(
        private memoryStorage: StorageInterface,
        private diskStorage: StorageInterface
    ) {
        // Copy data from disk to memory
        this.sendToMemory = new Subject()
        this.memoryStorage.save(this.sendToMemory.asObservable())
    }

    saveFile(payload: Observable<FileChunk>): Observable<UploadStatus>
    {
        const subject = new Subject<UploadStatus>()
        this.diskStorage.save(payload).subscribe({
            next: (saved) => {
                subject.next({
                    success: saved,
                })
            },
            error: (err) => {
                subject.error(err);
            },
            complete: () => {
                subject.complete()
            }
        })

        return subject.asObservable()
    }

    async getFile(payload: GetRequest): Promise<Observable<GetResponse>>
    {
        if (await this.memoryStorage.exists(payload.file_name)){
            return this.memoryStorage.get(payload)
        }

        // Read data from disk
        this.diskStorage.get(payload)
             .pipe(
                 tap(value => {
                     if (value.exists && value.chunk){
                         this.sendToMemory.next(value.chunk)
                     }
                 })
             )
    }

}