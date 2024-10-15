import { credentials } from '@grpc/grpc-js';
import {INestApplication, Logger} from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { grpcClient } from './grpcClient';
import {AppModule} from "../../src/app.module";
import {GrpcClientOptions} from "../../src/grpc/grpc.options";
import {Config} from "../../src/config/config";
import { randomUUID } from 'crypto'
import {GetResponse, GetResponseFileInfo} from "../../src/interfaces";
import {sleep} from "../../src/helpers/sleep";
import {CustomLogger} from "./customLogger";


describe('Proxy cache server GRPC (e2e)', () => {
    let app: INestApplication;
    let client;
    let clientHealth;

    const uploadFile = async(fileName: string, chunks: Array<Buffer>, metadata: Record<string, any>) => {
        return new Promise<{
            uploadId: string,
            uploadMessages: Array<any>
        }>((resolve) => {

            // Stream ids
            const uploadId = randomUUID().toString()

            // Upload
            const call = client.Upload();
            const uploadMessages = []

            call.on('data', (message) => {
                uploadMessages.push(message)
                if (message?.saved || message?.error) {
                    call.end()
                }

                if (message?.error) {
                    console.log(message.error)
                }

            })

            call.on('end', async () => {
               resolve({
                   uploadId,
                   uploadMessages
               })
            })

            call.write({
                register: {
                    request_id: uploadId,
                    ttl: 60,
                    metadata: JSON.stringify(metadata),
                    file_name: fileName
                }
            })

            for (let i = 0; i < chunks.length; i++) {
                call.write({
                    chunk: {
                        request_id: uploadId,
                        content: chunks[i],
                    }
                })
            }

            call.write({
                complete: {
                    request_id: uploadId,
                }
            })

        });
    }

    const downloadFile = (downloadKey:string) => {
        return new Promise<{
            downloadId: string,
            downloadedMessages: Array<any>,
            downloadedFile: Buffer
            fileInfo: GetResponseFileInfo
        }>(resolve => {
            const downloadId = randomUUID().toString()
            const callDownload = client.GetFile();
            const chunks = []
            const downloadedMessages = []
            let fileInfo: GetResponseFileInfo

            callDownload.on('data', (message: GetResponse) => {
                if (message?.file && message.file.request_id == downloadId) {
                    fileInfo = message.file
                }

                if (message?.chunk && message.chunk.request_id == downloadId) {
                    chunks.push(Buffer.from(message.chunk.content))
                }

                if (message?.completed && message.completed.request_id == downloadId) {
                    callDownload.end()
                }

                if (message?.error) {
                    console.log(message.error)
                }
                downloadedMessages.push(message)
            })

            callDownload.on('end', () => {
                resolve({
                    downloadId,
                    downloadedMessages: downloadedMessages,
                    downloadedFile: Buffer.concat(chunks),
                    fileInfo,
                })
            })

            callDownload.write({
                file_name: downloadKey,
                request_id: downloadId,
                chunk_size: 1024
            })
        })
    }

    beforeAll(async () => {
        Logger.overrideLogger(['debug','verbose'])

        const module = await Test.createTestingModule({
            imports: [
                AppModule.register()
            ],
        })
            .setLogger(new CustomLogger())
            .compile()

        app = module.createNestApplication();
        const grpcClientOptions = app.get(GrpcClientOptions);
        app.connectMicroservice<MicroserviceOptions>(
            grpcClientOptions.getOptions(),
        );
        await app.startAllMicroservices();
        await app.init();

    });

    beforeEach(async () => {
        const credentialsClient = credentials.createInsecure();

        const packageFileServer: any = await grpcClient(
            'localhost:3000',
            'fileserver.FileServerService',
            credentialsClient,
        );
        client = new packageFileServer.fileserver.FileServerService(
            Config.grpc.listen,
            credentialsClient,
        );

        const packageFileServerHealth: any = await grpcClient(
            'localhost:3000',
            'grpc.health.v1.Health',
            credentialsClient,
        );
        clientHealth = new packageFileServerHealth.grpc.health.v1.Health(
            Config.grpc.listen,
            credentialsClient,
        );
    });

    afterAll(async () => {
        await app.close();
    });

    it('Health should response success', (done) => {
        clientHealth.Check({ service: 'health' }, (e, response) => {
            expect(response.status).toBe('SERVING');
            done();
        });
    })

    it('Should return info that file not exists', (done) => {
        (async() => {
            const { fileInfo, downloadId } = await downloadFile('aaa');
            expect(fileInfo.exists).toBeFalsy()
            expect(fileInfo.request_id).toBe(downloadId)
            done()
        })()
    })

    it('Should return error on upload', (done) => {
        (async() => {
            const { uploadMessages, uploadId } = await uploadFile('ab', [], {});
            console.log(uploadMessages)
            expect(uploadMessages).toMatchObject(
                [
                    { register: { request_id: uploadId }},
                    {
                        error: {
                            request_id: uploadId,
                            message: 'No send any chunks close upload',
                            code: 13
                        }
                    }

                ]
            )
            done()
        })()
    })


    it('Should save and download file', (done) => {

        (async() => {
            const fileChunks: Array<Buffer> = [
                Buffer.from("abc"),
                Buffer.from("abc2"),
                Buffer.from(new Date().getTime().toString()),
            ]

            const file = Buffer.concat(fileChunks)

            const metadata = {
                test: 1,
                test2: "aaa"
            }

            const key = "abc"

            const { uploadId, uploadMessages } = await uploadFile(key, fileChunks, metadata)
            expect(uploadMessages).toMatchObject([
                {
                    register: {
                        request_id: uploadId
                    },
                },
                {
                    chunk: {
                        request_id: uploadId,
                        success: true
                    }
                },
                {
                    chunk: {
                        request_id: uploadId,
                        success: true
                    }
                },
                {
                    chunk: {
                        request_id: uploadId,
                        success: true
                    }
                },
                {
                    saved: {
                        request_id: uploadId
                    }
                },
            ])

            // Download
            const expectedDownloadObject = (downloadId) =>  [
                {
                    file: {
                        request_id: downloadId,
                        exists: true,
                        metadata: JSON.stringify({
                            test: 1,
                            test2: "aaa"
                        }),
                        file_size: file.length.toString()
                    }
                },
                {
                    chunk: {
                        request_id: downloadId,
                        content: file
                    }
                },
                {
                    completed: {
                        request_id: downloadId
                    }
                }
            ]

            // Download first time
            const { downloadId, downloadedMessages, downloadedFile, fileInfo } = await downloadFile(key)
            expect(fileInfo.exists).toBe(true)
            expect(fileInfo.metadata).toBe(JSON.stringify(metadata))
            expect(downloadedFile.toString()).toBe(file.toString())
            expect(downloadedMessages).toMatchObject(expectedDownloadObject(downloadId));

            // Download second time
            const { downloadId: downloadId2, fileInfo: fileInfo2, downloadedFile: downloadedFile2, downloadedMessages: downloadedMessages2 } = await downloadFile(key)
            expect(fileInfo2.exists).toBe(true)
            expect(downloadedFile2.toString()).toBe(file.toString())
            expect(downloadedMessages2).toMatchObject(expectedDownloadObject(downloadId2));

            done()
        })()

    })

    it('Should save two times same file and mem cache should return fresh data', (done) => {

        (async() => {
            // First file
            const fileChunks: Array<Buffer> = [
                Buffer.from("content-first-file"),
            ]
            const file = Buffer.concat(fileChunks)

            // Second file
            const fileChunks2: Array<Buffer> = [
                Buffer.from("content-second-file"),
            ]
            const file2 = Buffer.concat(fileChunks2)

            const metadata = {
                test: 1,
                test2: "aaa"
            }

            const key = "abc2"

            await uploadFile(key, fileChunks, metadata)
            const { downloadedFile } = await downloadFile(key);
            expect(downloadedFile.toString()).toBe(file.toString())

            await uploadFile(key, fileChunks2, metadata)
            const { downloadedFile: downloadedFile2 } = await downloadFile(key);
            expect(downloadedFile2.toString()).toBe(file2.toString())
            done()
        })()
    })

})