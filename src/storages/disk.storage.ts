import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { LoadData, SaveData, StorageInterface } from "../interfaces/storage.interface";
import { concatMap,  from, Observable, of, Subject } from "rxjs";
import { ConfigService } from "@nestjs/config";
import * as Fs from 'fs/promises'
import { existsSync, statSync, ReadStream, mkdirSync, Stats, createWriteStream, WriteStream, createReadStream } from 'fs'
import * as path from 'path'
import { RpcException } from "@nestjs/microservices";
import { status } from '@grpc/grpc-js'
import {StorageAbstract} from "./storage.abstract";
import {sleep} from "../helpers/sleep";
import {InitTrackerService} from "../helpers/InitTrackerService";
import {InjectMetric} from "@willsoto/nestjs-prometheus";
import {Counter, Gauge} from "prom-client";

interface DiskStorageMetadata {
    metadata: string
    ttl: number
}

@Injectable()
export class DiskStorage extends StorageAbstract implements StorageInterface, OnModuleInit {

    private maxMemory: number;
    private defaultTtlMs: number;
    private defaultTtlSec: number
    private dirPath: string
    private logs: Logger = new Logger(DiskStorage.name)
    private upload_register_max_time: number
    private memory_size: number;

    constructor(
        protected configService: ConfigService,
        protected initTrackerService: InitTrackerService,
        @InjectMetric('garbage_collection_files')
        protected garbage_collection_files: Counter<string>,
        @InjectMetric('release_files')
        protected release_files: Counter<string>,
        @InjectMetric('hdd_storage')
        protected hdd_storage: Gauge<string>,
        @InjectMetric('garbage_collection_bytes')
        protected garbage_collection_bytes: Counter<string>,
    ) {
        super(configService)
        this.defaultTtlMs = configService.get('storages.disk.ttl')
        this.defaultTtlSec = configService.get('storages.disk.ttl') * 1000
        this.dirPath = configService.get('storages.disk.path')
        this.maxMemory = configService.get('storages.disk.max_memory')
        this.upload_register_max_time = configService.get('garbageCollection.upload_register_max_time')
        this.memory_size = 0;

        setInterval(() => {
            this.hdd_storage.set(this.memory_size)
        }, 100)
    }

