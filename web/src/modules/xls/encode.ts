/** Base64 of a file's bytes, built in chunks so large workbooks do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
