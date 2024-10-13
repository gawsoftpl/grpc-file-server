export class FileLockedException extends Error {
    constructor() {
        super('File is locked. Timeout for waiting to release');
    }
}