    async onModuleInit() {
        this.initTrackerService.trackModuleInit(DiskStorage.name)
        await this.createDir()
        this.memory_size += await this.calcDirSize()
        this.initTrackerService.trackModuleFinished(DiskStorage.name)
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
                this.logs.debug(err?.message)
                subscriber.error(err)
            }

        })
    }

    async fileExists(filePath: string): Promise<boolean> {
        try{
            await Fs.access(filePath)
            return true;
        }catch(err){
            return false;
        }
    }

    async garbageCollection(): Promise<void> {
        this.logs.log('Start disk garbage collection')
        const currentTime = Date.now() / 1000;
        let removedFiles = 0

        const traverseDirectory = async(currentDir: string): Promise<void> => {
            const entries = await Fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    // Recursively read subdirectories
                    await traverseDirectory(fullPath);
                } else if (entry.isFile() && fullPath.endsWith('.bin.tmp')) {
                    const metadataFilePath = fullPath.replace('.bin', '.metadata');

                    const statFile = await Fs.stat(fullPath)
                    const expirationTime = this.upload_register_max_time + Math.round(statFile.mtime.getTime() / 1000);
                    if (expirationTime < currentTime) {
                        // The file has expired, delete both .bin and .metadata files

                        try {
                            await Promise.all([
                                Fs.unlink(fullPath),
                                Fs.unlink(metadataFilePath),
                            ])
                            this.garbage_collection_files.inc()
                            this.garbage_collection_bytes.inc(statFile.size)
                            this.memory_size -= statFile.size
                            removedFiles++

                            this.logs.debug(`Deleted expired tmp file: ${fullPath} and metadata: ${fullPath}`);
                        } catch (error) {
                            this.logs.error(`Error deleting tmp file or metadata: ${error.message}`);
                        }
                    }

                } else if (entry.isFile() && path.extname(fullPath) === '.bin') {
                    // For each metadata file, check if the TTL has expired
                    try {
                        const metadataFilePath = fullPath.replace('.bin', '.metadata');
                        const metadataContent = await Fs.readFile(metadataFilePath, 'utf8');
                        const metadata: DiskStorageMetadata = JSON.parse(metadataContent);
                        const statFile = await Fs.stat(fullPath)

                        const expirationTime = metadata.ttl + Math.round(statFile.mtime.getTime() / 1000);

                        if (expirationTime < currentTime) {
                            // The file has expired, delete both .bin and .metadata files

                            try {
                                await Promise.all([
                                    Fs.unlink(fullPath),
                                    Fs.unlink(metadataFilePath),
                                ])
                                this.garbage_collection_files.inc()
                                this.memory_size -= statFile.size
                                removedFiles++

                                this.logs.debug(`Deleted expired file: ${fullPath} and metadata: ${fullPath}`);
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
            this.logs.debug(`Garbage collection completed. Removed items: ${removedFiles}`);
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
        let writingChunks = []

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

            try{
                await Fs.rename(metadataFilePath, commitMetadataFilePath)
                await Fs.rename(filePath, commitFilePath)
            }catch(err){
                this.logs.error(err)
            }

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
                    (async() => {
                        writingChunks.push(1);
                        const chunkSize = chunk.content.length

                        if ((chunkSize + this.memory_size) > this.maxMemory) {
                            this.logs.debug(`Need ${chunkSize} bytes`)
                            await this.releaseFiles(chunk.file_name, chunkSize)
                        }

                        stream.write(chunk.content)
                        writingChunks.pop()
                        this.memory_size += chunk.content.length
                        subject.next(true)
                    })()
                },
                error: (err) => {
                    subject.error(err)
                    closeStream()
                },
                complete: () => {
                    (async() => {
                        try{
                            const start = Date.now()

                            // If flag isCalculating = true wait for finished
                            while(true) {
                                if (writingChunks.length == 0) break;
                                if (Date.now() - start > 5000) throw new Error('Wait for other writingChunks')
                                await sleep(20);
                            }

                            stream.end(async() => {
                                await commitStream()
                                subject.complete()
                                closeStream()
                            })
                        }catch(err){
                            this.logs.error(err)
                            subject.complete()
                        }

                    })()


                }
        })

        return subject.asObservable()
    }

    protected async saveMetadata(filePath: string, file: SaveData): Promise<void>
    {
        const metadata: DiskStorageMetadata = {
            ttl: file?.ttl ?? this.defaultTtlSec,
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
                    let fileSize = 0;
                    try{
                        const stats = await Fs.stat(fullPath)
                        fileSize = stats.size
                    }catch(err){
                        this.logs.error(err)
                    }
                    totalSize += fileSize;
                }
            }
        }

        return new Promise<number>((resolve) => {
            traverseDirectory(this.dirPath).then(() => {
                resolve(totalSize)
            })
        })
    }

    protected releaseFiles(addingKey: string, bytesRequired: number) {
        this.logs.debug('Try to release hdd for new element')
        const now = Date.now()
        let releasedSize = 0

        const randomSort = (a, b) => Math.random() - 0.5;

        const traverseDirectory = async(currentDir) => {
            const entries = (await Fs.readdir(currentDir, { withFileTypes: true }))
                .sort(randomSort)

            for (const entry of entries) {

                if (releasedSize >= bytesRequired){
                    this.logs.debug(`Released ${releasedSize} with time: ${((Date.now() - now) / 1000)}s`)
                    return;
                }

                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    // Recursively read subdirectories
                    await traverseDirectory(fullPath);
                } else if (entry.isFile()) {
                    if (entry.name !== `${addingKey}.metadata`) {
                        // Get the size of the file
                        let stats;
                        try {
                            stats = await Fs.stat(fullPath)
                        } catch (err) {
                            stats = null
                            this.logs.debug(err)
                        }

                        if (stats && (now - stats.mtime.getTime()) > this.defaultTtlMs) {
                            this.logs.debug(`Released ${fullPath}`)
                            try {
                                await Fs.unlink(fullPath)
                                this.release_files.inc()
                                this.memory_size -= stats.size
                                releasedSize += stats.size;
                            } catch (err) {
                                this.logs.debug(err)
                            }

                        }

                    }

                }
            }
        }

        return new Promise<number>(async(resolve) => {
            traverseDirectory(this.dirPath).then(() => {
                resolve(releasedSize)
            })
        })
    }

}