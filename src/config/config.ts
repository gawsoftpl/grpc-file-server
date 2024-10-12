export const Config = {
    storages: {
        memory: {
            // Setup max memory in bytes, default 128MB
            max_memory: parseInt(process.env.STORAGE_MEMORY_MAX_SIZE || "16"),
        },
        disk: {
            // Setup max memory in bytes, default 128MB
            max_memory: parseInt(process.env.STORAGE_DISK_MAX_SIZE || "16"),
            path: process.env.STORAGE_DISK_PATH || '/tmp/storage'
        }
    },
    garbageCollection: {
        interval: parseInt(process.env.GARBAGE_COLLECTION_INTERVAL || "60000"),
    },
    grpc: {
        listen: process.env.HOST || "0.0.0.0:3000"
    },
    logs: {
        level: process.env.LOG_LEVEL || 'debug'
    }
}