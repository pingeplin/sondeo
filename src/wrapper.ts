import { from, Observable, of, Subject, throwError } from 'rxjs';
import { map, mergeMap, switchMap, toArray } from 'rxjs/operators';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, parse as parsePath } from 'path';
import {
  Decryptor,
  Downloader,
  Injector,
  Merger,
  Parser,
  Status,
  Writer,
} from './interfaces/interfaces';
import { ivForSegment } from './iv';

const CONCURRENCY = 5;

function toBuffer(view: DataView): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function segName(index: number): string {
  return `seg${String(index).padStart(5, '0')}.ts`;
}

interface SegmentItem {
  index: number;
  uri: string;
  ivWords?: number[];
}

export class Wrapper {
  private readonly outPath: string;
  private readonly parser: Parser;
  private readonly downloader: Downloader;
  private readonly writer: Writer;
  private readonly decryptor: Decryptor;
  private readonly merger: Merger;

  constructor(outPath: string, injector: Injector) {
    this.outPath = outPath;
    this.parser = injector.get('Parser');
    this.downloader = injector.get('Downloader');
    this.writer = injector.get('Writer');
    this.decryptor = injector.get('Decryptor');
    this.merger = injector.get('Merger');
  }

  save(target: string): Observable<Status> {
    const notify = new Subject<Status>();

    if (!this.merger.ffmpegAvailable()) {
      queueMicrotask(() =>
        notify.error(
          new Error(
            "ffmpeg is required to merge segments into an .mp4. Install it (e.g. 'brew install ffmpeg') and retry."
          )
        )
      );
      return notify.asObservable();
    }

    const url = new URL(target);
    this.downloader.url = url;
    const playlistName = url.pathname.split('/').slice(-1)[0];
    const outFile = join(this.outPath, parsePath(playlistName).name + '.mp4');

    this.downloader
      .download(playlistName)
      .pipe(
        switchMap((result) => {
          const manifest = this.parser.parse(toBuffer(result.data));
          const segments = manifest.segments || [];

          if (segments.some((segment) => segment.map)) {
            return throwError(
              new Error(
                'fMP4 (#EXT-X-MAP) playlists are not supported in v1; decrypt and merge with ffmpeg directly.'
              )
            );
          }
          const key = segments.find((segment) => segment.key)?.key;
          if (key && key.method !== 'AES-128') {
            return throwError(
              new Error(
                `Unsupported encryption method '${key.method}'; only AES-128 is supported.`
              )
            );
          }
          if (segments.length === 0) {
            return throwError(new Error('no segments to merge'));
          }

          const mediaSequence = manifest.mediaSequence ?? 0;
          const tempDir = mkdtempSync(join(tmpdir(), 'sondeo-seg-'));
          const items: SegmentItem[] = segments.map((segment, index) => ({
            index,
            uri: segment.uri,
            ivWords: segment.key?.iv,
          }));
          let downloaded = 0;
          notify.next({ total: items.length, downloaded });

          // Fetch the key first so every segment can be decrypted on arrival.
          const key$ = key
            ? this.downloader
                .download(key.uri)
                .pipe(map((r) => toBuffer(r.data)))
            : of<Buffer | undefined>(undefined);

          return key$.pipe(
            switchMap((keyBytes) =>
              from(items).pipe(
                mergeMap(
                  (item) =>
                    this.downloader.download(item.uri).pipe(
                      mergeMap((segmentResult) => {
                        let data: DataView = segmentResult.data;
                        if (keyBytes) {
                          const iv = ivForSegment(
                            item.ivWords,
                            mediaSequence,
                            item.index
                          );
                          const plain = this.decryptor.decrypt(
                            toBuffer(segmentResult.data),
                            keyBytes,
                            iv
                          );
                          data = new DataView(
                            plain.buffer,
                            plain.byteOffset,
                            plain.byteLength
                          );
                        }
                        const segPath = join(tempDir, segName(item.index));
                        return this.writer.writeFile(segPath, data).pipe(
                          map(() => {
                            downloaded++;
                            notify.next({ total: items.length, downloaded });
                            return { index: item.index, path: segPath };
                          })
                        );
                      })
                    ),
                  CONCURRENCY
                ),
                toArray(),
                switchMap((written) => {
                  const ordered = written
                    .sort((a, b) => a.index - b.index)
                    .map((entry) => entry.path);
                  return this.merger.merge(ordered, outFile);
                })
              )
            )
          );
        })
      )
      .subscribe({
        error: (err) => notify.error(err),
        complete: () => notify.complete(),
      });

    return notify.asObservable();
  }
}
