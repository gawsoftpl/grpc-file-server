import grpc from 'k6/net/grpc';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import crypto from 'k6/crypto';
import { Counter } from 'k6/metrics';

const GRPC_ADDR = __ENV.GRPC_ADDR || '127.0.0.1:3000';
const GRPC_PROTO_PATH = __ENV.GRPC_PROTO_PATH || '../../protos/fileserver.proto';
const CHUNK_SIZE = parseInt(__ENV.CHUNK_SIZE || '65536')
const FILES_DOWNLOAD = parseInt(__ENV.FILES_DOWNLOAD || '100')

const client = new grpc.Client();
client.load([], GRPC_PROTO_PATH);

const downloadFiles = new Counter('download_files');

export const options = {
    vus: 1,
    duration: '30s',
}


let stream

export default function () {

    if (__ITER == 0) {
        client.connect(GRPC_ADDR, { plaintext: true });
        stream = new grpc.Stream(client, 'fileserver.FileServerService/GetFile');
    }

    let filesDownloaded = 0
    stream.on('data', (response) => {
        if (response?.completed) {
            downloadFiles.add(1)
            filesDownloaded++;
        }

        if (filesDownloaded >= FILES_DOWNLOAD)
            stream.end()

    })

    stream.on('error', (err) => {
        console.log('Stream Error: ' + JSON.stringify(err));
    });

    stream.on('end', () => {
        client.close();
    });

    for(let x = 0;x<FILES_DOWNLOAD;x++) {
        const requestId = uuidv4()

        // With random md will return exists: false
        // todo add read urls file to download
        const fileName = crypto.md5(uuidv4(), 'hex');
        //const fileName = "2f352fa435f208492b3d5b3121f26785"

        stream.write({
            request_id: requestId,
            file_name: fileName,
            chunk_size: CHUNK_SIZE
        });

    }

}
