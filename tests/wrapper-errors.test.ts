import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Observable } from 'rxjs';
import { describe, it, expect } from 'vitest';
import { Wrapper } from '../src/wrapper';
import { InjectorImpl } from '../src/injectorImpl';
import { ParserImpl } from '../src/parserImpl';
import { WriterImpl } from '../src/writerImpl';
import { DecryptorImpl } from '../src/decryptorImpl';
import { Decryptor, Writer } from '../src/interfaces/interfaces';
import { FakeDownloader, FakeMerger, FakeEntry } from './helpers/fakes';
import { meta, readFx, segName } from './helpers/fixtures';

const run = (obs: Observable<unknown>): Promise<void> =>
  new Promise((resolve, reject) =>
    obs.subscribe({ next: () => {}, error: reject, complete: () => resolve() })
  );

function injector(parts: {
  downloader: FakeDownloader;
  merger: FakeMerger;
  writer?: Writer;
  decryptor?: Decryptor;
}): InjectorImpl {
  const inj = new InjectorImpl();
  inj.set('Parser', new ParserImpl());
  inj.set('Downloader', parts.downloader);
  inj.set('Writer', parts.writer ?? new WriterImpl());
  inj.set('Decryptor', parts.decryptor ?? new DecryptorImpl());
  inj.set('Merger', parts.merger);
  return inj;
}

class SpyWriter implements Writer {
  readonly writes: string[] = [];
  writeFile(path: string, _data: DataView): Observable<void> {
    this.writes.push(path);
    return new Observable<void>((s) => {
      s.next();
      s.complete();
    });
  }
}

class ThrowingDecryptor implements Decryptor {
  decrypt(): Uint8Array {
    throw new Error('bad decrypt: wrong key for segment');
  }
}

describe('Wrapper — runtime error handling', () => {
  it('rejects an empty playlist without invoking the merger (S12)', async () => {
    const empty = Buffer.from(
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-ENDLIST\n'
    );
    const fakeDl = new FakeDownloader({ 'empty.m3u8': { data: empty } });
    const fakeMerger = new FakeMerger(true);
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(
        new Wrapper(
          outDir,
          injector({ downloader: fakeDl, merger: fakeMerger })
        ).save('https://x/empty.m3u8')
      )
    ).rejects.toThrow(/no segments/i);

    expect(fakeMerger.mergeCalls).toBe(0);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('aborts before any media-segment download when the key fetch fails (S13)', async () => {
    const m = meta();
    // map the playlist and segments, but NOT the key — its download errors
    const map: Record<string, FakeEntry> = {
      'encrypted-explicit.m3u8': { data: readFx('encrypted-explicit.m3u8') },
    };
    for (let i = 0; i < m.segmentCount; i++) {
      map[`enc-explicit/${segName(i)}`] = {
        data: readFx('enc-explicit', segName(i)),
      };
    }
    const fakeDl = new FakeDownloader(map);
    const fakeMerger = new FakeMerger(true);
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(
        new Wrapper(
          outDir,
          injector({ downloader: fakeDl, merger: fakeMerger })
        ).save('https://x/encrypted-explicit.m3u8')
      )
    ).rejects.toThrow(/enc\.key/);

    // key was attempted; no media segment was ever requested
    expect(fakeDl.calls).toContain('enc.key');
    expect(fakeDl.calls.some((c) => c.startsWith('enc-explicit/'))).toBe(false);
    expect(fakeMerger.mergeCalls).toBe(0);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('aborts the run and skips merge when a segment download fails (S14)', async () => {
    const body = ['s0', 's1', 's2'].map((u) => `#EXTINF:1.0,\n${u}`).join('\n');
    const playlist = Buffer.from(
      `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n${body}\n#EXT-X-ENDLIST\n`
    );
    // s1 is intentionally absent → its download errors
    const fakeDl = new FakeDownloader({
      'seg-fail.m3u8': { data: playlist },
      s0: { data: Buffer.from('A') },
      s2: { data: Buffer.from('C') },
    });
    const fakeMerger = new FakeMerger(true);
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(
        new Wrapper(
          outDir,
          injector({ downloader: fakeDl, merger: fakeMerger })
        ).save('https://x/seg-fail.m3u8')
      )
    ).rejects.toThrow(/no entry for s1/);

    expect(fakeMerger.mergeCalls).toBe(0);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('surfaces a decryption failure and writes no segment file (S11)', async () => {
    const m = meta();
    const map: Record<string, FakeEntry> = {
      'encrypted-explicit.m3u8': { data: readFx('encrypted-explicit.m3u8') },
      'enc.key': { data: readFx('enc.key') },
    };
    for (let i = 0; i < m.segmentCount; i++) {
      map[`enc-explicit/${segName(i)}`] = {
        data: readFx('enc-explicit', segName(i)),
      };
    }
    const fakeDl = new FakeDownloader(map);
    const fakeMerger = new FakeMerger(true);
    const spyWriter = new SpyWriter();
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(
        new Wrapper(
          outDir,
          injector({
            downloader: fakeDl,
            merger: fakeMerger,
            writer: spyWriter,
            decryptor: new ThrowingDecryptor(),
          })
        ).save('https://x/encrypted-explicit.m3u8')
      )
    ).rejects.toThrow(/decrypt/i);

    // decryption throws before any write → no segment file is produced
    expect(spyWriter.writes.length).toBe(0);
    expect(fakeMerger.mergeCalls).toBe(0);
    rmSync(outDir, { recursive: true, force: true });
  });
});
