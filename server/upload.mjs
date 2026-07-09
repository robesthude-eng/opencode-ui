/**
 * Upload handling: multipart parsing, file upload endpoints.
 */

/**
 * Binary-safe Buffer.indexOf
 */
function bufferIndexOf(buf, needle, start = 0) {
  if (needle.length === 0) return start;
  if (buf.length < needle.length + start) return -1;
  return buf.indexOf(needle, start);
}

/**
 * Parse multipart form data (binary-safe).
 * Returns array of { name, filename, data } objects.
 */
export function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const delimiterBuf = Buffer.from(`\r\n\r\n`);

  let searchStart = 0;
  while (searchStart < buffer.length) {
    // Find the next boundary
    const boundaryIdx = bufferIndexOf(buffer, boundaryBuf, searchStart);
    if (boundaryIdx === -1) break;

    // Skip the boundary and \r\n
    let headerStart = boundaryIdx + boundaryBuf.length;
    if (headerStart + 2 > buffer.length) break;
    // Check for trailing -- (end marker)
    if (buffer[headerStart] === 0x2d && buffer[headerStart + 1] === 0x2d) break; // --
    if (buffer[headerStart] === 0x0d && buffer[headerStart + 1] === 0x0a) {
      headerStart += 2; // Skip \r\n after boundary
    }

    // Find the double CRLF that separates headers from body
    const headerEndIdx = bufferIndexOf(buffer, delimiterBuf, headerStart);
    if (headerEndIdx === -1) break;

    // Parse headers (safe to use string here - headers are ASCII)
    const headersStr = buffer.slice(headerStart, headerEndIdx).toString("utf8");
    let bodyStart = headerEndIdx + delimiterBuf.length; // After \r\n\r\n

    // Find the next boundary to determine body end
    const nextBoundaryIdx = bufferIndexOf(buffer, boundaryBuf, bodyStart);
    const bodyEnd = nextBoundaryIdx !== -1 ? nextBoundaryIdx - 2 : buffer.length; // -2 for \r\n before boundary

    const body = buffer.slice(bodyStart, bodyEnd);

    const nameMatch = headersStr.match(/name="([^"]+)"/);
    if (!nameMatch) {
      searchStart = nextBoundaryIdx !== -1 ? nextBoundaryIdx : buffer.length;
      continue;
    }
    const filenameMatch = headersStr.match(/filename="([^"]+)"/);
    parts.push({
      name: nameMatch[1],
      filename: filenameMatch ? filenameMatch[1] : null,
      data: body, // Already a Buffer — binary safe
    });

    searchStart = nextBoundaryIdx !== -1 ? nextBoundaryIdx : buffer.length;
  }
  return parts;
}
