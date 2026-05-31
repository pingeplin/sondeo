import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Observable } from 'rxjs';
import { describe, it, expect } from 'vitest';
import { Wrapper } from '../src/wrapper';
import { InjectorImpl } from '../src/injectorImpl';
import { ParserImpl } from '../src/parserImpl';
import { WriterImpl } from '../src/writerImpl';
import { DecryptorImpl } from '../src/decryptorImpl';
import { MergerImpl } from '../src/mergerImpl';
import { FakeDownloader, FakeMerger, FakeEntry } from './helpers/fakes';
import { meta, readFx, segName } from './helpers/fixtures';

const run = (obs: Observable<unknown>): Promise<void> =>
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

function encryptedMap(playlist: string, segDir: string): Record<string, FakeEntry> {
  const m = meta();
  const map: Record<string, FakeEntry> = {
    [playlist]: { data: readFx(playlist) },
    'enc.key': { data: readFx('enc.key') },
  };
  for (let i = 0; i < m.segmentCount; i++) {
    map[`${segDir}/${segName(i)}`] = { data: readFx(segDir, segName(i)) };
  }
  return map;
}

describe('Wrapper — encrypted pipeline', () => {
  it(
    'fetches the key, decrypts every segment, and produces a valid mp4 (explicit IV)',
    async () => {
      const fakeDl = new FakeDownloader(
        encryptedMap('encrypted-explicit.m3u8', 'enc-explicit')
      );
      const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));
      const inj = new InjectorImpl();
      inj.set('Parser', new ParserImpl());
      inj.set('Downloader', fakeDl);
      inj.set('Writer', new WriterImpl());
      inj.set('Decryptor', new DecryptorImpl());
      inj.set('Merger', new MergerImpl());

      await run(new Wrapper(outDir, inj).save('https://x/encrypted-explicit.m3u8'));

      const outFile = join(outDir, 'encrypted-explicit.mp4');
      expect(existsSync(outFile)).toBe(true);
      const probe = ffprobe(outFile);
      expect(probe.format.format_name).toContain('mp4');
      expect(
        Math.abs(parseFloat(probe.format.duration) - meta().totalDuration)
      ).toBeLessThan(0.5);
      // key fetched before any media segment (playlist is fetched first)
      const keyIdx = fakeDl.calls.indexOf('enc.key');
      const firstSegIdx = fakeDl.calls.findIndex((c) =>
        c.startsWith('enc-explicit/')
      );
      expect(keyIdx).toBeGreaterThanOrEqual(0);
      expect(keyIdx).toBeLessThan(firstSegIdx);
      rmSync(outDir, { recursive: true, force: true });
    },
    20000
  );

  it('applies the single declared key to all segments (derived IV), reaching the merge barrier', async () => {
    const m = meta();
    const fakeDl = new FakeDownloader(
      encryptedMap('encrypted-derived.m3u8', 'enc-derived')
    );
    const fakeMerger = new FakeMerger(true);
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));
    const inj = new InjectorImpl();
    inj.set('Parser', new ParserImpl());
    inj.set('Downloader', fakeDl);
    inj.set('Writer', new WriterImpl());
    inj.set('Decryptor', new DecryptorImpl());
    inj.set('Merger', fakeMerger);

    await run(new Wrapper(outDir, inj).save('https://x/encrypted-derived.m3u8'));

    // every segment decrypted without error and reached the barrier
    expect(fakeMerger.mergeCalls).toBe(1);
    expect(fakeMerger.received!.length).toBe(m.segmentCount);
    rmSync(outDir, { recursive: true, force: true });
  });
});
