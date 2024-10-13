import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { LoadData, SaveData, StorageInterface } from "../interfaces/storage.interface";
import { concatMap,  from, Observable, of, Subject } from "rxjs";
import { ConfigService } from "@nestjs/config";
import * as Fs from 'fs/promises'
import { existsSync, ReadStream, mkdirSync, Stats, createWriteStream, WriteStream, createReadStream } from 'fs'
import * as path from 'path'
import { RpcException } from "@nestjs/microservices";
import { status } from '@grpc/grpc-js'
import {StorageAbstract} from "./storage.abstract";

interface DiskStorageMetadata {
    metadata: string
    ttl: number
}

@Injectable()
export class DiskStorage extends StorageAbstract implements StorageInterface, OnModuleInit {

    private maxMemory: number;
    private defaultTtl: number;
    private dirPath: string
    private logs: Logger = new Logger(DiskStorage.name)


    constructor(
        protected configService: ConfigService
    ) {
        super(configService)
        this.defaultTtl = configService.get('storages.disk.ttl')
        this.dirPath = configService.get('storages.disk.path')
        this.maxMemory = configService.get('storages.disk.max_memory')
    }

    async onModuleInit() {
        await this.createDir()
    }

    exists(fileName: string): Observable<boolean> {
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
        this.logs.log('Start disk garbage collection')
        const currentTime = Date.now() / 1000;

        const traverseDirectory = async(currentDir: string): Promise<void> => {
            const entries = await Fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    // Recursively read subdirectories
                    await traverseDirectory(fullPath);
                } else if (entry.isFile() && path.extname(fullPath) === '.metadata') {
                    // For each metadata file, check if the TTL has expired
                    try {
                        const metadataContent = await Fs.readFile(fullPath, 'utf8');
                        const metadata: DiskStorageMetadata = JSON.parse(metadataContent);
                        const statFile = await Fs.stat(fullPath)

                        const expirationTime = metadata.ttl + Math.round(statFile.mtime.getTime() / 1000);

                        if (expirationTime < currentTime) {
                            // The file has expired, delete both .bin and .metadata files
                            const binFilePath = fullPath.replace('.metadata', '.bin');

                            try {
                                await Promise.all([
                                    Fs.unlink(binFilePath),
                                    Fs.unlink(fullPath)
                                ])

                                this.logs.debug(`Deleted expired file: ${binFilePath} and metadata: ${fullPath}`);
                            } catch (error) {
                                this.logs.error(`Error deleting file or metadata: ${error.message}`);
                            }
                        }
                    } catch (error) {
                        this.logs.error(`Error reading metadata for file ${fullPath}: ${error.message}`);
                    }
                }
            }
        }

        try {
            await traverseDirectory(this.dirPath);
            this.logs.debug("Garbage collection completed.");
        } catch (error) {
            this.logs.error(`Error during garbage collection: ${error.message}`);
        }
    }

    load(fileName: string, chunkSize: number): Observable<LoadData> {
        let stream: ReadStream
        return new Observable((subscriber) => {
            (async() => {
                try{
                    const fileDir = await this.fileDir(fileName)
                    const filePath = `${this.filePath(fileDir, fileName)}.bin`
                    const filePathMetadata = `${this.filePath(fileDir, fileName)}.metadata`

                    // Get file data and check exists
                    let fileStat: Stats;
                    try {
                        fileStat = await Fs.stat(filePath);
                    }catch(err){
                        // No exists return false and close
                        this.logs.debug(err);
                        subscriber.next({
                            exists: false,
                            content: new Uint8Array(),
                            file_size: 0,
                            metadata: "",
                            ttl: 0,
                        })
                        subscriber.complete()
                        return;
                    }

                    const fileMetadata = (await Fs.readFile(filePathMetadata)).toString();
                    const metadata: DiskStorageMetadata = JSON.parse(fileMetadata);
                    if (!stream)
                        stream = createReadStream(filePath, {
                            highWaterMark: this.getReadChunkSize(chunkSize),
                        });


                    let chunkIndex = 0;
                    stream.on('data', (chunk) => {
                        this.logs.debug(`Load ${fileName} ${chunk.length} bytes of data.`);

                        const baseData = chunkIndex == 0 ? {
                            metadata: metadata.metadata,
                            file_size: fileStat.size,
                            ttl: metadata.ttl
                        } : {
                            metadata: "",
                            file_size: 0,
                            ttl: 0
                        }

                        subscriber.next({
                            ...baseData,
                            exists: true,
                            content: new Uint8Array(Buffer.from(chunk))
                        })
                        chunkIndex++;
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

    save(chunkData: Observable<SaveData>): Observable<boolean> {

        const subject = new Subject<boolean>();
        let stream: WriteStream;
        let firstPromiseCompleted = false;
        let fileInfo: SaveData

        const closeStream = () => {
            if (stream) stream.close()
        }

        const initStream = async(chunk: SaveData) => {
            fileInfo = chunk
            const fileDir = await this.fileDir(chunk.file_name, true)
            const filePath = `${this.filePath(fileDir, chunk.file_name)}.bin.tmp`
            const metadataFilePath = `${this.filePath(fileDir, chunk.file_name)}.metadata.tmp`
            await this.saveMetadata(metadataFilePath, chunk)
            stream = createWriteStream(filePath);
            return chunk
        };

        const commitStream = async() => {
            const fileDir = await this.fileDir(fileInfo.file_name, true)
            const filePath = `${this.filePath(fileDir, fileInfo.file_name)}.bin.tmp`
            const metadataFilePath = `${this.filePath(fileDir, fileInfo.file_name)}.metadata.tmp`
            const commitFilePath = `${this.filePath(fileDir, fileInfo.file_name)}.bin`
            const commitMetadataFilePath = `${this.filePath(fileDir, fileInfo.file_name)}.metadata`

            await Fs.rename(metadataFilePath, commitMetadataFilePath)
            await Fs.rename(filePath, commitFilePath)

        };

        chunkData
            .pipe(
                concatMap((val) => {
                    if (!firstPromiseCompleted) {
                        // For the first element, run the promise
                        firstPromiseCompleted = true;
                        return from(initStream(val)); // Convert the promise to an observable
                    } else {
                        // For subsequent elements, wait for the first promise to complete
                        return of(val);
                    }
                }),
            )
            .subscribe({
                next: (chunk) => {
                    stream.write(chunk.content)
                    subject.next(true)
                },
                error: (err) => {
                    subject.error(err)
                    closeStream()
                },
                complete: () => {
                    stream.end(async() => {
                        await commitStream()
                        subject.complete()
                        closeStream()
                    })
                }
        })

        return subject.asObservable()
    }

    protected async saveMetadata(filePath: string, file: SaveData): Promise<void>
    {
        const metadata: DiskStorageMetadata = {
            ttl: file?.ttl ?? this.defaultTtl,
            metadata: file?.metadata ?? ""
        }

        await Fs.writeFile(filePath, JSON.stringify(metadata))
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