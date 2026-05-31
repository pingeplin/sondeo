import { describe, it, expect, afterEach } from 'vitest';
import { MergerImpl } from '../src/mergerImpl';

describe('MergerImpl.ffmpegAvailable', () => {
  const originalPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('returns true when ffmpeg resolves on PATH', () => {
    // The test process inherits a PATH that includes the system ffmpeg.
    expect(new MergerImpl().ffmpegAvailable()).toBe(true);
  });

  it('returns false when PATH contains no ffmpeg binary', () => {
    process.env.PATH = '/nonexistent-sondeo-dir';
    expect(new MergerImpl().ffmpegAvailable()).toBe(false);
  });
});
