import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Observable } from 'rxjs';
import { describe, it, expect } from 'vitest';
import { MergerImpl } from '../src/mergerImpl';
import { fx, meta, segName } from './helpers/fixtures';

const done = (obs: Observable<void>): Promise<void> =>
  new Promise((resolve, reject) =>
    obs.subscribe({ next: () => {}, error: reject, complete: () => resolve() })
  );

function ffprobe(file: string): any {
  return JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_format', '-show_streams',
      '-of', 'json',
      file,
    ]).toString()
  );
}

describe('MergerImpl.merge', () => {
  it(
    'concatenates ordered segments into a valid mp4',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sondeo-merge-'));
      const out = join(dir, 'out.mp4');
      const m = meta();
      const segs = Array.from({ length: m.segmentCount }, (_, i) =>
        fx('plain', segName(i))
      );

      await done(new MergerImpl().merge(segs, out));

      expect(existsSync(out)).toBe(true);
      const probe = ffprobe(out);
      expect(probe.format.format_name).toContain('mp4');
      expect(probe.streams.length).toBe(m.expectedStreams.count);
      const codecs = probe.streams.map((s: any) => s.codec_name).sort();
      expect(codecs).toEqual(m.expectedStreams.codecs);
      expect(
        Math.abs(parseFloat(probe.format.duration) - m.totalDuration)
      ).toBeLessThan(0.5);

      rmSync(dir, { recursive: true, force: true });
    },
    20000
  );

  it(
    'errors when ffmpeg exits non-zero (empty input)',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sondeo-merge-'));
      const out = join(dir, 'out.mp4');

      await expect(done(new MergerImpl().merge([], out))).rejects.toThrow();
      expect(existsSync(out)).toBe(false);

      rmSync(dir, { recursive: true, force: true });
    },
    20000
  );
});
