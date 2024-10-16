import { randomUUID } from 'crypto'
import {GetResponse, GetResponseFileInfo} from "../interfaces";

export const downloadFile = (client: any, downloadKey:string) => {
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