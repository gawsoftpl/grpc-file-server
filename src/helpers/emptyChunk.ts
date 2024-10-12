import {FileChunk} from "../interfaces/fileserver.interface";

export const emptyChunk  = (fileName: string): FileChunk => ({
    ttl: 0,
    file_name: fileName,
    content: null,
    file_size: 0,
    created_date: 0,
    metadata: "",
})