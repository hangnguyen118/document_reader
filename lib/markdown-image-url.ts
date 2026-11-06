const dataImageHeader = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i;

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  return code === 43 ? 62 : code === 47 ? 63 : -1;
}

/** Validate without decoding, copying the payload, or a recursive payload regex. */
export function isMarkdownDataImageUrl(value: string): boolean {
  const start = dataImageHeader.exec(value)?.[0].length;
  if (!start || value.length === start || (value.length - start) % 4 !== 0) return false;
  let end = value.length;
  if (value.charCodeAt(end - 1) === 61) end--;
  if (value.charCodeAt(end - 1) === 61) end--;
  for (let index = start; index < end; index++) {
    if (base64Value(value.charCodeAt(index)) < 0) return false;
  }
  // Padding must represent whole bytes, including zero unused bits.
  const padding = value.length - end;
  return !padding || (base64Value(value.charCodeAt(end - 1)) & (padding === 2 ? 15 : 3)) === 0;
}
