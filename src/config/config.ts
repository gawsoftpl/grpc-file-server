export const Config = {
    storages: {
        memory: {
            // Setup max memory in bytes, default 128MB
            max_memory: parseInt(process.env.STORAGE_MEMORY_MAX_SIZE || "16777216"), // default 16MB
        },
        disk: {
            // Setup max memory in bytes, default 128MB
            max_memory: parseInt(process.env.STORAGE_DISK_MAX_SIZE || "134217728"), // default 128MB
            path: process.env.STORAGE_DISK_PATH || '/tmp/storage',

            read_chunk_size: parseInt(process.env.STORAGE_DISK_READ_CHUNK || "65536"),

            // ttl in seconds
            ttl: parseInt(process.env.STORAGE_TTL || '86400')
        }
    },
    garbageCollection: {
        interval: parseInt(process.env.GARBAGE_COLLECTION_INTERVAL || "60000"),
        upload_register_max_time: parseInt(process.env.GARBAGE_COLLECTION_UPLOAD_REGISTER_MAX_TTL || "60000"),
    },
    grpc: {
        listen: process.env.HOST || "0.0.0.0:3000"
    },
    logs: {
        level: process.env.LOG_LEVEL || 'debug'
    }
}