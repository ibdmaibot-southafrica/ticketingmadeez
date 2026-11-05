export const MAX_TICKET_FILE_BYTES = 2 * 1024 * 1024
export function validateTicketFile(
  name: string,
  mime: string,
  encoded: string,
) {
  if (!name || name.length > 120 || /[\x00-\x1f/\\]/.test(name))
    throw new Error('Use a filename without paths or control characters.')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4)
    throw new Error('Invalid file encoding.')
  const content = Buffer.from(encoded, 'base64')
  if (!content.length || content.length > MAX_TICKET_FILE_BYTES)
    throw new Error('Files must be between 1 byte and 2 MB.')
  const valid =
    (mime === 'application/pdf' &&
      name.toLowerCase().endsWith('.pdf') &&
      content.subarray(0, 5).toString() === '%PDF-') ||
    (mime === 'image/png' &&
      name.toLowerCase().endsWith('.png') &&
      content
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' &&
      /\.jpe?g$/i.test(name) &&
      content[0] === 255 &&
      content[1] === 216 &&
      content[2] === 255) ||
    (mime === 'text/plain' &&
      name.toLowerCase().endsWith('.txt') &&
      !content.includes(0) &&
      Buffer.from(content.toString('utf8'), 'utf8').equals(content))
  if (!valid)
    throw new Error(
      'Supported files: PDF, PNG, JPEG and UTF-8 text. The file contents must match the type.',
    )
  return content
}
