
export type FileInterface =  {
    save_date: number
    ttl: number
    byteOffset: number
    lock: boolean
    metadata: string
}

export interface FileMemoryInterface extends FileInterface {
    data: Buffer
    usageCounter: number
}

export interface FileStorageInterface extends FileInterface {
    filePath: string
}

