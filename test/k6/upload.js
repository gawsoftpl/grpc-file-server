import grpc from 'k6/net/grpc';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { b64encode } from 'k6/encoding';
import crypto from 'k6/crypto';
import { Counter } from 'k6/metrics';

const GRPC_ADDR = __ENV.GRPC_ADDR || '127.0.0.1:3000';
const GRPC_PROTO_PATH = __ENV.GRPC_PROTO_PATH || '../../protos/fileserver.proto';
const CHUNK_SIZE = parseInt(__ENV.CHUNK_SIZE || '65536')
const FILE_SIZE = parseInt(__ENV.CHUNK_SIZE || '262144')
const FILES_SEND = parseInt(__ENV.FILES_SEND || '100')

const client = new grpc.Client();
client.load([], GRPC_PROTO_PATH);

const sentFiles = new Counter('sent_files');

export const options = {
    vus: 1,
    duration: '30s',
    // stages: [
    //     { duration: '5s', target: 10  }, // simulate ramp-up of traffic from 1 to 100 users over 5 minutes.
    //     { duration: '20s', target: 200 }, // stay at 100 users for 10 minutes
    //     { duration: '10s', target: 10 }, // ramp-down to 0 users
    // ],
    // thresholds: {
    //     http_req_duration: ['p(99)<100'], // 99% of requests must complete below 15s
    // },
}


let stream
let filesSent = 0

export default function () {

    if (__ITER == 0) {
        client.connect(GRPC_ADDR, { plaintext: true });
        stream = new grpc.Stream(client, 'fileserver.FileServerService/Upload');
    }

    stream.on('data', (response) => {
        if (response?.saved) {
            sentFiles.add(1)
            filesSent++
        }
    })

    stream.on('error', (err) => {
        console.log('Stream Error: ' + JSON.stringify(err));
    });

    stream.on('end', () => {
        client.close();
    });

    for(let x = 0;x<FILES_SEND;x++) {
        const requestId = uuidv4()
        const fileName = crypto.md5(uuidv4(), 'hex');

        stream.write({
            register: {
                request_id: requestId,
                file_name: fileName,
                ttl: 60,  // Time to live in seconds
                metadata: 'Sample metadata'
            }
        });

        const chunks = FILE_SIZE / CHUNK_SIZE
        for (let i = 0; i < chunks; i++) {
            stream.write({
                chunk: {
                    request_id: requestId,
                    content: b64encode(new Uint8Array(CHUNK_SIZE)),  // Empty chunk of bytes for test
                }
            });
        }

        stream.write({
            complete: {
                request_id: requestId
            }
        })
    }

    stream.end()
}
