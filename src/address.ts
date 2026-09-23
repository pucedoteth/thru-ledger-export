/**
 * Thru account addresses: "ta" followed by the URL-safe base64 of the 32-byte
 * public key plus one checksum byte (the sum of the key bytes, modulo 256).
 * This matches the encoding used by Thru's own SDK and the explorer.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeAddress(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('Expected a 32-byte public key');
  let checksum = 0;
  for (const byte of bytes) checksum = (checksum + byte) & 0xff;
  const data = new Uint8Array(33);
  data.set(bytes);
  data[32] = checksum;

  let out = 'ta';
  for (let i = 0; i < 33; i += 3) {
    const triple = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    out += ALPHABET[(triple >> 18) & 63]! + ALPHABET[(triple >> 12) & 63]! + ALPHABET[(triple >> 6) & 63]! + ALPHABET[triple & 63]!;
  }
  return out;
}

export function decodeAddress(address: string): Uint8Array {
  if (address.length !== 46 || !address.startsWith('ta')) throw new Error(`Not a Thru address: ${address}`);
  const data = new Uint8Array(33);
  for (let i = 0, o = 0; i < 44; i += 4, o += 3) {
    let triple = 0;
    for (let j = 0; j < 4; j++) {
      const index = ALPHABET.indexOf(address[2 + i + j]!);
      if (index < 0) throw new Error(`Not a Thru address: ${address}`);
      triple = (triple << 6) | index;
    }
    data[o] = (triple >> 16) & 0xff;
    data[o + 1] = (triple >> 8) & 0xff;
    data[o + 2] = triple & 0xff;
  }
  const key = data.slice(0, 32);
  let checksum = 0;
  for (const byte of key) checksum = (checksum + byte) & 0xff;
  if (checksum !== data[32]) throw new Error(`Address checksum mismatch: ${address}`);
  return key;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
