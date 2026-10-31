/** Decode Unicode text files without guessing a legacy encoding from their content. */
export function decodeDocumentText(data: ArrayBuffer, options?: TextDecoderOptions): string {
  const bytes = new Uint8Array(data);
  const encoding = bytes[0] === 0xFF && bytes[1] === 0xFE ? "utf-16le"
    : bytes[0] === 0xFE && bytes[1] === 0xFF ? "utf-16be"
    : "utf-8";
  // TextDecoder consumes a matching BOM and leaves all other characters intact.
  return new TextDecoder(encoding, options).decode(bytes);
}
