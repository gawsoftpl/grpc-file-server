import { Observable } from "rxjs";

export interface SaveData {
    file_name: string;
    ttl: number;
    metadata: string;
    content: Uint8Array
}

export interface LoadData {
    exists: boolean;
    file_size: number;
    metadata: string;
    ttl: number
    content: Uint8Array
}

export interface StorageInterface {
    save(chunkData: Observable<SaveData>): Observable<boolean>

    exists(fileName: string): Observable<boolean>

    load(fileName: string, chunkSize: number): Observable<LoadData>

    garbageCollection(): Promise<void>
}