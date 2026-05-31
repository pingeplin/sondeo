import { describe, it, expect } from 'vitest';
import { ivForSegment, ivFromSequence, ivFromKeyWords } from '../src/iv';
import { DecryptorImpl } from '../src/decryptorImpl';
import { readFx, readHex, segName, meta } from './helpers/fixtures';

describe('IV derivation', () => {
  it('encodes a media-sequence number as a 16-byte big-endian IV', () => {
    const iv = Buffer.from(ivFromSequence(7));
    expect(iv.length).toBe(16);
    expect(
      iv.equals(Buffer.from('00000000000000000000000000000007', 'hex'))
    ).toBe(true);
  });

  it('carries a multi-byte sequence number into the low bytes', () => {
    // 258 = 0x0102
    const iv = Buffer.from(ivFromSequence(258));
    expect(
      iv.equals(Buffer.from('00000000000000000000000000000102', 'hex'))
    ).toBe(true);
  });

  it('spans beyond the low 4 bytes for sequence numbers over 0xFFFFFFFF', () => {
    const iv = ivFromSequence(0x100000001); // 2^32 + 1
    expect(iv[11]).toBe(0x01); // proves the encoding is wider than 32 bits
    expect(iv[12]).toBe(0x00);
    expect(iv[15]).toBe(0x01);
  });

  it('converts an explicit 4-word IV (4 x 32-bit big-endian) to 16 bytes', () => {
    const words = [0xf0e0d0c0, 0xb0a09080, 0x70605040, 0x30201000];
    const iv = Buffer.from(ivFromKeyWords(words));
    expect(iv.equals(readHex('iv.hex'))).toBe(true);
  });

  it('uses the explicit IV when present, else derives from mediaSequence + index', () => {
    const words = [0xf0e0d0c0, 0xb0a09080, 0x70605040, 0x30201000];
    expect(
      Buffer.from(ivForSegment(words, 0, 5)).equals(readHex('iv.hex'))
    ).toBe(true);
    expect(
      Buffer.from(ivForSegment(undefined, 4, 3)).equals(ivFromSequence(7))
    ).toBe(true);
  });

  it('decrypts derived-IV segments byte-exact using the derived IV', () => {
    const decryptor = new DecryptorImpl();
    const key = readHex('key.hex');
    const m = meta();
    for (let i = 0; i < m.segmentCount; i++) {
      const cipher = readFx('enc-derived', segName(i));
      const plain = readFx('plain', segName(i));
      const iv = ivForSegment(undefined, m.mediaSequence, i);
      expect(
        Buffer.from(decryptor.decrypt(cipher, key, iv)).equals(plain)
      ).toBe(true);
    }
  });
});
