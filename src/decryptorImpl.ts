import { createDecipheriv } from 'crypto';
import { Decryptor } from './interfaces/interfaces';

const AES_128_KEY_BYTES = 16;

export class DecryptorImpl implements Decryptor {
  decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    if (key.length !== AES_128_KEY_BYTES) {
      throw new Error(
        `Invalid AES-128 key length: expected ${AES_128_KEY_BYTES} bytes, got ${key.length}`
      );
    }
    // HLS AES-128 is CBC with PKCS#7 padding (RFC 8216), which Node strips by
    // default. A non-PKCS#7-padded real segment would throw "bad decrypt" here;
    // switch to setAutoPadding(false) + manual tail handling if that surfaces.
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }
}
