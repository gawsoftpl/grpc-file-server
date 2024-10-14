import {parseSize} from "./parseSize";

describe("Test parseSize", () => {
    it('Should parse sizes', () => {
        expect(parseSize("1GB")).toBe(1073741824); // 1073741824
        expect(parseSize("1MB")).toBe(1048576); // 1048576
        expect(parseSize("1KB")).toBe(1024); // 1024
        expect(parseSize("5KB")).toBe(5120);
        expect(parseSize("15GB")).toBe(16106127360);
        expect(parseSize("500MB")).toBe(524288000); // 524288000
    })
})