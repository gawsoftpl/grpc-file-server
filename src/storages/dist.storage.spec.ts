import {DiskStorage} from "./disk.storage";
import {Test} from "@nestjs/testing";
import {ConfigModule} from "@nestjs/config";
import {Config} from "../config/config";
import {Observable} from "rxjs";
import {FileChunk} from "../interfaces/fileserver.interface";

describe("Test disk storage", () => {

    let diskStorage: DiskStorage;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    load: [() => Config]
                })
            ],
            providers: [
                DiskStorage
            ]
        }).compile()

        await module.init()
        diskStorage = module.get(DiskStorage)
    })

    it('Should save and read file', (done) => {
        const metadata = JSON.stringify({
            test: 123
        })

        const data = new Observable<FileChunk>(subscriber => {
            const payload = Buffer.from("abc2");
            subscriber.next({
                content: new Uint8Array(payload),
                ttl: 10,
                metadata: metadata,
                file_size: payload.length,
                file_name: "abc",
                created_date: 0
            })
            subscriber.next({
                content: new Uint8Array(payload),
                ttl: 0,
                metadata: "",
                file_size: payload.length,
                file_name: "abc",
                created_date: 0
            })
            subscriber.complete()
        })

        diskStorage.save(data)
            .subscribe({
                next: (data) => {
                    expect(data).toBe(true)
                },
                complete: () => {
                    const name = "abc"
                    const fileChunks = []
                    diskStorage.get({
                        file_name: name,
                        chunk_size: 1024
                    })
                        .subscribe({
                            next: (chunk) => {
                                if (fileChunks.length == 0){
                                    expect(chunk.exists).toBe(true)
                                    expect(chunk.chunk.ttl).toBe(10)
                                    expect(chunk.chunk.metadata).toBe(metadata)
                                }
                                expect(chunk.chunk.file_name).toBe(name)
                                fileChunks.push(chunk.chunk.content)
                            },
                            complete: () => {
                                const payload = Buffer.concat(fileChunks).toString()
                                expect(payload).toBe('abc2abc2')
                                done()
                            },
                            error: (err => {
                                done(err)
                            })
                        })
                },
                error: (err) => {
                    console.log('err', err)
                    done(err)
                }
            })


    })
})