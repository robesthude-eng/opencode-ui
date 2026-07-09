/**
 * Tests for server/upload.cjs
 */
const { parseMultipart } = require("../upload.cjs");

describe("parseMultipart", () => {
  test("parses single file upload", () => {
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const body = [
      `------WebKitFormBoundary7MA4YWxkTrZu0gW`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"`,
      `Content-Type: text/plain`,
      ``,
      `Hello World`,
      `------WebKitFormBoundary7MA4YWxkTrZu0gW--`,
    ].join("\r\n");
    
    const buffer = Buffer.from(body);
    const parts = parseMultipart(buffer, boundary);
    
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("file");
    expect(parts[0].filename).toBe("test.txt");
    expect(parts[0].data.toString()).toBe("Hello World");
  });

  test("parses multiple files", () => {
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const body = [
      `------WebKitFormBoundary7MA4YWxkTrZu0gW`,
      `Content-Disposition: form-data; name="file1"; filename="file1.txt"`,
      ``,
      `Content of file 1`,
      `------WebKitFormBoundary7MA4YWxkTrZu0gW`,
      `Content-Disposition: form-data; name="file2"; filename="file2.txt"`,
      ``,
      `Content of file 2`,
      `------WebKitFormBoundary7MA4YWxkTrZu0gW--`,
    ].join("\r\n");
    
    const buffer = Buffer.from(body);
    const parts = parseMultipart(buffer, boundary);
    
    expect(parts).toHaveLength(2);
    expect(parts[0].filename).toBe("file1.txt");
    expect(parts[1].filename).toBe("file2.txt");
  });

  test("handles binary data", () => {
    const boundary = "WebKitFormBoundary";
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);

    // Build multipart buffer manually (binary-safe)
    const prefix = Buffer.from(
      `--WebKitFormBoundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="binary.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n` +
      `\r\n`
    );
    const suffix = Buffer.from(`\r\n--WebKitFormBoundary--\r\n`);
    const buffer = Buffer.concat([prefix, binaryData, suffix]);

    const parts = parseMultipart(buffer, boundary);

    expect(parts).toHaveLength(1);
    expect(parts[0].data).toEqual(binaryData);
  });

  test("returns empty array for no parts", () => {
    const buffer = Buffer.from("no multipart data");
    const parts = parseMultipart(buffer, "boundary");
    
    expect(parts).toHaveLength(0);
  });

  test("handles filename with special characters", () => {
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const body = [
      `------WebKitFormBoundary7MA4YWxkTrZu0gW`,
      `Content-Disposition: form-data; name="file"; filename="file with spaces.txt"`,
      ``,
      `content`,
      `------WebKitFormBoundary7MA4YWxkTrZu0gW--`,
    ].join("\r\n");
    
    const buffer = Buffer.from(body);
    const parts = parseMultipart(buffer, boundary);
    
    expect(parts).toHaveLength(1);
    expect(parts[0].filename).toBe("file with spaces.txt");
  });
});
