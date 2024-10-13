import {DiskStorage} from "./disk.storage";
import {Test} from "@nestjs/testing";
import {ConfigModule} from "@nestjs/config";
import {Config} from "../config/config";
import {Observable} from "rxjs";
import {SaveData} from "../interfaces/storage.interface";
import { existsSync } from 'fs'

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

        const savedFlags = []
        diskStorage.save(data)
            .subscribe({
                next: (data) => {
                    savedFlags.push(data)
                },
                complete: () => {
                    expect(savedFlags).toMatchObject([
                        true,
                        true,
                        true
                    ])
                    const name = "abc"
                    const fileChunks = []
                    diskStorage.load(
                        name,
                        1024
                    )
                        .subscribe({
                            next: (chunk) => {

                                if (fileChunks.length == 0){
                                    expect(chunk.metadata).toBe(metadata)
                                    expect(chunk.file_size).toBe(11)
                                }
                                fileChunks.push(chunk.content)
                            },
                            complete: () => {
                                const payload = Buffer.concat(fileChunks).toString()
                                expect(payload).toBe('abcabc2abc3')
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


    it('Garbage collection', (done) => {
        const data = new Observable<SaveData>(subscriber => {
            const payload = Buffer.from("12345678910111213141516");
            subscriber.next({
                content: new Uint8Array(payload),
                ttl: 1,
                metadata: "",
                file_name: "abc",
            })
            subscriber.complete()
        })

        diskStorage.save(data)
            .subscribe({
                next: (data) => {
                    expect(data).toBe(true)
                },
                complete: async() => {
                    setTimeout(async() => {
                        diskStorage.garbageCollection().then(async() => {
                            expect(existsSync('/tmp/storage/ab/abc.bin')).toBeFalsy()
                            expect(existsSync('/tmp/storage/ab/abc.metadata')).toBeFalsy()
                            done()
                        })
                    }, 2000)
                },
            })
    })
})