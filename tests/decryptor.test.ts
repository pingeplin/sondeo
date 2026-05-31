import { describe, it, expect } from 'vitest';
import { DecryptorImpl } from '../src/decryptorImpl';
import { readFx, readHex, segName, meta } from './helpers/fixtures';

describe('DecryptorImpl', () => {
  const decryptor = new DecryptorImpl();
  const key = readHex('key.hex');
  const iv = readHex('iv.hex');

  it('decrypts an AES-128-CBC segment byte-exact to its plaintext', () => {
    const cipher = readFx('enc-explicit', segName(0));
    const plain = readFx('plain', segName(0));

    const out = Buffer.from(decryptor.decrypt(cipher, key, iv));

    expect(out.equals(plain)).toBe(true);
    // PKCS#7 padding stripped — not a block-padded length.
    expect(out.length).toBe(plain.length);
  });

  it('decrypts every explicit-IV fixture segment byte-exact', () => {
    for (let i = 0; i < meta().segmentCount; i++) {
      const cipher = readFx('enc-explicit', segName(i));
      const plain = readFx('plain', segName(i));
      const out = Buffer.from(decryptor.decrypt(cipher, key, iv));
      expect(out.equals(plain)).toBe(true);
    }
  });

  it.each([0, 15, 17, 32])(
    'throws a key-length error for a %i-byte key',
    (len) => {
      const cipher = readFx('enc-explicit', segName(0));
      const badKey = Buffer.alloc(len);
      let thrown: unknown;
      try {
        decryptor.decrypt(cipher, badKey, iv);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String((thrown as Error).message).toLowerCase()).toContain('key');
      expect(String((thrown as Error).message)).toContain(String(len));
    }
  );
});
