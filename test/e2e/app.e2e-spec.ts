import { credentials } from '@grpc/grpc-js';
import {INestApplication, Logger} from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { grpcClient } from './grpcClient';
import {AppModule} from "../../src/app.module";
import {GrpcClientOptions} from "../../src/grpc/grpc.options";
import {Config} from "../../src/config/config";
import {CustomLogger} from "./customLogger";
import {downloadFile} from "../../src/helpers/downloadFile";
import {uploadFile} from "../../src/helpers/uploadFile";


describe('Proxy cache server GRPC (e2e)', () => {
    let app: INestApplication;
    let client;
    let clientHealth;


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
            const { fileInfo, downloadId } = await downloadFile(client, 'aaa');
            expect(fileInfo.exists).toBeFalsy()
            expect(fileInfo.request_id).toBe(downloadId)
            done()
        })()
    })

    it('Should return error on upload', (done) => {
        (async() => {
            const { uploadMessages, uploadId } = await uploadFile(client, 'ab', [], {});
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

            const { uploadId, uploadMessages } = await uploadFile(client, key, fileChunks, metadata)
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
            const { downloadId, downloadedMessages, downloadedFile, fileInfo } = await downloadFile(client, key)
            expect(fileInfo.exists).toBe(true)
            expect(fileInfo.metadata).toBe(JSON.stringify(metadata))
            expect(downloadedFile.toString()).toBe(file.toString())
            expect(downloadedMessages).toMatchObject(expectedDownloadObject(downloadId));

            // Download second time
            const { downloadId: downloadId2, fileInfo: fileInfo2, downloadedFile: downloadedFile2, downloadedMessages: downloadedMessages2 } = await downloadFile(client, key)
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

            await uploadFile(client, key, fileChunks, metadata)
            const { downloadedFile } = await downloadFile(client, key);
            expect(downloadedFile.toString()).toBe(file.toString())

            await uploadFile(client, key, fileChunks2, metadata)
            const { downloadedFile: downloadedFile2 } = await downloadFile(client, key);
            expect(downloadedFile2.toString()).toBe(file2.toString())
            done()
        })()
    })

})