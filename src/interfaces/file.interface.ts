
export type FileInterface =  {
    save_date: number
    ttl: number
    //byteOffset: number
    lock: boolean
    metadata: string
    fileSize: number
}

export interface FileMemoryInterface extends FileInterface {
    data: Buffer
}

export interface FileStorageInterface extends FileInterface {
    filePaths: {
        metadata: string
        bin: string
    }
}

