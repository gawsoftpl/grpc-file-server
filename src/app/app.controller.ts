import { Controller } from '@nestjs/common';
import { GrpcStreamMethod } from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import { AppService } from './app.service';
import {
    ExistsRequest,
    ExistsResponse,
    FileChunk,
    GetRequest,
    GetResponse,
    UploadStatus
} from "../interfaces/fileserver.interface";

@Controller('')
export class AppController {
    constructor(private readonly appService: AppService) {}

    @GrpcStreamMethod('FileServerService', 'Exists')
    Exists(
        data: Observable<ExistsRequest>,
    ): Observable<ExistsResponse> {
        const subject = new Subject<ExistsResponse>();

        const onNext = (request: ExistsRequest) => {
            subject.next(this.appService.exists(request));
        };

        const onComplete = () => subject.complete();

        data.subscribe({
            next: onNext,
            complete: onComplete,
            error: subject.error,
        });

        return subject.asObservable();
    }

    @GrpcStreamMethod('FileServerService', 'GetFile')
    GetFile(
        data: Observable<GetRequest>,
    ): Observable<GetResponse> {
        const subject = new Subject<GetResponse>();

        const onNext = async (request: GetRequest) => {
            try{
                this.appService.get(request).subscribe({
                    next: (data) => {
                        subject.next(data)
                    },
                    error: (err) => {
                        subject.error(err)
                    },
                })
            }catch(err){
                subject.error(err);
            }

        }

        const onComplete = () => subject.complete();
        data.subscribe({
            next: onNext,
            complete: onComplete,
            error: subject.error,
        });

        return subject.asObservable();
    }

    @GrpcStreamMethod('FileServerService', 'Upload')
    upload(data: Observable<FileChunk>): Observable<UploadStatus> {
        const subject = new Subject<UploadStatus>();
        const onNext = async (request: FileChunk) => {
            try{
                subject.next({
                    success: this.appService.store(request),
                    file_name: request.file_name
                })
            }catch (err){
                subject.error(err)
            }

        };

        const onComplete = () => subject.complete();
        data.subscribe({
            next: onNext,
            complete: onComplete,
            error: subject.error,
        });

        return subject.asObservable();
    }

}
