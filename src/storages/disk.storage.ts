import {Injectable, Logger, OnModuleInit} from "@nestjs/common";
import {StorageInterface} from "../interfaces/storage.interface";
import {FileChunk, GetRequest, GetResponse} from "../interfaces/fileserver.interface";
import {Observable, Subject} from "rxjs";
import {ConfigService} from "@nestjs/config";
import * as Fs from 'fs/promises'
import { existsSync, ReadStream, mkdirSync, Stats, createWriteStream, WriteStream, createReadStream } from 'fs'
import * as path from 'path'
import {emptyChunk} from "../helpers/emptyChunk";
import {RpcException} from "@nestjs/microservices";
import { status } from '@grpc/grpc-js'

interface DiskStorageMetadata {
    metadata: string
    ttl: number
}

@Injectable()
export class DiskStorage implements StorageInterface, OnModuleInit {

    private maxMemory: number;
    private defaultTtl: number;
    private readChunkSize: number
    private dirPath: string
    private logs: Logger = new Logger(DiskStorage.name)

    constructor(
        private configService: ConfigService
    ) {
        this.readChunkSize = configService.get('storages.disk.read_chunk_size')
        this.defaultTtl = configService.get('storages.disk.ttl')
        this.dirPath = configService.get('storages.disk.path')
        this.maxMemory = configService.get('storages.disk.max_memory')
    }

    async onModuleInit() {
        await this.createDir()
    }

    exists(fileName: string) {
        return new Observable<boolean>(subscriber => {
            try{
                (async() => {
                    const fileDir = await this.fileDir(fileName)
                    const filePath = this.filePath(fileDir, fileName)
                    const exists = await this.fileExists(filePath)
                    subscriber.next(exists)
                    subscriber.complete()
                })()
            }catch(err){
                subscriber.error(err)
            }

        })
    }

    async fileExists(filePath: string): Promise<boolean> {
        try{
            await Fs.access(filePath)
            return true;
        }catch(err){
            this.logs.debug(err?.message)
            return false;
        }
    }

    async garbageCollection(): Promise<void> {
        const size = await this.calcDirSize()
        // todo
    }

    get(payload: GetRequest): Observable<GetResponse> {
        let stream: ReadStream
        return new Observable((subscriber) => {
            (async() => {
                try{
                    const fileDir = await this.fileDir(payload.file_name)
                    const filePath = `${this.filePath(fileDir, payload.file_name)}.bin`
                    const filePathMetadata = `${this.filePath(fileDir, payload.file_name)}.metadata`

                    let fileStat: Stats;
                    try {
                        fileStat = await Fs.stat(filePath);
                    }catch(err){
                        this.logs.debug(err);
                        subscriber.next({
                            exists: false,
                            chunk: emptyChunk(payload.file_name)
                        })
                        subscriber.complete()
                    }


                    const fileMetadata = (await Fs.readFile(filePathMetadata)).toString();
                    const metadata: DiskStorageMetadata = JSON.parse(fileMetadata)

                    console.log(this.getReadChunkSize(payload))
                    if (!stream)
                        stream = createReadStream(filePath, {
                            highWaterMark: this.getReadChunkSize(payload),
                        });

                    let streamIndex = 0;

                    stream.on('data', (chunk) => {
                        this.logs.debug(`Received ${chunk.length} bytes of data.`);
                        const baseChunk = streamIndex == 0 ? {
                            ttl: metadata.ttl,
                            file_name: payload.file_name,
                            file_size: fileStat.size,
                            metadata: metadata.metadata,
                            created_date: fileStat.mtime.getTime() / 1000,
                        } : emptyChunk(payload.file_name)

                        subscriber.next({
                            exists: true,
                            chunk: {
                                ...baseChunk,
                                content: Buffer.from(chunk)
                            }
                        })
                        streamIndex++;
                    });

                    stream.on('end', () => {
                        subscriber.complete()
                    });

                    stream.on('error', (err) => {
                        subscriber.error(err)
                    });

                }catch (error){
                    subscriber.error(new RpcException({
                        message: error.message,
                        code: status.INVALID_ARGUMENT
                    }))
                }
            })();
        })

    }

    save(payload: Observable<FileChunk>): Observable<boolean> {
        const subject = new Subject<boolean>()
        const savedChunks: Array<Promise<boolean>> = [];

        let stream: WriteStream | undefined;
        payload.subscribe({
            next: async(chunk) => {

                try{
                    const fileDir = await this.fileDir(chunk.file_name, true)
                    const filePath = `${this.filePath(fileDir, chunk.file_name)}.bin`

                    if (!stream) {
                        const metadataFilePath = `${this.filePath(fileDir, chunk.file_name)}.metadata`
                        await this.saveMetadata(metadataFilePath, chunk)
                        stream = createWriteStream(filePath);
                    }

                    savedChunks.push(new Promise<boolean>((resolve, reject) => {
                        stream.write(chunk.content, (err) => {
                            if (err){
                                reject(err)
                            }else{
                                resolve(true)
                            }
                        })
                    }))

                }catch(err){
                    this.logs.error(err)
                    subject.error(err);
                }
            },
            error: (err) => {
                subject.error(err)
            },
            complete: () => {
                Promise.all(savedChunks)
                    .then((results) => {
                        subject.next(results.every(item => item))
                        subject.complete()
                    })
            }
        })

        return subject.asObservable()
    }

    protected async saveMetadata(filePath: string, file: FileChunk): Promise<void>
    {
        const metadata: DiskStorageMetadata = {
            ttl: file?.ttl ?? this.defaultTtl,
            metadata: file?.metadata ?? ""
        }

        await Fs.writeFile(filePath, JSON.stringify(metadata))
    }


    protected getReadChunkSize(payload: GetRequest)
    {
        if (
            !isNaN(payload.chunk_size)
            && payload.chunk_size > 1024
        )
            return payload.chunk_size;

        return this.readChunkSize;
    }

    protected filePath(fileDir: string, fileName: string): string
    {
        return path.join(fileDir, fileName)
    }

    protected async fileDir(fileName: string, createDirs = false): Promise<string>
    {
        if (fileName.length < 2)
            throw new Error(`File name should have min 2 characters`)

        if (!(/^[0-9A-Fa-f]*$/.test(fileName))){
            throw new Error('File should have only hexadecimal characters')
        }

        const dirPath = path.join(this.dirPath, `${fileName[0]}${fileName[1]}`)
        const dirExists = await this.fileExists(dirPath);

        if (createDirs && !dirExists) {
            await Fs.mkdir(dirPath, {
                recursive: true
            })
        }
        return dirPath
    }

    protected createDir(): void
    {
        if (!existsSync(this.dirPath)) {
            mkdirSync(this.dirPath, {
                recursive: true,
            })
        }
    }

    protected calcDirSize(): Promise<number>
    {
        let totalSize = 0;

        async function traverseDirectory(currentDir) {
            const entries = await Fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    // Recursively read subdirectories
                    await traverseDirectory(fullPath);
                } else if (entry.isFile()) {
                    // Get the size of the file
                    const stats = await Fs.stat(fullPath)
                    totalSize += stats.size;
                }
            }
        }

        return new Promise<number>((resolve) => {
            traverseDirectory(this.dirPath).then(() => {
                resolve(totalSize)
            })
        })
    }


}