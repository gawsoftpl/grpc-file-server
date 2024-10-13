/* eslint-disable */
import { Metadata } from "@grpc/grpc-js";
import { GrpcMethod, GrpcStreamMethod } from "@nestjs/microservices";
import { Observable } from "rxjs";

export interface UploadRequest {
  register?: RegisterUploadRequest | undefined;
  chunk?: FileChunkRequest | undefined;
}

export interface RegisterUploadRequest {
  request_id: string;
  file_name: string;
  file_size: number;
  ttl: number;
  metadata: string;
}

export interface FileChunkRequest {
  request_id: string;
  content: Uint8Array;
  last_chunk: boolean;
}

export interface UploadResponse {
  register?: RegisterUploadResponse | undefined;
  chunk?: FileChunkResponse | undefined;
  saved?: FileSaved | undefined;
}

export interface RegisterUploadResponse {
  request_id: string;
}

export interface FileChunkResponse {
  request_id: string;
  success: boolean;
}

export interface FileSaved {
  request_id: string;
}

export interface GetRequest {
  file_name: string;
  request_id: string;
  chunk_size: number;
}

export interface GetResponse {
  file?: GetResponseFileInfo | undefined;
  chunk?: FileChunk | undefined;
  completed?: FileReadCompleted | undefined;
}

export interface GetResponseFileInfo {
  request_id: string;
  exists: boolean;
  metadata: string;
  file_size: number;
}

export interface FileChunk {
  content: Uint8Array;
  request_id: string;
}

export interface FileReadCompleted {
  request_id: string;
}

export interface FileServerServiceClient {
  GetFile(request: Observable<GetRequest>, metadata?: Metadata): Observable<GetResponse>;

  Upload(request: Observable<UploadRequest>, metadata?: Metadata): Observable<UploadResponse>;
}

export interface FileServerServiceController {
  GetFile(request: Observable<GetRequest>, metadata?: Metadata): Observable<GetResponse>;

  Upload(request: Observable<UploadRequest>, metadata?: Metadata): Observable<UploadResponse>;
}

export function FileServerServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = [];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcMethod("FileServerService", method)(constructor.prototype[method], method, descriptor);
    }
    const grpcStreamMethods: string[] = ["GetFile", "Upload"];
    for (const method of grpcStreamMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcStreamMethod("FileServerService", method)(constructor.prototype[method], method, descriptor);
    }
  };
}

export const FILE_SERVER_SERVICE_NAME = "FileServerService";
