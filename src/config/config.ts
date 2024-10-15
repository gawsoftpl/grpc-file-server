import {yn} from "../helpers/yn";
import {parseSize} from "../helpers/parseSize";

export const Config = {
    timeouts: {
        upload: parseInt(process.env.UPLOAD_TIMEOUT || '60000'),
        download: parseInt(process.env.DOWNLOAD_TIMEOUT || '60000'),
    },
    storages: {
        memory: {
            // Setup max memory in bytes, default 128MB
            max_memory: parseSize(process.env.STORAGE_MEMORY_MAX_SIZE || "128MB"), // default 128MB

            // Default ttl per second
            ttl: parseInt(process.env.STORAGE_MEMORY_TTL || '600'),

        },
        disk: {
            // Setup max memory in bytes, default 128MB
            max_memory: parseSize(process.env.STORAGE_DISK_MAX_SIZE || "4GB"), // default 4GB
            path: process.env.STORAGE_DISK_PATH || '/tmp/storage',

            read_chunk_size: parseInt(process.env.STORAGE_DISK_READ_CHUNK || "65536"),

            // ttl in seconds
            ttl: parseInt(process.env.STORAGE_DISK_TTL || '600'),

        }
    },
    garbageCollection: {
        interval: parseInt(process.env.GARBAGE_COLLECTION_INTERVAL || "60"), // in sec
        upload_register_max_time: parseInt(process.env.GARBAGE_COLLECTION_UPLOAD_REGISTER_MAX_TTL || "120"), // in sec
    },
    grpc: {
        listen: process.env.HOST || "0.0.0.0:3000"
    },
    logs: {
        level: process.env.LOG_LEVEL || 'debug'
    },
    metrics: {
        defaultMetrics: yn(process.env.METRICS_DEFAULT, true),
        port: parseInt(process.env.METRICS_PORT || '9090'),
    }
}