import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { LoadData, SaveData, StorageInterface } from "../interfaces/storage.interface";
import {concatMap, from, Observable, of, Subject, Subscriber} from "rxjs";
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
import {Cache} from "../helpers/cache";
import {FileStorageInterface} from "../interfaces/file.interface";

interface DiskStorageMetadata {
    metadata: string
    ttl: number
}

@Injectable()
export class DiskStorage extends StorageAbstract implements StorageInterface, OnModuleInit {

    private maxMemory: number;
    private defaultTtlSec: number
    private dirPath: string
    private logs: Logger = new Logger(DiskStorage.name)
    private upload_register_max_time: number

    /**
     * Sum of all files in bytes
     */
    private totalMemorySize: number;

    private files: Cache<string, FileStorageInterface>

    constructor(
        protected configService: ConfigService,
        protected initTrackerService: InitTrackerService,
        @InjectMetric('removed_files')
        protected removed_files_metrics: Counter<string>,
        @InjectMetric('hdd_storage')
        protected hdd_storage_metrics: Gauge<string>,
        @InjectMetric('garbage_collection_hdd_files')
        protected garbage_collection_hdd_files_metrics: Counter<string>,
        @InjectMetric('garbage_collection_hdd_files_bytes')
        protected garbage_collection_hdd_files_bytes_metrics: Counter<string>,
    ) {
        super(configService)
        this.defaultTtlSec = configService.get('storages.disk.ttl')
        this.dirPath = configService.get('storages.disk.path')
        this.maxMemory = configService.get('storages.disk.max_memory')
        this.upload_register_max_time = configService.get('garbageCollection.upload_register_max_time')

        this.totalMemorySize = 0;

        this.files = new Cache({
            maxMemory: this.maxMemory
        })

        this.files.on('remove', (item, keyName, reason) => {
            this.logs.debug(`Received remove file event from lru remove from disk ${keyName} reason: ${reason}`)
            this.removeFile(keyName, item)
            this.removed_files_metrics.inc()
        })

        setInterval(() => {
            this.hdd_storage_metrics.set(this.totalMemorySize)
        }, 100)
    }

    async onModuleInit() {
        this.initTrackerService.trackModuleInit(DiskStorage.name)
        await this.createDir()
        await this.indexHddFiles()
        this.initTrackerService.trackModuleFinished(DiskStorage.name)
    }

    load(fileName: string): Observable<LoadData>
    {
        return new Observable((subscriber) => {
            (async() => {

                const file = this.files.get(fileName)
                if (!file){
                    this.logs.debug(`${fileName} not exists on hdd`);
                    this.fileNoExistsResponse(subscriber)
                    return;
                }

                let fileStat: Stats;
                try {
                    fileStat = await Fs.stat(file.filePaths.bin);
                }catch(err){
                    // No exists return false and close
                    this.logs.error(err);
                    subscriber.error('Cant read data')
                    return;
                }

                const fileMetadata = (await Fs.readFile(file.filePaths.metadata)).toString()
                const metadata: DiskStorageMetadata = JSON.parse(fileMetadata);

                subscriber.next({
                    exists: true,
                    metadata: metadata.metadata,
                    file_size: fileStat.size,
                    ttl: metadata.ttl
                })
                subscriber.complete()
            })()

        })
    }

