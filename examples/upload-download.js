const { credentials } = require("@grpc/grpc-js");
const { GrpcReflection } = require("grpc-js-reflection-client");
const { randomUUID } = require("crypto");

const HOST = process.env.HOST || 'localhost:3000'

// Grpc helper for download proto file with grpc reflection
const grpcClient = async (
    host,
    packageName,
    credentials,
) => {

    const reflectionClient = new GrpcReflection(host, credentials);
    const descriptor = await reflectionClient.getDescriptorBySymbol(packageName);

    return descriptor.getPackageObject({
        keepCase: true,
        enums: String,
        longs: String,
    });
};

const downloadFile = (client, fileName) => {
    return new Promise((resolve, reject) => {

        const downloadId = randomUUID().toString()
        const chunks = []
        const downloadedMessages = []

        const callDownload = client.GetFile();

        callDownload.on('data', (message) => {
            if (message?.file && message.file.request_id == downloadId) {
                fileInfo = message.file
            }

            if (message?.chunk && message.chunk.request_id == downloadId) {
                chunks.push(Buffer.from(message.chunk.content))
            }

            if (message?.completed_data && message.completed_data.request_id == downloadId) {
                if (message.completed_data.exists) {
                    callDownload.write({
                        file: {
                            chunk_size: 1024,
                            request_id: downloadId,
                        }
                    })
                }else{
                    callDownload.end()
                }
            }

            if (message?.completed_chunks && message.completed_chunks.request_id == downloadId) {
                callDownload.end()
            }

            if (message?.error) {
                console.log(message.error)
            }
            downloadedMessages.push(message)
        })

        callDownload.on('error', (err) => {
            reject(err)
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
            file: {
                file_name: fileName,
                request_id: downloadId,
            }
        })
    })
}

const uploadFile = (client, fileName, fileChunks) => {
    return new Promise((resolve, reject) => {
        const uploadId = randomUUID().toString()

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

        call.on('error', (err) => {
            reject(err)
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
                metadata: JSON.stringify({
                    test: 123,
                }),
                file_name: fileName
            }
        })

        for (let i = 0; i < fileChunks.length; i++) {
            call.write({
                chunk: {
                    request_id: uploadId,
                    content: fileChunks[i],
                }
            })
        }

        call.write({
            complete: {
                request_id: uploadId,
            }
        })
    })

}

(async() => {
    const credentialsClient = credentials.createInsecure();

    // Get proto file with reflection
    const packageFileServer = await grpcClient(
        HOST,
        'fileserver.FileServerService',
        credentialsClient,
    );

    // Connect with client
    const client = new packageFileServer.fileserver.FileServerService(
        HOST,
        credentialsClient,
    );

    // Filename must be hexadecimal
    const fileName =  "2070e4cfb8f24209647d3c9ec55098ee"
    const fileChunks = [
        Buffer.from("abc"),
        Buffer.from("def"),
    ]

    // Upload
    const response = await uploadFile(client, fileName, fileChunks)
    console.log(response)

    // Download
    const downloadFileChunks = await downloadFile(client, fileName)
    console.log(downloadFileChunks)

})()
