import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { Downloader, Merger, Result } from '../../src/interfaces/interfaces';

export interface FakeEntry {
  data: Buffer;
  delayMs?: number;
}

/** Serves canned bytes per target with optional per-target delay; records calls. */
export class FakeDownloader implements Downloader {
  url: URL | undefined;
  readonly calls: string[] = [];

  constructor(private readonly map: Record<string, FakeEntry>) {}

  download(target: string): Observable<Result> {
    this.calls.push(target);
    const entry = this.map[target];
    if (!entry) {
      return new Observable((sub) =>
        sub.error(new Error(`FakeDownloader: no entry for ${target}`))
      );
    }
    const view = new DataView(
      entry.data.buffer,
      entry.data.byteOffset,
      entry.data.byteLength
    );
    const result: Result = { name: target, data: view };
    return entry.delayMs ? of(result).pipe(delay(entry.delayMs)) : of(result);
  }
}

/** Records the ordered paths it was asked to merge; never spawns ffmpeg. */
export class FakeMerger implements Merger {
  received: string[] | undefined;
  mergeCalls = 0;

  constructor(private readonly available = true) {}

  ffmpegAvailable(): boolean {
    return this.available;
  }

  merge(orderedSegmentPaths: string[], _outPath: string): Observable<void> {
    this.mergeCalls++;
    this.received = [...orderedSegmentPaths];
    return new Observable((sub) => {
      sub.next();
      sub.complete();
    });
  }
}