    loadChunks(fileName: string, chunkSize: number): Observable<Uint8Array> {

        let stream: ReadStream
        return new Observable((subscriber) => {
            (async() => {
                try{
                    const file = this.files.get(fileName)
                    if (!file){
                        subscriber.error('You try to send chunks for not exists file')
                        return;
                    }

                    // Get file data and check exists
                    if (!stream)
                        stream = createReadStream(file.filePaths.bin, {
                            highWaterMark: this.getReadChunkSize(chunkSize),
                        });


                    let chunkIndex = 0;
                    stream.on('data', (chunk) => {
                        this.logs.debug(`Load ${fileName} ${chunk.length} bytes from disk of data.`);
                        subscriber.next(new Uint8Array(Buffer.from(chunk)))
                        chunkIndex++;
                    });

                    stream.on('end', () => {
                        this.logs.debug(`Download completed ${fileName}`)
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
        let fileInfo: FileStorageInterface & {
            fileName: string
            lock: boolean
        }

        const closeStream = () => {
            if (stream) stream.close()
        }

        const initStream = async(chunk: SaveData) => {
            const paths = await this.filePaths(chunk.file_name, true)
            await this.saveMetadata(paths.metadata, chunk)
            stream = createWriteStream(paths.binFile);

            // Calc ttl in sec
            const ttl = chunk?.ttl ? this.convertToInt(chunk.ttl) : this.defaultTtlSec

            fileInfo = {
                fileName: chunk.file_name,
                metadata: chunk.metadata,
                save_date: 0,
                ttl: ttl,
                filePaths: {
                    metadata: paths.metadata,
                    bin: paths.binFile,
                },
                fileSize: chunk.content.length,
                lock: false
            }

            return chunk
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
                        fileInfo.lock = true;
                        stream.write(chunk.content)
                        fileInfo.lock = false;
                        fileInfo.fileSize += chunk.content.length
                        this.totalMemorySize += chunk.content.length
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
                            if (!fileInfo || !stream) {
                                throw new Error('No send any chunks close upload')
                            }

                            const start = Date.now()

                            // If flag isCalculating = true wait for finished
                            while(true) {
                                if (!fileInfo.lock) break;
                                if (Date.now() - start > 5000)
                                    throw new Error('Wait for other writingChunks')
                                await sleep(50);
                            }

                            stream.end(async() => {
                                try{
                                    await this.commitStream(fileInfo.fileName)
                                    const filePayload = {
                                        ttl: fileInfo.ttl,
                                        fileSize: fileInfo.fileSize,
                                        metadata: fileInfo.metadata,
                                        filePaths: {
                                            bin: fileInfo.filePaths.bin.replace('.tmp',''),
                                            metadata: fileInfo.filePaths.metadata.replace('.tmp',''),
                                        },
                                        save_date: Date.now() / 1000,
                                        lock: false
                                    }
                                    console.log("disk", fileInfo.ttl)
                                    this.files.set(
                                        fileInfo.fileName,
                                        filePayload,
                                        fileInfo.ttl
                                    )
                                    this.logs.debug(`Save file ${fileInfo.fileName} ${Math.round(fileInfo?.fileSize ?? 0) / 1024} KB on hdd`)
                                    this.emit('new_item', fileInfo.fileName, filePayload)
                                    subject.complete()
                                }catch(err){
                                    subject.error(err)
                                }finally {
                                    closeStream()
                                }

                            })
                        }catch(err){
                            subject.error(err)
                        }

                    })()

                }
            })

        return subject.asObservable()
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

    delete(fileName: string): Observable<boolean>
    {
        return new Observable((subscriber) => {
            try{
                subscriber.next(this.files.delete(fileName))
                subscriber.complete()
            }catch(err){
                subscriber.error(err)
            }
        })
    }

    /**
     * Remove unused tmp files
     */
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
                            this.garbage_collection_hdd_files_metrics.inc()
                            this.garbage_collection_hdd_files_bytes_metrics.inc(statFile.size)
                            removedFiles++

                            this.logs.debug(`Deleted expired tmp file: ${fullPath} and metadata: ${metadataFilePath}`);
                        } catch (error) {
                            this.logs.error(`Error deleting tmp file or metadata: ${error.message}`);
                        }
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

    protected async removeFile(fileName: string, file: FileStorageInterface): Promise<void>
    {
        const paths = await this.filePaths(fileName)
        this.totalMemorySize -= file.fileSize
        try{
            await Promise.all([
                Fs.unlink(paths.metadata),
                Fs.unlink(paths.binFile),
            ])
        }catch(err){
            this.logs.error(err)
        }

    }

    /**
     * After save all chunks commit file. Rename files from bin.tmp to .bin
     *
     * @param fileName
     * @protected
     */
    protected async commitStream(fileName: string): Promise<void> {
        const paths = await this.filePaths(fileName);

        await Promise.all([
            Fs.rename(paths.metadata + '.tmp', paths.metadata),
            Fs.rename(paths.binFile + '.tmp', paths.binFile)
        ]);

    };

    /**
     * Save metadata file to disk
     * @param filePath
     * @param file
     * @protected
     */
    protected async saveMetadata(filePath: string, file: SaveData): Promise<void>
    {
        const metadata: DiskStorageMetadata = {
            ttl: file?.ttl ?? this.defaultTtlSec,
            metadata: file?.metadata ?? ""
        }

        await Fs.writeFile(filePath, JSON.stringify(metadata))
    }

    /**
     * Generate file paths
     *
     * @param file_name - key name
     * @param isTmp - is temporary path
     * @protected
     */
    protected async filePaths(fileName: string, isTmp = false)
    {
        const fileDir = await this.fileDir(fileName, isTmp)
        const tmp = isTmp ? '.tmp' : ''
        const filePath = `${this.filePath(fileDir, fileName)}.bin${tmp}`
        const metadataFilePath = `${this.filePath(fileDir, fileName)}.metadata${tmp}`

        return {
            binFile: filePath,
            metadata: metadataFilePath
        }
    }

    /**
     * Generate subdirectory path string in storage.
     *
     * @param fileName
     * @param createDirs - if true and dir not exists create subdirectory on disk
     * @protected
     */
    protected async fileDir(fileName: string, createDirs = false): Promise<string>
    {
        if (fileName.length < 2)
            throw new Error(`File name should have min 2 characters`)

        if (!(/^[0-9A-Fa-f]*$/.test(fileName))){
            throw new Error('File should have only hexadecimal characters')
        }

        const dirPath = path.join(this.dirPath, `${fileName[0]}${fileName[1]}`)

        if (createDirs) {
            const dirExists = await this.fileExists(dirPath);
            if (!dirExists) {
                await Fs.mkdir(dirPath, {
                    recursive: true
                })
            }
        }

        return dirPath
    }

    /**
     * On startup storage should index all files from disk
     *
     * @protected
     */
    protected indexHddFiles(): Promise<void>
    {
        const traverseDirectory = async(currentDir) => {
            const entries = await Fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    // Recursively read subdirectories
                    await traverseDirectory(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.metadata')) {
                    try{
                        const fileName = entry.name.replace('.metadata','')
                        const binPath = fullPath.replace('.metadata','.bin')

                        const metadata: DiskStorageMetadata = JSON.parse((await Fs.readFile(fullPath)).toString())
                        const stats = await Fs.stat(binPath)

                        const ttl = metadata.ttl ? this.convertToInt(metadata.ttl) : this.defaultTtlSec
                        this.totalMemorySize += stats.size;
                        this.files.set(fileName, {
                            fileSize: stats.size,
                            ttl: ttl,
                            metadata: metadata.metadata,
                            lock: false,
                            save_date: stats.mtime.getTime() / 1000,
                            filePaths: {
                                metadata: fullPath,
                                bin: binPath
                            }
                        }, ttl)
                    }catch(err){
                        this.logs.error(err)
                    }

                }
            }
        }

        return new Promise<void>((resolve) => {
            traverseDirectory(this.dirPath).then(() => {
                resolve()
            })
        })
    }

    /**
     * Create storage directory
     *
     * @protected
     */
    protected createDir(): void
    {
        if (!existsSync(this.dirPath)) {
            mkdirSync(this.dirPath, {
                recursive: true,
            })
        }
    }

    /**
     * Create full path for file in storage directory
     *
     * @param fileDir
     * @param fileName
     * @protected
     */
    protected filePath(fileDir: string, fileName: string): string
    {
        return path.join(fileDir, fileName)
    }

}