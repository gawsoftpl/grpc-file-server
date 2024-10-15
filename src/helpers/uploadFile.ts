import { randomUUID } from 'crypto'

export const uploadFile = async(client: any, fileName: string, chunks: Array<Buffer>, metadata: Record<string, any>) => {
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