import { Controller } from '@nestjs/common';
import {GrpcMethod, GrpcStreamCall, GrpcStreamMethod} from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import { AppService } from './app.service';
import {
    FileChunk, GetRequest,
    GetResponse,
    UploadStatus
} from "../interfaces/fileserver.interface";

@Controller('')
export class AppController {
    constructor(private readonly appService: AppService) {}


    @GrpcMethod('FileServerService', 'GetFile')
    getFile(request: GetRequest): Observable<GetResponse> {
        return this.appService.getFile(request)
    }

    @GrpcStreamCall('FileServerService', 'Upload')
    lotsOfGreetings(requestStream: any, callback: (err: unknown, value: UploadStatus) => void) {

        const subject = new Subject<FileChunk>()
        this.appService.saveFile(subject.asObservable())
            .subscribe({
                next:( response)=>{
                    callback(null, {
                        success: response
                    })
                },
                error: (err) => {
                    callback(err, null)
                }
            })

        requestStream.on('data', (message: FileChunk) => {
            subject.next(message)
        });

        requestStream.on('end', () => callback(null, {
            success: true
        }));
    }

    // @GrpcStreamMethod('FileServerService', 'GetFile')
    // getFile(requestStream: any, callback: (err: unknown, value: GetResponse) => void)  {
    //
    //     requestStream.on('data', async(message: GetRequest) => {
    //         const stream = await this.appService.getFile(message);
    //         stream.subscribe({
    //             next: (response) => {
    //                 callback(null, response)
    //             },
    //             error: (err) => {
    //                 callback(err, null)
    //             }
    //         })
    //     })
    //
    // }

    // @GrpcStreamMethod('FileServerService', 'Upload')
    // upload(data: Observable<FileChunk>): Observable<UploadStatus> {
    //     const subject = new Subject<UploadStatus>();
    //     const onNext = async (request: FileChunk) => {
    //         try{
    //             subject.next({
    //                 success: this.appService.store(request),
    //                 file_name: request.file_name
    //             })
    //         }catch (err){
    //             subject.error(err)
    //         }
    //
    //     };
    //
    //     const onComplete = () => subject.complete();
    //     data.subscribe({
    //         next: onNext,
    //         complete: onComplete,
    //         error: subject.error,
    //     });
    //
    //     return subject.asObservable();
    // }

}
