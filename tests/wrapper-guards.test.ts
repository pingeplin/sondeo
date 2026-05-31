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
import { FakeDownloader, FakeMerger } from './helpers/fakes';
import { readFx } from './helpers/fixtures';

const run = (obs: Observable<unknown>): Promise<void> =>
  new Promise((resolve, reject) =>
    obs.subscribe({ next: () => {}, error: reject, complete: () => resolve() })
  );

function injectorWith(downloader: FakeDownloader, merger: FakeMerger): InjectorImpl {
  const inj = new InjectorImpl();
  inj.set('Parser', new ParserImpl());
  inj.set('Downloader', downloader);
  inj.set('Writer', new WriterImpl());
  inj.set('Decryptor', new DecryptorImpl());
  inj.set('Merger', merger);
  return inj;
}

describe('Wrapper — preflight + guards', () => {
  it('fails fast when ffmpeg is unavailable, without downloading anything', async () => {
    const fakeDl = new FakeDownloader({
      'cleartext.m3u8': { data: readFx('cleartext.m3u8') },
    });
    const fakeMerger = new FakeMerger(false); // ffmpeg absent
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(new Wrapper(outDir, injectorWith(fakeDl, fakeMerger)).save('https://x/cleartext.m3u8'))
    ).rejects.toThrow(/ffmpeg/i);

    expect(fakeDl.calls.length).toBe(0);
    expect(fakeMerger.mergeCalls).toBe(0);
    expect(existsSync(join(outDir, 'cleartext.mp4'))).toBe(false);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('rejects fMP4 (#EXT-X-MAP) playlists without downloading any segment', async () => {
    const fakeDl = new FakeDownloader({
      'fmp4.m3u8': { data: readFx('fmp4.m3u8') },
    });
    const fakeMerger = new FakeMerger(true);
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(new Wrapper(outDir, injectorWith(fakeDl, fakeMerger)).save('https://x/fmp4.m3u8'))
    ).rejects.toThrow(/fmp4|EXT-X-MAP/i);

    // only the playlist was fetched — no segment download
    expect(fakeDl.calls).toEqual(['fmp4.m3u8']);
    expect(fakeMerger.mergeCalls).toBe(0);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('rejects non-AES-128 encryption (SAMPLE-AES) without downloading any segment', async () => {
    const fakeDl = new FakeDownloader({
      'sample-aes.m3u8': { data: readFx('sample-aes.m3u8') },
    });
    const fakeMerger = new FakeMerger(true);
    const outDir = mkdtempSync(join(tmpdir(), 'sondeo-out-'));

    await expect(
      run(new Wrapper(outDir, injectorWith(fakeDl, fakeMerger)).save('https://x/sample-aes.m3u8'))
    ).rejects.toThrow(/sample-aes|aes-128/i);

    expect(fakeDl.calls).toEqual(['sample-aes.m3u8']);
    expect(fakeMerger.mergeCalls).toBe(0);
    rmSync(outDir, { recursive: true, force: true });
  });
});
