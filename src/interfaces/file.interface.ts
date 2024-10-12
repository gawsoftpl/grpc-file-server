export type FileInterface =  {
    save_date: number
    ttl: number
    usageCounter: number
    byteOffset: number
    lock: boolean
    metadata: string
}

export interface FileMemoryInterface extends FileInterface {
    data: Uint8Array
}

export interface FileStorageInterface extends FileInterface {
    filePath: string
}

