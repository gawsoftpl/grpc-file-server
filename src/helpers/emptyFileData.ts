import { GetResponseFileInfo} from "../interfaces/fileserver.interface";

export const emptyFileData  = (requestId: string): GetResponseFileInfo => ({
    file_size: 0,
    exists: false,
    request_id: requestId,
    metadata: "",
})