/* eslint-disable */
import { Metadata } from "@grpc/grpc-js";
import { GrpcMethod, GrpcStreamMethod } from "@nestjs/microservices";
import { Observable } from "rxjs";

export interface GetRequest {
  file_name: string;
  chunk_size: number;
}

export interface GetResponse {
  exists: boolean;
  chunk: FileChunk | undefined;
}

export interface FileChunk {
  content: Uint8Array;
  file_name: string;
  file_size: number;
  ttl: number;
  metadata: string;
  created_date: number;
}

export interface UploadStatus {
  success: boolean;
}

export interface FileServerServiceClient {
  GetFile(request: GetRequest, metadata?: Metadata): Observable<GetResponse>;

  Upload(request: Observable<FileChunk>, metadata?: Metadata): Observable<UploadStatus>;
}

export interface FileServerServiceController {
  GetFile(request: GetRequest, metadata?: Metadata): Observable<GetResponse>;

  Upload(request: Observable<FileChunk>, metadata?: Metadata): Observable<UploadStatus>;
}

export function FileServerServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = ["GetFile"];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcMethod("FileServerService", method)(constructor.prototype[method], method, descriptor);
    }
    const grpcStreamMethods: string[] = ["Upload"];
    for (const method of grpcStreamMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcStreamMethod("FileServerService", method)(constructor.prototype[method], method, descriptor);
    }
  };
}

export const FILE_SERVER_SERVICE_NAME = "FileServerService";
