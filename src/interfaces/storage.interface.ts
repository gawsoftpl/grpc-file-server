import { Observable } from "rxjs";
import { FileChunk, GetRequest, GetResponse } from "./fileserver.interface";

export interface StorageInterface {
    save(payload: Observable<FileChunk>): Observable<boolean>
    exists(fileName: string): Promise<boolean>
    get(payload: GetRequest): Observable<GetResponse>
    garbageCollection(): Promise<void>
}