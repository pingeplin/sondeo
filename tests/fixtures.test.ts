import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { meta, readFx, readHex, segName } from './helpers/fixtures';

// Guards the committed fixtures themselves: the encrypted segments must
// decrypt back to the committed plaintext with the committed key/IV. This is
// independent of sondeo's Decryptor (that arrives in SL2) — it uses Node crypto
// directly so a drifted/corrupt fixture is caught before any real test relies
// on it.

function aesCbcDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([d.update(data), d.final()]);
}

function ivFromSeq(n: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(n >>> 0, 12);
  return iv;
}

describe('synthetic AES-128 fixtures', () => {
  const key = readHex('key.hex');
  const explicitIv = readHex('iv.hex');
  const m = meta();

  it('round-trips every explicit-IV segment to its committed plaintext', () => {
    for (let i = 0; i < m.segmentCount; i++) {
      const cipher = readFx('enc-explicit', segName(i));
      const plain = readFx('plain', segName(i));
      expect(aesCbcDecrypt(cipher, key, explicitIv).equals(plain)).toBe(true);
    }
  });

  it('round-trips every derived-IV segment using its sequence-derived IV', () => {
    for (let i = 0; i < m.segmentCount; i++) {
      const cipher = readFx('enc-derived', segName(i));
      const plain = readFx('plain', segName(i));
      const iv = ivFromSeq(m.mediaSequence + i);
      expect(aesCbcDecrypt(cipher, key, iv).equals(plain)).toBe(true);
    }
  });
});
