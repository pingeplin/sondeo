const IV_BYTES = 16;
const IV_WORDS = 4;

/**
 * 16-byte big-endian encoding of a media sequence number (RFC 8216 §5.2).
 * Uses plain-number arithmetic (exact to 2^53) rather than BigInt so the build
 * compiles under the project's `target: es5`; HLS sequence numbers are far below
 * that ceiling.
 */
export function ivFromSequence(seq: number): Uint8Array {
  const iv = new Uint8Array(IV_BYTES);
  let v = seq;
  for (let i = IV_BYTES - 1; i >= 0 && v > 0; i--) {
    iv[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return iv;
}

/** Convert m3u8-parser's explicit IV (4 x 32-bit big-endian words) to 16 bytes. */
export function ivFromKeyWords(words: number[]): Uint8Array {
  const iv = new Uint8Array(IV_BYTES);
  for (let w = 0; w < IV_WORDS; w++) {
    const word = (words[w] ?? 0) >>> 0;
    iv[w * 4] = (word >>> 24) & 0xff;
    iv[w * 4 + 1] = (word >>> 16) & 0xff;
    iv[w * 4 + 2] = (word >>> 8) & 0xff;
    iv[w * 4 + 3] = word & 0xff;
  }
  return iv;
}

/** The explicit `#EXT-X-KEY` IV when present, otherwise the sequence-derived IV. */
export function ivForSegment(
  explicitIvWords: number[] | undefined,
  mediaSequence: number,
  index: number
): Uint8Array {
  if (explicitIvWords && explicitIvWords.length > 0) {
    return ivFromKeyWords(explicitIvWords);
  }
  return ivFromSequence(mediaSequence + index);
}
