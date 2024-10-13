import { credentials } from '@grpc/grpc-js';
import { INestApplication } from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { grpcClient } from './grpcClient';
import {AppModule} from "../../src/app.module";
import {GrpcClientOptions} from "../../src/grpc/grpc.options";
import {Config} from "../../src/config/config";
import { randomUUID } from 'crypto'


describe('Proxy cache server GRPC (e2e)', () => {
    let app: INestApplication;
    let client;
    let clientHealth;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            imports: [AppModule.register()],
        }).compile();

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

    it('Should save and download file', (done) => {

        // Init files
        const fileChunks: Array<Buffer> = [
            Buffer.from("abc"),
            Buffer.from("abc2"),
            Buffer.from("abc3"),
        ]
        const file = Buffer.concat(fileChunks);
        const key = "abc"

        // Stream ids
        const uploadId = randomUUID().toString()
        const downloadId = randomUUID().toString()


        // Upload
        const call = client.Upload();
        const uploadMessages = []

        call.on('data', (message) => {
            uploadMessages.push(message)
            if (message?.saved) {
                call.end()
            }
        })

        call.on('end', () => {
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
            const callDownload = client.GetFile();
            const downloadedMessages = []

            callDownload.on('data', (message) => {
                downloadedMessages.push(message)
                if (message?.completed) {
                    callDownload.end()
                    done()
                }
            })

            callDownload.on('end', () => {
                expect(downloadedMessages).toMatchObject([
                    {
                        file: {
                            request_id: downloadId,
                            exists: true,
                            metadata: JSON.stringify({
                                test: 1,
                                test2: "aaa"
                            }),
                            file_size: file.length
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
                ])
            })
            callDownload.write({
                file_name: key,
                request_id: downloadId,
                chunk_size: 128
            })
        })

        call.write({
            register: {
                request_id: uploadId,
                ttl: 10,
                metadata: JSON.stringify({
                    test: 1,
                    test2: "aaa"
                }),
                file_size: file.length,
                file_name: key
            }
        })

        for (let i = 0; i < fileChunks.length; i++) {
            call.write({
                chunk: {
                    request_id: uploadId,
                    content: fileChunks[i],
                    last_chunk: i == fileChunks.length - 1
                }
            })
        }



    })

})