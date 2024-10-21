import { Observable } from "rxjs";
import {FileInterface} from "./file.interface";

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
}

export interface StorageEvents {
    'new_item': [string, FileInterface]
}

export interface StorageInterface {
    save(chunkData: Observable<SaveData>): Observable<boolean>

    exists(fileName: string): Observable<boolean>

    // Get file content chunks
    loadChunks(fileName: string, chunkSize: number): Observable<Uint8Array>

    // Get file data with metadata without content binary
    load(fileName: string): Observable<LoadData>

    delete(fileName: string): Observable<boolean>

    garbageCollection(): Promise<void>

    emit<K extends keyof StorageEvents>(event: K, ...args: StorageEvents[K] extends void ? [] : StorageEvents[K]): boolean

    on<K extends keyof StorageEvents>(event: K, listener: (...args: StorageEvents[K] extends void ? [] : StorageEvents[K]) => void): this

    once<K extends keyof StorageEvents>(event: K, listener: (...args: StorageEvents[K] extends void ? [] : StorageEvents[K]) => void): this
}