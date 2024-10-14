import {Test, TestingModule} from "@nestjs/testing";
import {ConfigModule, ConfigService} from "@nestjs/config";
import {Config} from "../config/config";
import {Observable} from "rxjs";
import {SaveData} from "../interfaces/storage.interface";
import {MemoryStorage} from "./memory.storage";
import {MetricsModule} from "../metrics/metrics.module";

describe("Test disk storage", () => {

    let memoryStorage: MemoryStorage;
    let module: TestingModule


    const read = async(name: string): Promise<{
        text: string,
        chunks: Array<any>
    }> => {
        return new Promise((resolve) => {
            const fileChunks = []
            memoryStorage.load(
                name,
                1024
            )
                .subscribe({
                    next: (chunk) => {
                        fileChunks.push(chunk)
                    },
                    complete: () => {
                        const text = Buffer.concat(fileChunks.map(item => item.content)).toString()
                        resolve({
                            text: text,
                            chunks: fileChunks
                        })
                    },
                })
        })

    }

    beforeEach(async () => {
        module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    load: [() => Config]
                }),
                MetricsModule
            ],
            providers: [
                MemoryStorage
            ]
        }).compile()

        await module.init()
        memoryStorage = module.get(MemoryStorage)
    })

    it('Should save and read file', (done) => {
        const metadata = JSON.stringify({
            test: 123
        })

        const data = new Observable<SaveData>(subscriber => {
            const payload = Buffer.from("abc");
            const payload2 = Buffer.from("abc2")
            const payload3 = Buffer.from("abc3")

            subscriber.next({
                content: new Uint8Array(payload),
                ttl: 50,
                metadata: metadata,
                file_name: "abc",
            })
            subscriber.next({
                content: new Uint8Array(payload2),
                ttl: 50,
                metadata: metadata,
                file_name: "abc",
            })
            subscriber.next({
                content: new Uint8Array(payload3),
                ttl: 50,
                metadata: metadata,
                file_name: "abc",
            })
            subscriber.complete()
        })

        memoryStorage.save(data)
            .subscribe({
                next: (data) => {
                    expect(data).toBe(true)
                },
                complete: async() => {
                    const name = "abc"

                    // Read 3 times same file
                    const item = await read(name)
                    expect(item.text).toBe('abcabc2abc3')
                    expect((await read(name)).text).toBe('abcabc2abc3')
                    expect((await read(name)).text).toBe('abcabc2abc3')
                    done()
                },
                error: (err) => {
                    console.log('err', err)
                    done(err)
                }
            })
    })

})