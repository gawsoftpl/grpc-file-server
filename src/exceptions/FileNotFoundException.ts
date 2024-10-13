export class FileNotFoundException extends Error {
    constructor() {
        super('File not found');
    }
}