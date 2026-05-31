import { Observable } from 'rxjs';
import { Downloader, Merger, Result } from '../../src/interfaces/interfaces';

export interface FakeEntry {
  data: Buffer;
}

/**
 * Serves canned bytes per target and records call order.
 *
 * When `completionOrder` is given, segment downloads emit in that order using
 * microtask-chain depth (not wall-clock timers) — deterministic out-of-order
 * completion, so the ordering tests can't flake. A target absent from
 * `completionOrder` (e.g. the playlist itself) emits immediately.
 */
export class FakeDownloader implements Downloader {
  url: URL | undefined;
  readonly calls: string[] = [];

  constructor(
    private readonly map: Record<string, FakeEntry>,
    private readonly completionOrder?: string[]
  ) {}

  download(target: string): Observable<Result> {
    this.calls.push(target);
    const entry = this.map[target];

    return new Observable<Result>((sub) => {
      if (!entry) {
        sub.error(new Error(`FakeDownloader: no entry for ${target}`));
        return;
      }
      const view = new DataView(
        entry.data.buffer,
        entry.data.byteOffset,
        entry.data.byteLength
      );
      const emit = () => {
        sub.next({ name: target, data: view });
        sub.complete();
      };

      const position = this.completionOrder?.indexOf(target) ?? -1;
      if (position < 0) {
        emit();
        return;
      }
      // Defer by `position` microtask hops: deeper chains resolve strictly
      // later (microtask FIFO), so emission order == completionOrder order.
      let gate = Promise.resolve();
      for (let hop = 0; hop < position; hop++) {
        gate = gate.then(() => undefined);
      }
      void gate.then(emit);
    });
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
