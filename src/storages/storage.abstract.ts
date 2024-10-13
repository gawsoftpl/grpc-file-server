import {ConfigService} from "@nestjs/config";

export abstract class StorageAbstract {

    private readChunkSize: number

    constructor(
        protected configService: ConfigService
    ) {
        this.readChunkSize = configService.get('storages.disk.read_chunk_size')
    }

    protected getReadChunkSize(chunkSize?: number ): number
    {
        if (
            !isNaN(chunkSize)
            && chunkSize > 2
        )
            return chunkSize;

        return this.readChunkSize;
    }
}