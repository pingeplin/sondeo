import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
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

function playlist(uris: string[]): Buffer {
  const body = uris.map((u) => `#EXTINF:1.0,\n${u}`).join('\n');
  return Buffer.from(
    `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n${body}\n#EXT-X-ENDLIST\n`
  );
}

function injectorWith(
  downloader: FakeDownloader,
  merger: FakeMerger
): InjectorImpl {
  const inj = new InjectorImpl();
  inj.set('Parser', new ParserImpl());
  inj.set('Downloader', downloader);
  inj.set('Writer', new WriterImpl());
  inj.set('Decryptor', new DecryptorImpl());
  inj.set('Merger', merger);
  return inj;
}

function ffprobe(file: string): any {
  return JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      file,
    ]).toString()
  );
}

describe('Wrapper — cleartext pipeline', () => {
  it('merges segments in playlist-index order despite reverse completion order', async () => {
    const fakeDl = new FakeDownloader(
      {
        'rev.m3u8': { data: playlist(['s0', 's1', 's2']) },
        s0: { data: Buffer.from('AAA') },
        s1: { data: Buffer.from('BBB') },
        s2: { data: Buffer.from('CCC') },
      },
      ['s2', 's1', 's0'] // segments complete in reverse playlist order
    );
    const fakeMerger = new FakeMerger();
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await run(
      new Wrapper(outDir, injectorWith(fakeDl, fakeMerger)).save(
        'https://x/rev.m3u8'
      )
    );

    expect(fakeMerger.received).toBeDefined();
    expect(fakeMerger.received!.map((p) => basename(p))).toEqual([
      segName(0),
      segName(1),
      segName(2),
    ]);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('merges in index order for shuffled completion order', async () => {
    const fakeDl = new FakeDownloader(
      {
        'shuf.m3u8': { data: playlist(['a', 'b', 'c', 'd']) },
        a: { data: Buffer.from('A') },
        b: { data: Buffer.from('B') },
        c: { data: Buffer.from('C') },
        d: { data: Buffer.from('D') },
      },
      ['c', 'a', 'd', 'b'] // segments complete in shuffled order
    );
    const fakeMerger = new FakeMerger();
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await run(
      new Wrapper(outDir, injectorWith(fakeDl, fakeMerger)).save(
        'https://x/shuf.m3u8'
      )
    );

    expect(fakeMerger.received!.map((p) => basename(p))).toEqual([
      segName(0),
      segName(1),
      segName(2),
      segName(3),
    ]);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('keeps every occurrence of a repeated segment URI in order (no dedup)', async () => {
    const fakeDl = new FakeDownloader({
      'dup.m3u8': { data: playlist(['dup', 'dup', 'dup']) },
      dup: { data: Buffer.from('X') },
    });
    const fakeMerger = new FakeMerger();
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await run(
      new Wrapper(outDir, injectorWith(fakeDl, fakeMerger)).save(
        'https://x/dup.m3u8'
      )
    );

    expect(fakeDl.calls.filter((c) => c === 'dup').length).toBe(3);
    expect(fakeMerger.received!.length).toBe(3);
    expect(fakeMerger.received!.map((p) => basename(p))).toEqual([
      segName(0),
      segName(1),
      segName(2),
    ]);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('produces a valid mp4 from a cleartext fixture playlist', async () => {
    const m = meta();
    const map: Record<string, FakeEntry> = {
      'cleartext.m3u8': { data: readFx('cleartext.m3u8') },
    };
    const segTargets: string[] = [];
    for (let i = 0; i < m.segmentCount; i++) {
      const target = `plain/${segName(i)}`;
      segTargets.push(target);
      map[target] = { data: readFx('plain', segName(i)) };
    }
    // complete in reverse so ordering is exercised through the real merge
    const fakeDl = new FakeDownloader(map, [...segTargets].reverse());
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));
    const inj = new InjectorImpl();
    inj.set('Parser', new ParserImpl());
    inj.set('Downloader', fakeDl);
    inj.set('Writer', new WriterImpl());
    inj.set('Decryptor', new DecryptorImpl());
    inj.set('Merger', new MergerImpl()); // real ffmpeg merge

    await run(new Wrapper(outDir, inj).save('https://x/cleartext.m3u8'));

    const outFile = join(outDir, 'cleartext.mp4');
    expect(existsSync(outFile)).toBe(true);
    const probe = ffprobe(outFile);
    expect(probe.format.format_name).toContain('mp4');
    expect(
      Math.abs(parseFloat(probe.format.duration) - m.totalDuration)
    ).toBeLessThan(0.5);
    rmSync(outDir, { recursive: true, force: true });
  }, 20000);
});
