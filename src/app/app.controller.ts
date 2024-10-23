import {Controller, Logger} from '@nestjs/common';
import {  GrpcStreamMethod} from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import { AppService } from './app.service';
import {
    GetRequest,
    GetResponse, UploadRequest, UploadResponse,
} from "../interfaces/fileserver.interface";

@Controller('')
export class AppController {

    private logs: Logger = new Logger(AppController.name)

    constructor(
        private readonly appService: AppService
    ) {}

    @GrpcStreamMethod('FileServerService', 'GetFile')
    GetFile(data: Observable<GetRequest>): Observable<GetResponse> {
        this.logs.log(`Connected with new client for get`)
        const subject = new Subject<GetResponse>()

        data.subscribe({
            next: (item) => {
                this.appService.getFile(item, subject)
            },
            complete: () => {
                subject.complete()
            },
        });

        return subject.asObservable();
    }

    @GrpcStreamMethod('FileServerService', 'Upload')
    upload(data: Observable<UploadRequest>): Observable<UploadResponse> {
        this.logs.log(`Connected with new client for upload`)
        const subject = new Subject<UploadResponse>()

        const onComplete = () => subject.complete();

        data.subscribe({
            next: (item) => {
                this.appService.upload(item, subject)
            },
            complete: onComplete,
        });

        return subject.asObservable();
    }
}